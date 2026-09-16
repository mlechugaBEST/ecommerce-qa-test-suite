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

## 8. Checkout test credentials

`checkout.cy.js` signs in as a real customer on the live storefront. It is the only
spec in this repo that needs a secret, and the only one that mutates live store
state (a cart). Policy, in short: **the password never enters the repo.**

### Where the values live

The QA team password manager. Not in `stores/*.json`, not in a `.bat`, not in a
commit message, not in a ticket. Every `.bat` in this repo is tracked by git, so
"just set it in the launcher" is the one tempting idea that must be refused.

Operators get them into a run in one of three ways, resolved **per field**, first
non-empty wins (`scripts/resolveCheckoutCredentials.js`):

1. `CHECKOUT_EMAIL_<CODE>` / `CHECKOUT_PASSWORD_<CODE>` OS env vars — CI, or a
   per-user `setx` on a shared machine.
2. `%LOCALAPPDATA%\BestAccessDoorsTests\credentials.json` — the per-user path.
   **Use this on UNC/network-share deployments**, where the repo folder itself is
   readable by everyone with share access. Same rationale as `ensure-node.bat`'s
   `EN_ALT` fallback.
3. `<repo>\credentials.json` — the ordinary local case. Gitignored.

`credentials.example.json` is the committed template and holds placeholders only —
no real email, since an email is half a credential.

Absent or half-configured credentials make the spec **skip with a stated reason**,
never fail. A machine with no secret still exits 0. A copied-but-unedited template
also skips: `REPLACE_ME`-style placeholders are treated as absent, so nobody ever
attempts a real sign-in with the literal string `REPLACE_ME`.

### Requirements for the account itself

- A dedicated test customer, not a real person's account, on a mailbox someone
  actually monitors (order/abandoned-cart mail lands there).
- **No saved payment method.** The ordinary run stops before payment and the order
  guard blocks the endpoints, but the account should be worthless if the password leaks.
  This matters more now than it used to: see the store-credit section below, where a
  *selected* credit-card method sits underneath the store-credit overlay.
- **Store credit, kept topped up** — only on a store whose config sets
  `checkout.placeOrder`. The armed order test (§8b) pays entirely from the QA
  customer's store-credit balance, and that balance is consumed by every order it
  places. On BESTUS one order costs about **$28** (the customer group's price list
  zeroes the product itself, so what is payable is shipping + tax). When the balance
  no longer covers the total the test **refuses to order and fails loudly** rather than
  falling through to a real card — but that is a stop, not a safety net you want to
  rely on. Top it up in the BigCommerce admin under the customer's **Store Credit**
  field. Every armed run logs the amount applied, so the trend is visible in the log.
- No admin rights. Assume the password is recoverable from a browser context on a
  live storefront that loads third-party scripts, and make that not matter.
- **The address book is shared, and the spec must never add to it.** `checkout.cy.js`
  types its own shipping address rather than using whichever one is saved, and keeps
  "Save this address in my address book" unchecked. It logs the saved-address count
  every run (`address book holds N saved address(es)`). N is already large — 28 on
  BESTUS as of Sept 15 2026, all from other teams' manual testing — so the number
  itself means nothing; what matters is that it does **not grow between two
  back-to-back runs**. If it does, `selectors.saveAddressCheckbox` has drifted and
  every run is now writing to a shared account.

### Rotation

1. Change it in the BigCommerce admin.
2. Update the password manager.
3. Update each machine's `credentials.json` / CI secret.

Rotate immediately if a password ever reaches a commit, a screenshot, a chat, or a
ticket. **Rotate first, clean up second** — rewriting history is cleanup, not
remediation.

### Onboarding store #2 through #9

Only after BESTUS is green, and one store at a time:

1. Confirm a QA customer account exists on that storefront; add it to the password
   manager and to `credentials.json`.
2. Verify live a `checkout.product` slug that is priced, in stock, option-free and
   parcel-shippable. This is a **stricter** contract than `products.known` /
   `pdp.popular` — a call-for-pricing or freight-only SKU quotes zero shipping
   options and stalls the flow.
3. Fill the `checkout` section per `stores/bestus.json`, replacing the `_todo`.
4. Run the spec. Expect to calibrate two things per store: `checkout.selectors`
   (theme drift) and `checkout.customFields` (store-specific required checkout
   fields — BigCommerce marks these required only in the label TEXT, never with a
   `required` attribute, and a missed one silently stops the carrier quote).
5. Leave `consoleIgnore: null` until the console noise is actually triaged.

Two stores need a judgement call first: **BRH** is `pdp.quoteOnly` with no Add to
Cart anywhere, so it may have no checkout journey at all; **PDA**'s catalog is four
placeholder products. Verify live before assuming either way.

### 8b. The armed order test, and the manual cleanup it creates

`checkout.cy.js` carries a nested suite that places a **real BigCommerce order**. It
is skipped on every ordinary run and cannot be started from the launchers or the Test
Dashboard. Arming it takes three things at once:

1. `PLACE_ORDER=true` **and** `I_KNOW_THIS_PLACES_ORDERS=true` in the **parent process
   environment** — `npm run test:checkout-order` sets both. A `cypress.env.json`,
   a `CYPRESS_`-prefixed variable or `--env` on the command line will **not** arm it:
   `cypress.config.js` re-asserts both flags from `process.env` inside `setupNodeEvents`,
   whose returned config wins over all three. (Falsified: with an armed `cypress.env.json`
   planted in the repo root, the flags still read `false`.)
2. `checkout.placeOrder` in that store's `stores/<code>.json` — a committed, reviewable
   opt-in that no environment variable can set. It exists because `run-all.js` fans one
   parent env out to all nine stores, and one armed command must not become "order on
   every onboarded store".
3. The usual checkout credentials.

**Someone has to cancel the orders.** There is no automated cleanup — cancelling would
need a Management API token, which is a new secret and a wider blast radius than the
orders themselves. So, after any armed run:

- Find the order in the BigCommerce admin against the QA customer and cancel it. The
  run log prints `[placeOrder] ORDER PLACED — order #…` and `[order-guard] ALLOWED …`
  naming the submitted URL; both reach `results/test-results.log`.
- **Check "Incomplete" orders too.** A run that fails mid-submit can leave an incomplete
  order, and the admin's default filter hides those.
- A failed armed run **may or may not** have placed an order. Check the admin before
  re-running, or you will be cancelling two. This is not hypothetical: on Sept 15 2026
  a run went red on `expected '/cart.php' to include 'order-confirmation'` and had
  nevertheless created the order — the submission succeeded server-side and only the
  post-order navigation failed. **`[order-guard] ALLOWED` in the log is the definitive
  tell that an order was submitted**, regardless of whether the test passed; the
  `[placeOrder] ORDER PLACED` banner only appears when the flow also completed.

**What cancellation does not undo:** order creation fires BigCommerce's `store/order/*`
webhooks immediately — customer confirmation email, staff notification, and anything
subscribed downstream (ERP, fulfilment, shipping, CRM). Confirm that subscriber list
with whoever owns those integrations before arming a store for the first time; the
product under test is a real physical item with a real shipping address on it.

**Three interlocks guard the click**, and all three must hold — the CLI gate above, the
server's own numbers (`isStoreCreditApplied` true and `outstandingBalance` zero, read
before submitting because the checkout resource disappears once the order exists), and
the DOM's `"Payment is not required for this order."` overlay. The third is not
redundant: a credit-card method stays **selected underneath** that overlay, so the day
store credit stops covering the balance the overlay vanishes and the same click would
charge a real card. The order-submission guard itself stays registered even on an armed
run — `utils/placeOrder.js` opens a window around the single click and shuts it again,
so every other request in the run is still guarded, and every submission that does go
out is recorded.

### Leak surfaces to keep in mind when editing

- `cy.type(password, { log: false })` and `cy.request({ …, log: false })` are
  **mandatory**. Cypress records the command log into the run video and writes a
  screenshot on failure, and no value masking exists in the 15.15 binary.
- Never pass a credential to `cy.task('log', …)`: that reaches real stdout,
  `results/test-results.log`, and the dashboard's live log pane (which streams
  child stdout to a browser).
- Never put a credential in a test title — titles are written to the run summary.
- `cypress open` renders resolved config including `env`, so one store's pair is
  visible there. Accepted and bounded: only the active store's pair is ever
  injected. `DEBUG=cypress:*` is similarly verbose — avoid it on a shared screen.
