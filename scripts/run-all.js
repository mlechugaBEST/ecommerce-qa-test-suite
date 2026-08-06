#!/usr/bin/env node
/**
 * Run the Cypress suite against every store (or a subset), one store at a time.
 * Cypress cannot switch baseUrl mid-run, so each store gets its own process.
 * Failures don't stop the loop; a summary table prints at the end and the exit
 * code is nonzero if any store failed.
 *
 *   node scripts/run-all.js
 *   node scripts/run-all.js --stores bestus,bestca
 *   node scripts/run-all.js --stores bestus --spec "cypress/e2e/seo.cy.js"
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { SUMMARY_DIR } = require('./writeRunLog');
const { resolveCypressBin } = require('./resolveCypressBin');

const storesDir = path.join(__dirname, '..', 'stores');
const LOG_FILE = path.join(__dirname, '..', 'results', 'test-results.log');
const RULE = '═'.repeat(60);

function availableStores() {
  return fs.readdirSync(storesDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

const args = process.argv.slice(2);
const all = availableStores();
let stores = all;
const cypressArgs = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--stores') {
    stores = (args[++i] || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  } else {
    cypressArgs.push(args[i]);
  }
}

const unknown = stores.filter((s) => !all.includes(s));
if (unknown.length) {
  console.error(`Unknown store(s): ${unknown.join(', ')}. Available: ${all.join(', ')}`);
  process.exit(1);
}

// Default to Chrome unless the caller already passed --browser.
if (!cypressArgs.includes('--browser')) cypressArgs.push('--browser', 'chrome');

const results = [];

// Clear stale per-store sidecars so the aggregate only reflects this run.
for (const store of stores) {
  try { fs.rmSync(path.join(SUMMARY_DIR, `${store}.json`)); } catch { /* none yet */ }
}

const runStarted = Date.now();
console.log(`\n▶ Test run started ${new Date().toLocaleString()}  —  ${stores.length} store(s): ${stores.join(', ')}`);

for (const store of stores) {
  console.log(`\n${'═'.repeat(70)}\n▶ Store: ${store}  —  started ${new Date().toLocaleString()}\n${'═'.repeat(70)}\n`);
  const started = Date.now();
  const result = spawnSync(process.execPath, [resolveCypressBin(), 'run', ...cypressArgs], {
    stdio: 'inherit',
    env: { ...process.env, STORE: store },
  });
  results.push({
    store,
    ok: result.status === 0,
    minutes: ((Date.now() - started) / 60000).toFixed(1),
  });
}

// Pull each store's failure detail from the sidecar the after:run hook wrote.
function loadSummary(store) {
  try {
    return JSON.parse(fs.readFileSync(path.join(SUMMARY_DIR, `${store}.json`), 'utf8'));
  } catch {
    return null; // crashed before after:run, or logging failed
  }
}

// ANSI colors for the console only — the log file stays plain text.
const C = {
  reset: '\x1b[0m', green: '\x1b[32m', white: '\x1b[37m',
  orange: '\x1b[38;5;208m', red: '\x1b[31m',
};
const useColor = process.stdout.isTTY || process.env.FORCE_COLOR;
function paint(code, text) { return useColor ? `${code}${text}${C.reset}` : text; }
// Tier by pass rate of executed tests (pending excluded):
// green 100% · white >=80% · orange >=60% · red <60% (or no data).
function storeColor(s) {
  if (!s) return C.red;
  const executed = s.totals.totalPassed + s.totals.totalFailed;
  const rate = executed ? s.totals.totalPassed / executed : 0;
  if (s.totals.totalFailed === 0) return C.green;
  if (rate >= 0.80) return C.white;
  if (rate >= 0.60) return C.orange;
  return C.red;
}

const wallMinutes = ((Date.now() - runStarted) / 60000).toFixed(1);
const testSeconds = results.reduce((sum, r) => {
  const s = loadSummary(r.store);
  return sum + (s ? s.durationMs : 0) / 1000;
}, 0);
const testTime = `${Math.floor(testSeconds / 60)}m ${Math.round(testSeconds % 60)}s`;

// Build the aggregate summary twice: plain[] for the log file, colored[] for
// the console. Per-store lines are tinted by storeColor() (green/yellow/red).
const plain = [];
const colored = [];
function push(line, color) {
  plain.push(line);
  colored.push(color ? paint(color, line) : line);
}

push(RULE);
push(`RUN-ALL SUMMARY  |  ${new Date().toLocaleString()}  |  ${stores.length} store(s)`);
push(`Total test time: ${testTime}  |  Wall clock: ${wallMinutes} min`);
push(RULE);
for (const { store, ok, minutes } of results) {
  const s = loadSummary(store);
  const color = storeColor(s);
  const totals = s ? `${s.totals.totalFailed} failed / ${s.totals.totalTests}` : '(no data)';
  push(`  ${ok ? '✔ PASS' : '✘ FAIL'}  ${store.padEnd(10)} ${String(minutes).padStart(5)} min   ${totals}`, color);
  if (s && s.failedSpecs.length) {
    for (const spec of s.failedSpecs) {
      push(`           ↳ ${spec.spec} (${spec.failures})`, color);
      for (const t of spec.tests) push(`               • ${t}`, color);
    }
  }
}
push(RULE);

const block = plain.join('\n');
console.log(`\n${colored.join('\n')}\n`);
console.log(`▶ Test run finished ${new Date().toLocaleString()}\n`);

// Persist the aggregate alongside the per-store blocks (best-effort).
try {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.appendFileSync(LOG_FILE, block + '\n\n', 'utf8');
} catch (err) {
  console.error(`run-all: failed to append summary to log — ${err.message}`);
}

process.exit(results.every((r) => r.ok) ? 0 : 1);
