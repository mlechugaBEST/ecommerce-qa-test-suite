# Maintenance: Node.js and Cypress versions

This page is for whoever maintains the versions this test suite runs on. You do
not need to have set it up, and you do not need to have read any other file
here. Operators never touch any of this — the launchers handle it for them.

**Everything below concerns two pinned versions:**

| What | Pinned to | Set in | Supported until |
| ---- | --------- | ------ | --------------- |
| Node.js | **24.19.0** (Krypton LTS) | `NODE_PIN` in [scripts/ensure-node.bat](scripts/ensure-node.bat) | **April 30 2028** |
| Cypress | **15.15.0** | `devDependencies` in [package.json](package.json) | n/a (see below) |

---

## 1. Why these versions

**Node 24 because of its runway.** The suite needs a Node that Cypress can
actually install under, and among those, the one with the longest support life
wins — every re-pin costs a verification cycle. Node 24 is supported until April
30 2028. It replaced Node 22.23.2 (support ends April 30 2027) on **Aug 14
2026** for exactly that reason: same amount of work, twelve more months of life.

**Cypress held at 15.15.0 deliberately.** Newer 15.x releases exist (15.20.1 as
of Aug 2026). Nothing is wrong with them — the suite is simply verified against
15.15.0 across all nine stores, and a Cypress bump can shift spec behaviour, so
it is changed on its own and never in the same pass as a Node re-pin.

## 2. Which Node versions are accepted, and why not others

`:__en_gate` in `scripts/ensure-node.bat` accepts **majors 24 and 22 only**. It
is intentionally stricter than `package.json`'s `engines.node`
(`^20.1.0 || ^22.0.0 || >=24.0.0`), which only mirrors what Cypress itself
declares:

- **Node 20 is rejected** — it reached end of life April 30 2026 and receives no
  security patches. Cypress still permits it; we do not.
- **Node 26 is rejected** — it is genuinely broken here, see below.
- **Odd majors (21, 23, 25) are rejected** — never LTS.

Rejection is cheap: the operator gets a portable Node installed *inside* the
tests folder, needing no admin rights and changing nothing else on the machine.
Wrongly accepting is expensive: it hands them a broken Cypress.

### The Node 26 problem (and the one thing that will fix it)

On Node 26, `cypress install` prints `Unzipping Cypress` and then stops. It
**exits 0** while leaving no `Cypress.exe` behind, so nothing appears to have
gone wrong — the failure only surfaces at `cypress verify`. (This is why
`First Time Setup.bat` runs `cypress verify` as a separate explicit step. Do not
remove it; it is the only thing between that silent failure and a cheerful
"ALL SET!".)

The cause is Cypress 15.15.0's unzip stack: `extract-zip` 2.0.1 → `yauzl`
2.10.0, a 2017 package declaring only `engines: ">= 10.17.0"`.

**Cypress 15.16.0 replaced that stack with `yauzl` ^3.3.1**, and every release
since keeps it. So the route to supporting Node 26 (or any newer major) is:

1. Bump Cypress to ≥ 15.16.0 and re-verify the suite across the stores.
2. Run the verification procedure in section 4 against the new Node major.
3. Only if that passes, add the major to **both** `:__en_gate` *and*
   [scripts/nodeGate.js](scripts/nodeGate.js) — they are deliberate mirrors.

## 3. Verified combinations

Append to this table, never rewrite it. "Spec run" means at least one real spec
executed green against a live store.

| Date | Node | Cypress | `cypress install` | `cypress verify` | Spec run | Verdict |
| ---- | ---- | ------- | ----------------- | ---------------- | -------- | ------- |
| Aug 12 2026 | 22.23.2 | 15.15.0 | completes | passes | — | ✅ good |
| Aug 12 2026 | 26.7.0 | 15.15.0 | **dies mid-unzip, exits 0** | fails (exit 1) | — | ❌ unusable |
| Aug 14 2026 | **24.19.0** | 15.15.0 | completes | passes | `homepage.cy.js` 13/13 | ✅ **current pin** |
| Aug 14 2026 | 26.7.0 | 15.15.0 | **dies mid-unzip, exits 0**, no `Cypress.exe` | fails (exit 1) | — | ❌ re-confirmed |

### Bootstrap ladder — verified Aug 14 2026

All six rungs of `ensure-node.bat` were exercised on a real Windows 11 machine
after the re-pin. Recorded here so a successor knows what "working" looks like:

| Rung | Exercised how | Result |
| ---- | ------------- | ------ |
| 1 portable in `tools\` | pin at 24.19.0, only `node-v22.23.2-win-x64` on disk | accepted 22.23.2 via the gate-passing fallback, `PATH` survived the `call`, portable npm won over system npm |
| 2 system Node | real system Node 26.7.0 on `PATH` | rejected, exit 1, `PATH` left alone |
| 3 bundled `installers\*.zip` | zip built locally, offline | used the bundled copy, unpacked, swept a stale `node-v22.23.2` folder |
| 4 winget/MSI (opt-in) | `SETUP_MACHINE_NODE=1`, permission prompt **declined** | winget exited 0 yet installed nothing usable — the ladder **re-probed** rather than trusting that code, found only gate-rejected Node 26, downloaded the MSI, reported the declined prompt (1223), and fell through. Nothing installed machine-wide. |
| 5 download + verify | no `tools\`, no `installers\` | downloaded 34MB, SHA256 matched, unpacked, temp folder cleaned up |
| 6 manual instructions | **not tested** — needs the network genuinely down | `HTTPS_PROXY` alone will not force it, because the PowerShell fallback uses the *system* proxy and succeeds anyway (that is its purpose) |

`cypress verify`'s hash comparison was checked separately against a genuine file
(match) and a byte-flipped copy (mismatch), confirming the `skip=1` +
space-stripping handling of `certutil` output.

## 4. How to verify a candidate Node/Cypress combination

Do this in a scratch folder, never in the working checkout. The isolated
`CYPRESS_CACHE_FOLDER` is what keeps a failed attempt from corrupting the real
Cypress cache.

```bat
:: 1. Get the candidate Node as a portable zip and unpack it somewhere scratch.
::    https://nodejs.org/dist/vX.Y.Z/node-vX.Y.Z-win-x64.zip
::    Verify it against SHASUMS256.txt in the same folder before using it.

:: 2. New cmd window. Strip PATH so nothing else leaks in, then point it
::    at the candidate Node and an isolated Cypress cache.
set "PATH=%SystemRoot%\System32;%SystemRoot%;%SystemRoot%\System32\Wbem"
set "PATH=C:\scratch\node-vX.Y.Z-win-x64;%PATH%"
set "CYPRESS_CACHE_FOLDER=C:\scratch\cy-cache"
node -v

:: 3. Copy the repo WITHOUT node_modules/tools, then install.
robocopy "C:\Github\ecommerce-qa-test-suite" "C:\scratch\try" /E /XD node_modules tools installers results .git
cd /d C:\scratch\try
call npm ci

:: 4. THE test. The cache must be empty or Cypress skips the unzip and
::    proves nothing. Watch for "Unzipped Cypress" with a checkmark.
node node_modules\cypress\bin\cypress install
node node_modules\cypress\bin\cypress verify

:: 5. Confirm a real spec runs.
call npm run test:store -- bestus --spec "cypress/e2e/homepage.cy.js"
```

A candidate passes only if step 4 shows a completed unzip **and** `verify`
passes **and** step 5 is green. Note that `cypress install` exiting 0 proves
nothing on its own — check `Cypress.exe` exists.

If it passes, record it in section 3, then re-pin (section 5).

## 5. How to re-pin Node

1. `NODE_PIN` in `scripts/ensure-node.bat` — the only place the version string
   lives; the download URL, folder name and temp path all derive from it.
2. `:__en_gate` in the same file, if the accepted majors change.
3. `ACCEPTED_MAJORS` in `scripts/nodeGate.js` — keep it in step with
   `:__en_gate`.
4. Update the comment block above `:__en_gate` and section 3 here with the
   evidence and date.
5. Re-run the regression checks in section 6.

**Existing installations migrate themselves.** After a re-pin, machines that
already have the *old* portable Node keep working: `:__en_probe_portable` falls
back to any `tools\node-v*-win-x64` folder that still passes the gate, so the
launchers do not suddenly demand a re-setup. The next
`First Time Setup.bat` installs the new pin and deletes the old folder.

## 6. Regression checks after touching `ensure-node.bat`

This file is unusually easy to break in ways that only show up on someone
else's machine. After any edit, confirm:

- **No `setlocal`, no delayed expansion.** Callers reach the script via `call`
  and rely on the `PATH` it sets surviving the return. A `setlocal` would
  silently discard it.
- **`curl` / `tar` / `certutil` / `findstr` are still called by absolute
  `%SystemRoot%\System32\` path.** Git for Windows ships GNU `tar.exe`, which
  cannot read `.zip` at all and shadows Windows' bsdtar whenever its `usr\bin`
  comes first on `PATH`. (Confirmed live: GNU tar answers
  "This does not look like a tar archive" on a Node zip that `System32\tar.exe`
  reads fine.)
- **No `"cannot find the batch label specified"` in the output.** cmd's label
  lookup here proved sensitive to where labels land in the file — an earlier
  draft of `:__en_probe_portable` used two helper labels calling each other and
  cmd printed that error intermittently, appearing and disappearing as unrelated
  lines were added nearby. If you add or move a label, watch for this.
- **Version gate still behaves.** The cheapest check is a stub `node` on PATH:
  a `node.bat` containing `@echo %STUB_VER%` lets you feed the gate any version
  string with nothing installed. Run the script in **detect-only** mode (no
  `install` argument) so a rejected version cannot trigger a download. Expect
  accept for `v22.x` / `v24.x` (including `v024.19.0`, which exercises the
  leading-zero stripping, and `v24.0.0-v8-canary`), and reject for `v20.x`,
  `v25.x`, `v26.x`, a bare `v24`, garbage, and no output at all.
- **`PATH` survives and `EN_*` do not leak.** After `call scripts\ensure-node.bat`
  in a live `cmd`, `node -v` must report an accepted version, `where node` must
  list the portable copy *before* any system Node, and `set EN_` must report
  nothing.
- **A clean `First Time Setup.bat`** in a copy with no `node_modules` and no
  `tools\` must reach `ALL SET!`.

## 7. Where the dates come from

Node's support dates are published at
`https://raw.githubusercontent.com/nodejs/Release/main/schedule.json`. As of
Aug 14 2026:

| Major | Status | End of life |
| ----- | ------ | ----------- |
| 20 | end of life | 2026-04-30 |
| 22 | maintenance | 2027-04-30 |
| **24** | active LTS (maintenance from 2026-10-20) | **2028-04-30** |
| 26 | becomes LTS 2026-10-28 | 2029-04-29 |

A `DEP0205 module.register()` deprecation warning in a run's output is a useful
tell: that warning only exists on Node ≥ 26, so seeing it means the run is on a
rejected version and went around `ensure-node.bat` (usually by running
`npm run test:all` straight from a terminal instead of using a launcher).
`scripts/nodeGate.js` exists to make that visible; it warns and never blocks,
because `cypress run` itself is fine on Node 26 — only `cypress install` breaks.
