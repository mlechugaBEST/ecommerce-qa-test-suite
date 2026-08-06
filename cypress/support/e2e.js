import './commands';
import 'cypress-real-events';
import '@cypress-audit/lighthouse/commands';
import { blockThirdParty, THIRD_PARTY_HOSTS, KNOWN_BUGGY_SCRIPTS } from './checks';

// Block analytics/tracking before every test. Mobile specs (testIsolation:false) also call
// blockThirdParty() in their before() hooks, since that hook runs before this beforeEach.
beforeEach(() => {
  blockThirdParty();
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

