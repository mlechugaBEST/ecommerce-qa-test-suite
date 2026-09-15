import './commands';
import 'cypress-real-events';
import '@cypress-audit/lighthouse/commands';
import { blockThirdParty, THIRD_PARTY_HOSTS, KNOWN_BUGGY_SCRIPTS } from './checks';
import { isLiveSubmit } from './utils/zohoIntercept.js';

// Block analytics/tracking before every test. Mobile specs (testIsolation:false) also call
// blockThirdParty() in their before() hooks, since that hook runs before this beforeEach.
//
// --- Stub-mode Zoho catch-all (safety net) ------------------------------------------------------
// cy.interceptZoho() only stubs the ONE url pattern a store has configured. When a live form is
// renamed, that pattern silently stops matching and the POST is no longer intercepted at all — so
// it reaches Zoho for real and creates a genuine CRM lead, in what is supposed to be stub mode.
// That is not hypothetical: BESTUS PDPs were re-pointed at BESTCAProductForm in Aug 2026 and
// product-form.cy.js filed real leads on every run until it was spotted (see CLAUDE.md).
//
// So in stub mode we also register a catch-all for ANY Zoho form submit. It is registered here, in
// a global beforeEach, which runs BEFORE the per-spec cy.interceptZoho() inside the test body.
// Cypress matches routes in reverse order of definition, so on a healthy store the later, narrower
// named intercept still wins and aliases behave exactly as before — verified empirically, not
// assumed. On drift the catch-all absorbs the POST instead: no lead is created, while
// cy.wait('@submit') still times out and the test still fails, so the red signal is unchanged.
//
// KNOWN GAP: cy.expectNoSubmission() also watches the named alias, so it still passes vacuously
// when a pattern is stale. The catch-all neither helps nor hurts there; the happy-path failure in
// the same spec is what surfaces the drift.
let absorbedZohoPosts = [];

// --- Order-submission guard (ALWAYS ON) ---------------------------------------------------------
// checkout.cy.js drives a real BigCommerce checkout on a LIVE storefront, signed in as a real
// customer, and deliberately stops at the payment step. This guard is what keeps that contract true
// through future edits: rather than trusting a spec (or a later edit to one, or a stray Enter on a
// focused form) never to submit, an order submission is made impossible to honor at the network
// layer. Test orders here are recoverable — they don't reach fulfilment and the team knows they're
// from a test account — so a trip is a "fix the spec" signal, not an incident.
//
// UNCONDITIONAL, and registered BELOW blockThirdParty() but ABOVE the isLiveSubmit() early return
// further down. LIVE_SUBMIT + I_KNOW_THIS_IS_LIVE is the operator's consent to file a real Zoho
// CRM *lead*; it has never meant "place an order", and nothing in the launchers or dashboard offers
// order consent. Registering this after that early return would disarm it in precisely the mode
// where an order is possible. Same reasoning as checks.js's /recaptcha/ THIRD_PARTY_HOSTS entry,
// which also deliberately applies in live mode.
//
// PATTERNS VERIFIED, NOT GUESSED: grepped out of the live checkout-sdk bundle
// (checkout-sdk.bigcommerce.com/v1/checkout-sdk-*.js, Sept 2026). Those are the only two
// submission endpoints it carries. Earlier drafts of this list also had /api/storefront/orders,
// /api/storefront/checkouts/*/orders and finishorder.php — none appear anywhere in the bundle, so
// they were a guard that would have caught nothing while reading as though it covered everything.
//
// NO INTERACTION WITH THE ZOHO CATCH-ALL: these patterns are disjoint from
// **/forms.zohopublic.com/**/submit, so Cypress's reverse-order route matching is untouched and the
// later, narrower per-spec cy.interceptZoho() alias still wins for Zoho POSTs exactly as before.
const ORDER_SUBMIT_PATTERNS = [
  '**/internalapi/v1/checkout/order*',  // checkout-sdk order submission
  '**/api/public/v1/orders/payments*',  // payment submission
];
let blockedOrderPosts = [];

beforeEach(() => {
  blockThirdParty();

  blockedOrderPosts = [];
  ORDER_SUBMIT_PATTERNS.forEach((pattern) => {
    cy.intercept('POST', pattern, (req) => {
      // Strictly synchronous. A route handler that returns a promise it leaves rejected surfaces as
      // "An error was thrown in your route handler" and kills the hook — the same class of failure
      // documented at the foot of this file for AUT-frame code. No async, no promise construction.
      //
      // reply(503) rather than req.destroy(): both guarantee zero bytes reach BigCommerce, but a
      // destroyed socket surfaces in the SPA as an opaque network error that looks like real flake
      // in the video, and some SDK paths retry it silently. An explicit 5xx with a self-describing
      // body renders as a visible checkout error, so the screenshot says why.
      blockedOrderPosts.push(`${req.method} ${req.url}`);
      req.reply({
        statusCode: 503,
        body: { title: 'Blocked by the QA harness — this suite never submits an order.' },
        headers: { 'content-type': 'application/json' },
      });
    });
  });

  absorbedZohoPosts = [];
  if (isLiveSubmit()) return; // never intercept when the operator has explicitly opted into live

  cy.intercept('POST', '**/forms.zohopublic.com/**/submit', (req) => {
    absorbedZohoPosts.push(req.url);
    req.reply({
      statusCode: 200,
      body: '<html><body>Thank you for contacting us. We have received your message.</body></html>',
      headers: { 'content-type': 'text/html' },
    });
  });
});

// cy.task reaches real process stdout, so this shows up in a terminal run and in the dashboard log
// pane — unlike cy.log(), which is invisible in headless `cypress run`.
afterEach(() => {
  if (!absorbedZohoPosts.length) return;
  const urls = [...new Set(absorbedZohoPosts)].join(', ');
  cy.task('log',
    `[zoho-catchall] absorbed ${absorbedZohoPosts.length} Zoho POST(s) that no named intercept ` +
    `matched — this store's submitUrlPattern no longer matches the live form. No lead was ` +
    `created. Absorbed: ${urls}`);
});

// Deliberately a SECOND afterEach rather than an addition to the one above: that hook opens with
// `if (!absorbedZohoPosts.length) return;`, so anything appended to it would be skipped on every
// run where no Zoho POST was absorbed — i.e. essentially always, which is exactly when this needs
// to fire.
afterEach(() => {
  if (!blockedOrderPosts.length) return;
  const urls = [...new Set(blockedOrderPosts)].join(', ');
  cy.task('log',
    `[order-guard] BLOCKED ${blockedOrderPosts.length} order-submission POST(s) — a spec reached ` +
    `BigCommerce's order endpoint. No order was created and no payment was taken. ` +
    `Blocked: ${urls}`);
  // Queued via cy.then, not thrown inline: a synchronous throw here would abort the command queue
  // BEFORE the cy.task('log') above ever runs, losing the one line that names the URL.
  cy.then(() => {
    throw new Error(
      `Order-submission guard tripped: ${blockedOrderPosts.length} POST(s) to ${urls}. ` +
      `checkout.cy.js must stop at the payment step and must never submit an order.`);
  });
});

// --- BRH document-ready theme bugs --------------------------------------------------------------
// BRH's own theme JS has MULTIPLE bugs in its jQuery document-ready callbacks — it calls .trim() on
// an undefined value while iterating headings, and calls `$(...)` when `$` is not a function, both
// throwing on BRH pages (first-party theme bugs — see stores/brh.json _notes; BRH devs notified).
// jQuery processes `.ready()`/Deferred callbacks asynchronously via `window.setTimeout`, and when a
// ready callback throws, the error propagates out of that timer as an uncaught error. Confirmed
// live (multiple fresh runs) that these do NOT reach the uncaught:exception handler below in any
// suppressible way (neither message nor stack match there, nor a capture-phase error listener). So
// instead of catching the error after it's uncaught, we prevent it: window:before:load runs in the
// fresh AUT window before any page script, and here we wrap that window's setTimeout so a throw
// from inside the jQuery-driven ready/Deferred chain is caught in the timer callback and never
// becomes uncaught. Scoped by STACK (not message) to exactly that channel — the error must have
// been thrown through jQuery (code.jquery.com frames) on a BRH theme callback (bestroofhatches.com
// frames) — so trim, "$ is not a function", and any further ready-callback bug in this same theme
// are all covered without masking an unrelated error (which would lack that jQuery+host stack).
// Remove once BRH fixes its theme scripts.
const isBrhReadyThrow = (e) => {
  const stack = (e && e.stack) || '';
  return /code\.jquery\.com/.test(stack) && /bestroofhatches\.com/.test(stack);
};
Cypress.on('window:before:load', (win) => {
  if (!/bestroofhatches\.com/.test(win.location.hostname)) return;
  const nativeSetTimeout = win.setTimeout;
  win.setTimeout = function (handler, timeout, ...rest) {
    if (typeof handler !== 'function') {
      return nativeSetTimeout.apply(this, arguments);
    }
    const guarded = function () {
      try {
        return handler.apply(this, arguments);
      } catch (e) {
        if (isBrhReadyThrow(e)) return undefined;
        throw e;
      }
    };
    return nativeSetTimeout.call(this, guarded, timeout, ...rest);
  };
});

// Suppress uncaught exceptions, but only when they're attributable to a third party (or a known,
// already-triaged first-party defect) rather than a first-party regression. Three cases:
//  1. A cross-origin script (no CORS headers) throws — the browser redacts all detail per the
//     Same-Origin Policy. Cypress wraps that redaction into its own fixed explanatory message
//     ("...error was thrown from a cross origin script...") rather than the browser's bare
//     "Script error.", so match on Cypress's wording, not the raw browser message. On these live
//     storefronts this fires constantly from vendor scripts we don't control, so it's expected
//     noise. (Note: same-origin scripts CAN also lose their stack this way — see case 3.) The
//     same SOP redaction also arrives as an unhandled REJECTION with a non-Error reject value,
//     which Cypress wraps as "An unknown error has occurred: [object Object]" — matched too.
//  2. A real, attributable error (message + stack) whose stack traces back to a known third-party
//     host blockThirdParty() stubs at the network layer (THIRD_PARTY_HOSTS).
//  3. An error matching a KNOWN_BUGGY_SCRIPTS entry — either by stack (a vendor script we
//     deliberately leave running for real, e.g. Zoho SalesIQ) or by message (a same-origin script
//     loaded as a raw external <script src>, e.g. BESTUS's tracking_code.js, whose own parse-time
//     SyntaxError comes back with no stack at all, same redacted shape as case 1).
// Anything else — including any exception with a real, attributable stack that isn't one of our
// known vendors/defects — is treated as first-party and allowed to fail the test as normal.
//
// LIMIT OF THIS HANDLER — it only ever sees APP-frame errors. Cypress binds error/unhandledrejection
// listeners on both the AUT window (frameType 'app') and the spec window (frameType 'spec'), and
// cy.onUncaughtException only emits the `uncaught:exception` event when frameType === 'app'. A
// spec-frame error fails the test unconditionally, no matter what THIRD_PARTY_HOSTS or
// KNOWN_BUGGY_SCRIPTS say — you can recognize one by its message: "originated from your test code"
// (rather than "…your application code"), and by the absence of Cypress's usual "you can choose to
// turn this off by listening to the uncaught:exception event" sentence. This bit us once: the
// makeConsoleErrorSpy fetch wrapper used to `return Promise.reject(err)` from its .catch, which
// turned Klaviyo's fire-and-forget "Failed to fetch" telemetry rejection into a spec-frame
// rejection that killed pdp.mobile's before-all hook despite the matching KNOWN_BUGGY_SCRIPTS entry.
// So: support-file code that runs inside the AUT (the fetch wrapper in checks.js, the BRH
// setTimeout wrap above) must handle its own async failures AT THE SOURCE and must never hand back
// a promise it leaves in a rejected state — this handler cannot rescue it.
Cypress.on('uncaught:exception', (err) => {
  Cypress.log({ name: 'Uncaught Error', message: err.message });
  // A redacted cross-origin failure has two shapes: a THROWN error (Cypress wording
  // ".../cross origin script/...") and an unhandled REJECTION whose reject value is a
  // non-Error object — Cypress's makeErrFromObj wraps the latter as "An unknown error has
  // occurred: [object Object]" (no "cross origin script" wording). Both are SOP-stripped of
  // all first-party detail, so both are suppressed here. (FSE: SearchSpring's cross-origin
  // Snap bundle throws `t.isImmediatePropagationStopped is not a function` on product-card
  // click → arrives as the opaque-rejection shape.) A genuine first-party regression throws
  // an Error with a real message+stack and never produces the opaque wrapper, so this stays
  // safe. See CLAUDE.md Global Setup + stores/fse.json _notes.
  const isRedactedCrossOrigin =
    /cross origin script/i.test(err.message) ||
    /an unknown error has occurred/i.test(err.message);
  const stack = err.stack || '';
  const isKnownThirdParty = THIRD_PARTY_HOSTS.some(({ pattern }) => pattern.test(stack));
  const isKnownBuggyScript = KNOWN_BUGGY_SCRIPTS.some(
    ({ stackPattern, messagePattern }) =>
      (stackPattern && stackPattern.test(stack)) ||
      (messagePattern && messagePattern.test(err.message))
  );
  return !(isRedactedCrossOrigin || isKnownThirdParty || isKnownBuggyScript);
});

