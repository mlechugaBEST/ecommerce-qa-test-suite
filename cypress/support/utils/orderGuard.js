/**
 * The order-submission guard's two halves: who may place an order, and the one narrow moment when
 * the network layer lets a submission through.
 *
 * Exported from a single module for the same reason isLiveSubmit() lives in zohoIntercept.js — the
 * consent check and the thing it gates must never drift apart. e2e.js registers the intercept;
 * utils/placeOrder.js is the only caller allowed to open the window.
 */

/**
 * The double gate for placing a REAL BigCommerce order, mirroring isLiveSubmit()'s shape.
 *
 * DELIBERATELY SEPARATE FROM LIVE_SUBMIT. That pair is consent to file a Zoho CRM *lead*; it has
 * never meant "spend store credit and create an order someone has to cancel by hand". Two
 * different blast radii deserve two different keys.
 *
 * Both values are coerced from the parent process env in cypress.config.js and then RE-ASSERTED
 * inside setupNodeEvents, so cypress.env.json, CYPRESS_-prefixed OS vars and `--env` cannot arm a
 * run. That matters because the dashboard can delete environment variables from the child it
 * spawns, but it cannot delete a file sitting in the repo.
 *
 * @returns {boolean}
 */
export function isPlaceOrder() {
  return Cypress.env('PLACE_ORDER') === true
    && Cypress.env('I_KNOW_THIS_PLACES_ORDERS') === true;
}

/** Skip reason for the armed suite on a normal run. Without one, describeIfStore would render
 *  "[skipped: not configured for BESTUS]" — factually wrong on a store that IS configured. */
export const NOT_ARMED =
  'order placement not armed — CLI only, run '
  + '`npm run test:checkout-order:store -- <store> --spec "cypress/e2e/checkout.cy.js"`';

// The window. Closed by default, closed again at the top of every test by e2e.js's beforeEach, and
// opened only around the single click that submits.
//
// HELD IN Cypress.env(), NOT IN A MODULE-LEVEL `let`, AND THIS IS LOAD-BEARING. Cypress compiles
// the support file and each spec file as SEPARATE webpack bundles, so a module imported by both —
// this one is, by e2e.js and by utils/placeOrder.js — is instantiated TWICE, with completely
// independent state. Measured, not reasoned: tagging each copy with a random id printed
// "support-side orderGuard instance flt0tw" and "spec-side orderGuard instance i65j2r" in the same
// run. The first armed run failed exactly here — placeOrder.js set windowOpen=true on the spec's
// copy, e2e.js's intercept read the support's copy, still false, and blocked the submission it had
// just been told to allow. `Cypress` is a genuine cross-bundle singleton, so its env store is the
// one place both halves can agree on.
//
// The same trap applies to any future state shared between a support file and a spec. Module
// scope is NOT a shared scope here.
const WINDOW_KEY = '__ORDER_WINDOW_OPEN';

// Safe as module state: both the writer (the intercept handler) and the reader (the reporting
// afterEach) live in e2e.js, so only one copy of this array is ever touched.
let allowedOrderPosts = [];

/**
 * Opens the window. Self-gating on purpose: this is the one chokepoint between a spec and a real
 * order, so it refuses rather than trusting its caller to have checked. A drifted gate must fail
 * loudly, never degrade into a no-op.
 */
export function openOrderWindow(reason) {
  if (!isPlaceOrder()) {
    throw new Error(
      'openOrderWindow() called on a run that is not armed for order placement. ' +
      'This is a bug: nothing may submit an order without PLACE_ORDER=true and ' +
      'I_KNOW_THIS_PLACES_ORDERS=true.');
  }
  Cypress.env(WINDOW_KEY, true);
  cy.task('log', `[order-guard] window OPEN — ${reason}`);
}

export function closeOrderWindow() {
  Cypress.env(WINDOW_KEY, false);
}

export function isOrderWindowOpen() {
  return Cypress.env(WINDOW_KEY) === true;
}

export function recordAllowedOrderPost(entry) {
  allowedOrderPosts.push(entry);
}

// DO NOT ADD A "capture the order id from the order response" HELPER HERE. It was tried and
// reverted (Sept 15 2026); the reasoning lives on the `return` in e2e.js's route handler, and it
// cost a real order to establish. The order id is read from the confirmation page instead — see
// utils/placeOrder.js.

/** Drains the list so the reporting afterEach sees each POST exactly once. */
export function takeAllowedOrderPosts() {
  const drained = allowedOrderPosts;
  allowedOrderPosts = [];
  return drained;
}
