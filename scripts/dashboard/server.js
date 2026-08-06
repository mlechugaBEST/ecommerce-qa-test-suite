#!/usr/bin/env node
/**
 * Local test dashboard — a friendly browser front end for the Cypress suite.
 *
 *   node scripts/dashboard/server.js      (or: npm run dashboard)
 *
 * Serves a single-page UI at http://localhost:8420 that lets a non-technical
 * operator pick stores, watch a live run, and see color-coded results with
 * inline screenshots/videos, run history, and one-click re-run of failures.
 *
 * Design notes:
 *  - Node built-ins only (http/fs/path/child_process) — no npm dependencies.
 *  - It does NOT reimplement how Cypress runs. It spawns the existing runners
 *    (scripts/run-all.js and scripts/run-store.js), so the after:run hook keeps
 *    writing results/test-results.log and results/.run-summary/<store>.json.
 *  - Stub mode only: it never sets LIVE_SUBMIT / I_KNOW_THIS_IS_LIVE, so the UI
 *    can never create real CRM leads. Live submission stays CLI-only.
 *  - One run at a time (Cypress is heavy): a run lock returns 409 while busy.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const { SUMMARY_DIR } = require('../writeRunLog');
const STORE_NAMES = require('./storeNames');

const ROOT = path.join(__dirname, '..', '..');
const PUBLIC_DIR = path.join(__dirname, 'public');
const STORES_DIR = path.join(ROOT, 'stores');
const LOG_FILE = path.join(ROOT, 'results', 'test-results.log');
const SCREENSHOTS_DIR = path.join(ROOT, 'cypress', 'screenshots');
const VIDEOS_DIR = path.join(ROOT, 'cypress', 'videos');
const PORT = Number(process.env.DASHBOARD_PORT) || 8420;

// One-time random secret for this dashboard process's lifetime. Injected into the served
// HTML (see the '/' handler below) and required as a header on state-changing POST routes,
// so a CSRF page or another local process can't silently trigger a run/stop/exit — it would
// have to already be able to read this same-origin page's DOM, which cross-origin JS cannot
// (no CORS headers are ever sent). Regenerates on every server restart; that's fine for a
// local, single-operator tool with no persistence requirement.
const DASHBOARD_TOKEN = crypto.randomBytes(24).toString('hex');

// ── helpers ────────────────────────────────────────────────────────────────

function availableStores() {
  return fs
    .readdirSync(STORES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

// Real, on-disk spec paths (e.g. "cypress/e2e/homepage.cy.js") — used to
// validate --spec values from POST /api/run before they reach a child process.
function availableSpecs() {
  const e2eDir = path.join(ROOT, 'cypress', 'e2e');
  return fs
    .readdirSync(e2eDir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.cy.js'))
    .map((e) => path.relative(ROOT, path.join(e.parentPath, e.name)).split(path.sep).join('/'));
}

// Strip ANSI color codes so the browser log pane stays clean text.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
function stripAnsi(s) {
  return s.replace(ANSI_RE, '');
}

function readSidecar(store) {
  try {
    return JSON.parse(fs.readFileSync(path.join(SUMMARY_DIR, `${store}.json`), 'utf8'));
  } catch {
    return null;
  }
}

function readAllSidecars() {
  const out = {};
  for (const store of availableStores()) {
    const s = readSidecar(store);
    if (s) out[store] = s;
  }
  return out;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

// Gate for state-changing POST routes — see DASHBOARD_TOKEN above for the rationale.
function requireToken(req, res) {
  if (req.headers['x-dashboard-token'] !== DASHBOARD_TOKEN) {
    sendJson(res, 403, { error: 'Missing or invalid dashboard token.' });
    return false;
  }
  return true;
}

// Serve a file, but only if it resolves inside `root` (path-traversal guard).
function serveFile(res, root, relPath, { range } = {}) {
  const resolved = path.resolve(root, relPath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return sendText(res, 403, 'Forbidden');
  }
  fs.stat(resolved, (err, stat) => {
    if (err || !stat.isFile()) return sendText(res, 404, 'Not found');
    const type = MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream';

    // Basic Range support so <video> can seek.
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (m) {
        let start = m[1] ? parseInt(m[1], 10) : 0;
        let end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
        if (Number.isNaN(start)) start = 0;
        if (Number.isNaN(end) || end >= stat.size) end = stat.size - 1;
        if (start > end) return sendText(res, 416, 'Range Not Satisfiable');
        res.writeHead(206, {
          'Content-Type': type,
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
        });
        return fs.createReadStream(resolved, { start, end }).pipe(res);
      }
    }

    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(resolved).pipe(res);
  });
}

// ── run-history parsing (results/test-results.log) ───────────────────────────
//
// The log is a sequence of blocks separated by a 60-char ═ rule. We only care
// about per-store blocks, which start with a "Run: ... | Store: <s> | ..." line.
// RUN-ALL SUMMARY blocks are skipped (they're a rollup of the per-store ones).
function parseHistory() {
  let text;
  try {
    text = fs.readFileSync(LOG_FILE, 'utf8');
  } catch {
    return [];
  }
  const runs = [];
  const lines = text.split(/\r?\n/);
  let cur = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const runMatch = /^Run:\s*(.+?)\s*\|\s*Store:\s*(\S+)\s*\|\s*(.+)$/.exec(line);
    if (runMatch) {
      cur = {
        timestamp: runMatch[1].trim(),
        store: runMatch[2].trim(),
        env: runMatch[3].trim(),
        outcome: null,
        duration: null,
        totalsText: null,
        specs: [],
      };
      runs.push(cur);
      continue;
    }
    if (!cur) continue;
    const resMatch = /^Result:\s*(PASS|FAIL)\s*\|\s*Duration:\s*(.+)$/.exec(line);
    if (resMatch) {
      cur.outcome = resMatch[1];
      cur.duration = resMatch[2].trim();
      continue;
    }
    const totalsMatch = /^Totals:\s*(.+)$/.exec(line);
    if (totalsMatch) {
      cur.totalsText = totalsMatch[1].trim();
      continue;
    }
    const specMatch = /^\s{2}(PASS|FAIL)\s+(\S+)\s+(.+)$/.exec(line);
    if (specMatch) {
      cur.specs.push({
        outcome: specMatch[1],
        spec: specMatch[2],
        stats: specMatch[3].trim(),
      });
    }
  }
  // Newest first.
  return runs.reverse();
}

// ── SSE hub ──────────────────────────────────────────────────────────────────

const sseClients = new Set();

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      /* client gone; cleaned up on close */
    }
  }
}

// ── run orchestration ─────────────────────────────────────────────────────────

let running = false; // single-run lock
let currentChild = null; // in-flight runner process (null between jobs / when idle)
let stopRequested = false; // set by /api/stop so runNext doesn't advance the queue

// Kill the in-flight runner and its whole subtree. The runners spawn the
// Cypress CLI directly via node, so the tree is
// server → node run-*.js → node (cypress bin) → Chrome; a plain child.kill()
// would orphan cypress + Chrome. taskkill /T takes the tree.
function killRunTree() {
  if (!currentChild) return false;
  stopRequested = true;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(currentChild.pid), '/T', '/F']);
  } else {
    currentChild.kill('SIGKILL');
  }
  return true;
}

// Emit each stdout/stderr line, and watch for the runner's own "Store: <s>"
// banner so we can flip cards to running and read the sidecar on completion.
function wireChildOutput(child, stores) {
  const remaining = new Set(stores);
  let buf = '';

  const handle = (chunk) => {
    buf += stripAnsi(chunk.toString());
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      broadcast('line', { text: line });

      // run-all.js banner: "▶ Store: bestus  —  started ..."
      const start = /Store:\s*([a-z0-9]+)\b/i.exec(line);
      if (start) {
        const code = start[1].toLowerCase();
        if (remaining.has(code)) broadcast('store-start', { store: code });
      }
      // writeRunLog prints this once a store's after:run hook has written its
      // sidecar — safe moment to read fresh results for that store.
      if (/Run logged to results\/test-results\.log/.test(line)) {
        // Figure out which store just finished: the most recent started one
        // that we haven't reported done yet.
        for (const code of remaining) {
          const sc = readSidecar(code);
          if (sc) {
            broadcast('store-done', { store: code, summary: sc });
            remaining.delete(code);
            break;
          }
        }
      }
    }
  };

  child.stdout.on('data', handle);
  child.stderr.on('data', handle);

  return remaining;
}

function startRun({ stores, specsByStore }) {
  running = true;
  broadcast('run-start', { stores });

  // Clear stale sidecars for the stores in this run so store-done reads fresh.
  for (const store of stores) {
    try {
      fs.rmSync(path.join(SUMMARY_DIR, `${store}.json`));
    } catch {
      /* none yet */
    }
  }

  const childEnv = { ...process.env, FORCE_COLOR: '' };
  delete childEnv.LIVE_SUBMIT; // hard guarantee: dashboard is stub-only
  delete childEnv.I_KNOW_THIS_IS_LIVE;

  // Two shapes of run:
  //  - specsByStore present → re-run failed specs: one run-store per store.
  //  - otherwise → normal run via run-all with --stores.
  let queue;
  if (specsByStore && Object.keys(specsByStore).length) {
    queue = Object.entries(specsByStore).map(([store, specs]) => ({
      store,
      args: [
        path.join(ROOT, 'scripts', 'run-store.js'),
        store,
        '--spec',
        specs.join(','),
      ],
    }));
  } else {
    queue = [
      {
        store: null,
        args: [path.join(ROOT, 'scripts', 'run-all.js'), '--stores', stores.join(',')],
      },
    ];
  }

  const runStores = specsByStore ? Object.keys(specsByStore) : stores;
  let remaining = new Set(runStores);

  const runNext = (i) => {
    if (i >= queue.length) {
      // Fallback: emit store-done for any store not caught by the log line.
      for (const code of remaining) {
        broadcast('store-done', { store: code, summary: readSidecar(code) });
      }
      running = false;
      broadcast('run-done', { summaries: readAllSidecars() });
      return;
    }
    const job = queue[i];
    const child = spawn(process.execPath, job.args, {
      cwd: ROOT,
      env: childEnv,
    });
    currentChild = child;
    // For per-store jobs, scope the watcher to that store; for run-all, all.
    const watchStores = job.store ? [job.store] : runStores;
    const stillOpen = wireChildOutput(child, watchStores);

    child.on('error', (err) => {
      broadcast('line', { text: `[dashboard] failed to start runner: ${err.message}` });
    });
    child.on('close', () => {
      currentChild = null;
      if (stopRequested) {
        // Operator hit STOP: don't advance the queue, just unlock.
        stopRequested = false;
        running = false;
        broadcast('line', { text: '[dashboard] run stopped by operator.' });
        broadcast('run-stopped', { summaries: readAllSidecars() });
        return;
      }
      // Reconcile: mark any watched store done from its sidecar.
      for (const code of watchStores) {
        if (remaining.has(code)) {
          broadcast('store-done', { store: code, summary: readSidecar(code) });
          remaining.delete(code);
        }
        stillOpen.delete(code);
      }
      runNext(i + 1);
    });
  };

  runNext(0);
}

// ── request handling ──────────────────────────────────────────────────────────

function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/stores') {
    const list = availableStores().map((code) => ({
      code,
      name: STORE_NAMES[code] || code.toUpperCase(),
    }));
    return sendJson(res, 200, list);
  }

  if (req.method === 'GET' && url.pathname === '/api/results/latest') {
    return sendJson(res, 200, { running, summaries: readAllSidecars() });
  }

  if (req.method === 'GET' && url.pathname === '/api/history') {
    return sendJson(res, 200, parseHistory());
  }

  if (req.method === 'GET' && url.pathname === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(`event: hello\ndata: ${JSON.stringify({ running })}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/run') {
    if (!requireToken(req, res)) return;
    if (running) return sendJson(res, 409, { error: 'A run is already in progress.' });
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      let parsed;
      try {
        parsed = body ? JSON.parse(body) : {};
      } catch {
        return sendJson(res, 400, { error: 'Invalid JSON body.' });
      }
      const all = availableStores();
      const specsByStore = parsed.specsByStore || null;
      let stores = Array.isArray(parsed.stores)
        ? parsed.stores.map((s) => String(s).toLowerCase())
        : specsByStore
          ? Object.keys(specsByStore).map((s) => s.toLowerCase())
          : [];
      stores = stores.filter((s) => all.includes(s));
      if (!stores.length) return sendJson(res, 400, { error: 'No valid stores selected.' });

      // Normalize specsByStore keys to lowercase validated stores, and drop
      // any spec string that isn't a real file on disk — these values flow
      // into a child process's --spec argument, so this is a security
      // boundary, not just a UX nicety.
      const realSpecs = new Set(availableSpecs());
      let normSpecs = null;
      if (specsByStore) {
        normSpecs = {};
        for (const [k, v] of Object.entries(specsByStore)) {
          const code = String(k).toLowerCase();
          if (!all.includes(code) || !Array.isArray(v)) continue;
          const specs = v.filter((s) => realSpecs.has(String(s)));
          if (specs.length) normSpecs[code] = specs;
        }
        if (!Object.keys(normSpecs).length) normSpecs = null;
      }

      sendJson(res, 202, { started: true, stores });
      startRun({ stores, specsByStore: normSpecs });
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/stop') {
    if (!requireToken(req, res)) return;
    if (!running || !currentChild) {
      return sendJson(res, 409, { error: 'No run is in progress.' });
    }
    killRunTree();
    return sendJson(res, 202, { stopping: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/exit') {
    if (!requireToken(req, res)) return;
    killRunTree(); // no-op when idle
    sendJson(res, 200, { exiting: true });
    // Give the response (and any taskkill) a moment to flush, then exit 0 so
    // the launcher .bat sees a clean shutdown and closes its window.
    setTimeout(() => process.exit(0), 500);
    return;
  }

  return sendText(res, 404, 'Not found');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);

  // Artifact serving (read-only, guarded).
  if (url.pathname.startsWith('/artifacts/screenshots/')) {
    const rel = decodeURIComponent(url.pathname.slice('/artifacts/screenshots/'.length));
    return serveFile(res, SCREENSHOTS_DIR, rel, { range: req.headers.range });
  }
  if (url.pathname.startsWith('/artifacts/videos/')) {
    const rel = decodeURIComponent(url.pathname.slice('/artifacts/videos/'.length));
    return serveFile(res, VIDEOS_DIR, rel, { range: req.headers.range });
  }

  // index.html carries the per-session dashboard token, so it can't be served as a static
  // file — read + inject it fresh on every request (still just fs.readFile, no templating dep).
  if (url.pathname === '/' || url.pathname === '/index.html') {
    return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), 'utf8', (err, html) => {
      if (err) return sendText(res, 404, 'Not found');
      const injected = html.replace(
        '</head>',
        `    <meta name="dashboard-token" content="${DASHBOARD_TOKEN}" />\n  </head>`
      );
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(injected);
    });
  }

  // Static UI (app.js, styles.css, etc.).
  const rel = url.pathname.replace(/^\/+/, '');
  return serveFile(res, PUBLIC_DIR, rel);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `\n[X] Port ${PORT} is already in use.\n` +
        `    The dashboard may already be running in another window.\n` +
        `    Close it, or set a different port:  set DASHBOARD_PORT=8421\n`
    );
    process.exit(1);
  }
  throw err;
});

// Bind to localhost only — this server accepts unauthenticated run/stop/exit
// commands, so it must never be reachable from other devices on the network.
server.listen(PORT, '127.0.0.1', () => {
  console.log(
    `\n  ============================================================\n` +
      `   TEST DASHBOARD running\n` +
      `   Open in your browser:  http://localhost:${PORT}\n` +
      `   (Leave this window open. Close it to stop the dashboard.)\n` +
      `  ============================================================\n`
  );
});
