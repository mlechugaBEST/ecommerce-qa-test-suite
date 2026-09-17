import { checkoutSelectors } from '../store.js';
import { isPlaceOrder, openOrderWindow, closeOrderWindow } from './orderGuard.js';

/** Matches "order #12345", "Order number 12345", "Your order number is 12345". */
const ORDER_NUMBER_RE = /order\s*(?:#|number(?:\s+is)?)\s*:?\s*(\d{3,})/i;

/**
 * Polls the confirmation page for the order number, up to ~20s.
 *
 * The wait is the point. The first armed run scraped the body the instant the URL changed and got
 * nothing — the confirmation page renders its order details asynchronously after navigation, so
 * there is a window in which the route is right and the content is not there yet. Tolerant by
 * design: it yields null rather than failing, because the order exists either way.
 */
function waitForOrderNumber(attempt = 0) {
  return cy.get('body').then(($body) => {
    const match = $body.text().match(ORDER_NUMBER_RE);
    if (match) return match[1];
    if (attempt >= 40) return null;
    cy.wait(500);
    return waitForOrderNumber(attempt + 1);
  });
}

/**
 * Submits a real BigCommerce order, paid entirely from the QA customer's store credit.
 *
 * WHY THIS IS NOT A CheckoutPage METHOD. `paymentSubmit` is already resolved and asserted visible
 * on the ordinary stop-at-payment path, so if the click lived on that class a real order would be
 * one stray `.click()` away in an object both tests hold. Keeping it in a module that must be
 * explicitly imported means the test that must never order simply does not have the capability.
 *
 * THREE INDEPENDENT INTERLOCKS, because any one of them can rot quietly:
 *   1. the CLI double gate (isPlaceOrder) plus a committed per-store opt-in,
 *   2. the server's own arithmetic — store credit applied and nothing left outstanding,
 *   3. the "Payment is not required for this order." overlay in the DOM.
 * (3) is not redundant with (2). A credit-card method stays SELECTED underneath that overlay, so
 * the day the balance no longer covers the total the overlay vanishes and this same click would
 * put a charge through a real card. Verified live Sept 15 2026 on BESTUS.
 */

/** Guarded so a credential can never reach the run log, per MAINTENANCE.md §8. */
function log(line) {
  cy.task('log', `[placeOrder] ${line}`);
}

/**
 * @param {import('../pages/CheckoutPage.js').CheckoutPage} page
 * @param {() => string} getCartId — a GETTER for the cart id (which doubles as the checkout id),
 *   deliberately not the id itself. A test body runs synchronously to ENQUEUE commands before any
 *   of them execute, so a plain `cartId` argument is read while it is still undefined — the caller
 *   then spends a while staring at a 401 for /checkouts/undefined. Taking a function makes the
 *   deferral part of the signature instead of something every call site has to remember.
 * @returns {Cypress.Chainable} yields the placed order's identifier, or null if it could not be read
 */
export function placeOrderWithStoreCredit(page, getCartId) {
  const sel = checkoutSelectors();

  // Interlock 1. Synchronous and first: refuse before touching the page at all.
  if (!isPlaceOrder()) {
    throw new Error(
      'placeOrderWithStoreCredit() reached on a run that is not armed. Order placement requires ' +
      'PLACE_ORDER=true and I_KNOW_THIS_PLACES_ORDERS=true in the parent process environment.');
  }

  // The saved-address fallback is deliberately non-fatal on the ordinary path: the run stays green
  // holding whichever address the shared QA account had saved. That is an acceptable degradation
  // for an assertion-only test and an unacceptable one here — it would ship a real physical
  // product to an address a colleague typed months ago. Hard stop.
  cy.then(() => {
    if (page.usingSavedAddress) {
      throw new Error(
        'Refusing to place an order: the shipping step fell back to a saved address, so this run ' +
        'does not control where the order would ship. Fix the address step first.');
    }
  });

  // Interlock 2 — the server's own numbers, read before submitting because the checkout resource
  // is gone the moment the order exists.
  cy.then(() => page.readCheckout(getCartId())).then((state) => {
    log(`pre-flight: grandTotal ${state.grandTotal}, outstanding ${state.outstandingBalance}, ` +
        `store credit applied ${state.isStoreCreditApplied}`);

    expect(state.orderId, 'no order exists yet for this checkout').to.equal(null);
    expect(state.isStoreCreditApplied, 'store credit is applied to this checkout').to.equal(true);
    // The whole safety case. Anything above zero means a real payment instrument would be charged
    // for the remainder — which on this storefront is a PayPal-hosted credit card.
    expect(state.outstandingBalance,
      'store credit covers the ENTIRE balance — top up the QA account\'s store credit if this ' +
      'is non-zero; do not place the order').to.equal(0);
  });

  // Interlock 3 — the DOM's own statement that no payment is required.
  if (sel.storeCreditOverlay) {
    cy.get(sel.storeCreditOverlay, { timeout: 30000 })
      .should('be.visible')
      .and('contain.text', 'Payment is not required');
  }

  // Submit. The window is opened as late as possible and shut immediately after, so the guard is
  // live for every other request this test makes.
  cy.then(() => openOrderWindow('placing an order paid from store credit'));
  cy.get(sel.paymentSubmit, { timeout: 30000 })
    .should('be.visible')
    .and('not.be.disabled')
    .click({ force: true });

  // BigCommerce navigates to the order-confirmation page on success. Generous timeout: this is a
  // real payment-and-order round trip, not a client-side transition.
  cy.location('pathname', { timeout: 120000 }).should('include', 'order-confirmation');
  cy.then(() => closeOrderWindow());

  // The order identifier, for the operator who has to cancel it by hand. Read from the URL if it
  // carries one, else from the rendered confirmation page.
  //
  // READ-ONLY, AND DELIBERATELY SO. Lifting the id out of the order endpoint's response would be
  // more direct, and was tried — see the route handler in e2e.js for why it is not worth it. The
  // submission itself must behave exactly as it does for a real customer.
  //
  // Logged, not asserted. Failing the test over an unreadable order NUMBER would be perverse when
  // the order demonstrably succeeded, and would bury the one line ops needs under a stack trace.
  return cy.location('pathname').then((pathname) => {
    const fromUrl = (pathname.match(/order-confirmation\/(\d+)/) || [])[1] || null;
    return (fromUrl ? cy.wrap(fromUrl) : waitForOrderNumber()).then((orderId) => {
      log('================================================================');
      log(`ORDER PLACED — ${orderId ? `order #${orderId}` : 'order number NOT readable'}`);
      log('CANCEL IT IN THE BIGCOMMERCE ADMIN. Check "Incomplete" orders too if a run failed.');
      if (!orderId) {
        log('Identify it as the most recent order on the QA customer account at the run timestamp.');
      }
      log('================================================================');
      return orderId;
    });
  });
}
