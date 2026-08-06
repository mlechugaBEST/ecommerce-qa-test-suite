/* Test Dashboard front end — vanilla JS, no build step. */
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  let stores = []; // [{code, name}]
  const cards = new Map(); // code -> { root, statusEl, detailEl }
  let lastSummaries = {}; // code -> sidecar (for re-run failed)
  let running = false;
  let es = null; // EventSource, held so the Exit button can close it

  // Read once from the <meta> tag server.js injects into index.html on every request —
  // required as a header on state-changing POST calls (see requireToken in server.js).
  const DASHBOARD_TOKEN =
    (document.querySelector('meta[name="dashboard-token"]') || {}).content || '';

  // ── color tiers (mirror scripts/run-all.js storeColor) ────────────────────
  function tierOf(summary) {
    if (!summary) return 'nodata';
    const t = summary.totals || {};
    const executed = (t.totalPassed || 0) + (t.totalFailed || 0);
    const rate = executed ? t.totalPassed / executed : 0;
    if ((t.totalFailed || 0) === 0) return 'pass';
    if (rate >= 0.8) return 'warn';
    if (rate >= 0.6) return 'orange';
    return 'fail';
  }

  // ── theme toggle ─────────────────────────────────────────────────────────────
  // The head script already applied the saved theme before paint; here we just
  // keep the button label in sync and flip/persist on click.
  const themeBtn = $('#theme-toggle');
  function syncThemeLabel() {
    const dark = document.documentElement.dataset.theme === 'dark';
    themeBtn.textContent = dark ? '☀ Light' : '🌙 Dark';
  }
  themeBtn.addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('dashboard-theme', next);
    } catch (e) {
      /* private mode — theme still applies for this session */
    }
    syncThemeLabel();
  });
  syncThemeLabel();

  // ── tabs ───────────────────────────────────────────────────────────────────
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      $('#tab-' + btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'history') loadHistory();
    });
  });

  // ── store picker ─────────────────────────────────────────────────────────────
  async function loadStores() {
    const res = await fetch('/api/stores');
    stores = await res.json();
    const list = $('#store-list');
    list.innerHTML = '';
    for (const s of stores) {
      const label = el('label', 'store-check');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.value = s.code;
      cb.addEventListener('change', updateRunButton);
      label.appendChild(cb);
      const txt = el('span');
      txt.innerHTML = `<strong>${s.code.toUpperCase()}</strong> <span class="muted">${s.name}</span>`;
      label.appendChild(txt);
      list.appendChild(label);
    }
    updateRunButton();
  }

  function selectedStores() {
    return [...document.querySelectorAll('#store-list input:checked')].map((c) => c.value);
  }

  function updateRunButton() {
    $('#run-btn').disabled = running || selectedStores().length === 0;
  }

  $('#select-all').addEventListener('click', () => {
    document.querySelectorAll('#store-list input').forEach((c) => (c.checked = true));
    updateRunButton();
  });
  $('#select-none').addEventListener('click', () => {
    document.querySelectorAll('#store-list input').forEach((c) => (c.checked = false));
    updateRunButton();
  });

  // ── cards ────────────────────────────────────────────────────────────────────
  function nameFor(code) {
    const s = stores.find((x) => x.code === code);
    return s ? s.name : code.toUpperCase();
  }

  function makeCard(code) {
    const root = el('div', 'card queued');
    const head = el('div', 'card-head');
    head.appendChild(el('span', 'card-code', code.toUpperCase()));
    const status = el('span', 'card-status', 'queued');
    head.appendChild(status);
    root.appendChild(head);
    root.appendChild(el('div', 'card-name', nameFor(code)));
    const detail = el('div', 'card-detail');
    root.appendChild(detail);
    $('#cards').appendChild(root);
    const rec = { root, statusEl: status, detailEl: detail };
    cards.set(code, rec);
    return rec;
  }

  function setCardRunning(code) {
    const rec = cards.get(code) || makeCard(code);
    rec.root.className = 'card running';
    rec.statusEl.textContent = 'running…';
    rec.detailEl.innerHTML = '';
  }

  function specBase(spec) {
    // "cypress/e2e/lighthouse.cy.js" -> "lighthouse.cy.js"
    return spec.replace(/\\/g, '/').split('/').pop();
  }

  function setCardDone(code, summary) {
    const rec = cards.get(code) || makeCard(code);
    const tier = tierOf(summary);
    rec.root.className = 'card ' + tier;
    rec.detailEl.innerHTML = '';

    if (!summary) {
      rec.statusEl.textContent = 'no data';
      rec.detailEl.appendChild(el('div', 'muted', 'Run produced no summary (it may have crashed).'));
      return;
    }
    const t = summary.totals || {};
    rec.statusEl.textContent = summary.outcome === 'PASS' ? '✔ PASS' : '✘ FAIL';
    const totals = el('div', 'card-totals');
    totals.textContent =
      `${t.totalFailed || 0} failed / ${t.totalTests || 0} tests · ` +
      `${t.totalPassed || 0} passed · ${t.totalPending || 0} pending · ${summary.duration || ''}`;
    rec.detailEl.appendChild(totals);

    for (const fs of summary.failedSpecs || []) {
      const block = el('div', 'failed-spec');
      const title = el('div', 'failed-spec-title');
      title.textContent = `✘ ${fs.spec} (${fs.failures})`;
      block.appendChild(title);
      for (const test of fs.tests || []) {
        block.appendChild(el('div', 'failed-test', '• ' + test));
      }
      // Artifacts: video for the spec, screenshots per failing test.
      const links = el('div', 'artifacts');
      const base = specBase(fs.spec);
      const videoUrl = `/artifacts/videos/${code}/${encodeURIComponent(base)}.mp4`;
      const vidToggle = el('button', 'link-btn', '▶ video');
      vidToggle.addEventListener('click', () => {
        if (block.querySelector('video')) {
          block.querySelector('.video-wrap').remove();
          return;
        }
        const wrap = el('div', 'video-wrap');
        const v = el('video');
        v.controls = true;
        v.src = videoUrl;
        v.onerror = () => {
          wrap.innerHTML = '';
          wrap.appendChild(el('div', 'muted', 'Video not found (videos are saved per run).'));
        };
        wrap.appendChild(v);
        block.appendChild(wrap);
      });
      links.appendChild(vidToggle);

      for (const test of fs.tests || []) {
        // Sidecar titles join describe/it segments with " › " for display, but
        // Cypress names screenshot files with " -- " between segments.
        const fileTitle = test.split(' › ').join(' -- ');
        const shotUrl =
          `/artifacts/screenshots/${code}/${encodeURIComponent(base)}/` +
          encodeURIComponent(`${fileTitle} (failed).png`);
        const a = el('a', 'link-btn', '🖼 screenshot');
        a.href = shotUrl;
        a.target = '_blank';
        a.rel = 'noopener';
        a.title = test;
        links.appendChild(a);
      }
      block.appendChild(links);
      rec.detailEl.appendChild(block);
    }
  }

  // ── run control ──────────────────────────────────────────────────────────────
  function resetCardsFor(codes) {
    $('#cards').innerHTML = '';
    cards.clear();
    for (const c of codes) {
      const rec = makeCard(c);
      rec.statusEl.textContent = 'queued';
    }
  }

  function setRunning(on) {
    running = on;
    updateRunButton();
    $('#rerun-btn').hidden = on || !hasFailures();
    $('#stop-btn').hidden = !on;
    $('#stop-btn').disabled = false;
    $('#status-line').textContent = on
      ? 'Running… leave this open. Each store takes several minutes.'
      : 'Run finished. See cards below.';
  }

  function hasFailures() {
    return Object.values(lastSummaries).some(
      (s) => s && s.totals && (s.totals.totalFailed || 0) > 0
    );
  }

  async function postRun(payload, codes) {
    resetCardsFor(codes);
    $('#log').textContent = '';
    $('#log-box').open = true;
    setRunning(true);
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Dashboard-Token': DASHBOARD_TOKEN },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      $('#status-line').textContent = err.error || 'Could not start the run.';
      setRunning(false);
    }
  }

  $('#run-btn').addEventListener('click', () => {
    const sel = selectedStores();
    if (!sel.length) return;
    postRun({ stores: sel }, sel);
  });

  $('#stop-btn').addEventListener('click', async () => {
    if (!confirm('Stop the current test run? Stores still in progress will have no results.')) return;
    $('#stop-btn').disabled = true;
    $('#status-line').textContent = 'Stopping… waiting for the test processes to close.';
    try {
      await fetch('/api/stop', { method: 'POST', headers: { 'X-Dashboard-Token': DASHBOARD_TOKEN } });
    } catch (e) {
      $('#stop-btn').disabled = false;
    }
  });

  $('#exit-btn').addEventListener('click', async () => {
    if (!confirm('Exit the dashboard? This stops any running tests and closes the dashboard window.')) return;
    if (es) es.close(); // stop SSE auto-reconnect before the server goes away
    try {
      await fetch('/api/exit', { method: 'POST', headers: { 'X-Dashboard-Token': DASHBOARD_TOKEN } });
    } catch (e) {
      /* server may already be gone */
    }
    document.body.innerHTML =
      '<div class="shutdown-msg">✔ Dashboard stopped.<br /><span>You can close this tab.</span></div>';
  });

  $('#rerun-btn').addEventListener('click', () => {
    const specsByStore = {};
    for (const [code, s] of Object.entries(lastSummaries)) {
      if (s && s.failedSpecs && s.failedSpecs.length) {
        specsByStore[code] = s.failedSpecs.map((f) => f.spec);
      }
    }
    const codes = Object.keys(specsByStore);
    if (!codes.length) return;
    postRun({ specsByStore }, codes);
  });

  // ── SSE stream ───────────────────────────────────────────────────────────────
  function appendLog(text) {
    const log = $('#log');
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.textContent += text + '\n';
    if (atBottom) log.scrollTop = log.scrollHeight;
  }

  function connectStream() {
    es = new EventSource('/api/stream');
    es.addEventListener('hello', (e) => {
      const d = JSON.parse(e.data);
      if (d.running) setRunning(true);
    });
    es.addEventListener('line', (e) => appendLog(JSON.parse(e.data).text));
    es.addEventListener('run-start', () => setRunning(true));
    es.addEventListener('store-start', (e) => setCardRunning(JSON.parse(e.data).store));
    es.addEventListener('store-done', (e) => {
      const d = JSON.parse(e.data);
      lastSummaries[d.store] = d.summary;
      setCardDone(d.store, d.summary);
    });
    es.addEventListener('run-done', (e) => {
      const d = JSON.parse(e.data);
      if (d.summaries) {
        Object.assign(lastSummaries, d.summaries);
        for (const [code, s] of Object.entries(d.summaries)) {
          if (cards.has(code)) setCardDone(code, s);
        }
      }
      setRunning(false);
    });
    es.addEventListener('run-stopped', (e) => {
      const d = JSON.parse(e.data);
      if (d.summaries) Object.assign(lastSummaries, d.summaries);
      // Any card still queued/running never finished — mark it stopped.
      for (const [, rec] of cards) {
        const st = rec.statusEl.textContent;
        if (st === 'queued' || st === 'running…') {
          rec.root.className = 'card stopped';
          rec.statusEl.textContent = 'stopped';
          rec.detailEl.innerHTML = '';
          rec.detailEl.appendChild(el('div', 'muted', 'Run was stopped before this store finished.'));
        }
      }
      setRunning(false);
      $('#status-line').textContent = 'Run stopped. You can start a new run.';
    });
    es.onerror = () => {
      /* EventSource auto-reconnects */
    };
  }

  // ── history ──────────────────────────────────────────────────────────────────
  async function loadHistory() {
    const box = $('#history');
    box.textContent = 'Loading…';
    const runs = await (await fetch('/api/history')).json();
    if (!runs.length) {
      box.textContent = 'No runs recorded yet.';
      return;
    }
    box.innerHTML = '';
    for (const run of runs) {
      const d = el('details', 'hist-run');
      const s = el('summary');
      const badge = el('span', 'hist-badge ' + (run.outcome === 'PASS' ? 'pass' : 'fail'));
      badge.textContent = run.outcome || '—';
      s.appendChild(badge);
      s.appendChild(
        el('span', 'hist-line', ` ${run.store.toUpperCase()} · ${run.timestamp} · ${run.duration || ''}`)
      );
      d.appendChild(s);
      if (run.totalsText) d.appendChild(el('div', 'hist-totals', run.totalsText));
      for (const spec of run.specs) {
        const row = el('div', 'hist-spec ' + (spec.outcome === 'PASS' ? 'pass' : 'fail'));
        row.textContent = `${spec.outcome}  ${spec.spec}  —  ${spec.stats}`;
        d.appendChild(row);
      }
      box.appendChild(d);
    }
  }
  $('#refresh-history').addEventListener('click', loadHistory);

  // ── boot ─────────────────────────────────────────────────────────────────────
  loadStores();
  connectStream();
  // Load any results from a previous run so cards aren't empty on first open.
  fetch('/api/results/latest')
    .then((r) => r.json())
    .then((d) => {
      running = d.running;
      lastSummaries = d.summaries || {};
      updateRunButton();
    })
    .catch(() => {});
})();
