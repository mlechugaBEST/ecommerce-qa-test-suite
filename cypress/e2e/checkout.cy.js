import { makeConsoleErrorSpy } from '../support/checks.js';
import { CheckoutPage } from '../support/pages/CheckoutPage.js';
import { checkoutCredentials, NO_CHECKOUT_CREDENTIALS } from '../support/utils/checkoutCredentials.js';
import { isPlaceOrder, NOT_ARMED } from '../support/utils/orderGuard.js';
import { placeOrderWithStoreCredit } from '../support/utils/placeOrder.js';
import {
  getStore, describeIfStore, itIfStore, storePath, storePersona,
  checkoutConfig, pdpSelectors,
} from '../support/store.js';

const site = getStore();
const checkout = checkoutConfig(); // null on stores that carry "checkout": null
const creds = checkout ? checkoutCredentials() : null;
const pdpSel = pdpSelectors();

/**
 * The customer purchase funnel, driven on the LIVE storefront: add to cart -> /checkout -> sign in
 * as the QA customer -> shipping address -> shipping method -> STOP at the payment step.
 *
 * The test above NEVER submits an order: CheckoutPage has no placeOrder() method, so it does not
 * hold the capability, and the order guard in support/e2e.js blocks BigCommerce's two
 * order/payment endpoints outright as a second line of defense.
 *
 * A nested suite at the foot of this file DOES place a real order, paid from the QA customer's
 * store credit. It is skipped on every ordinary run and cannot be started from the launchers or
 * the dashboard — see its own comment block, and MAINTENANCE.md §8b for the cleanup it creates.
 *
 * GATE LAYERS, each saying something different and only some of them actionable:
 *   1. describeIfStore(checkout, …)  -> "[skipped: not configured for ADAP]" — store not onboarded
 *   2. itIfStore(creds, …, reason)   -> "[skipped: checkout credentials not on this machine …]"
 *   3. itIfStore(… isPlaceOrder(), …, NOT_ARMED) -> "[skipped: order placement not armed …]"
 * (1) is a fact about the store, (2) about the machine, (3) about the command — so they read
 * differently on purpose.
 */
describeIfStore(checkout, 'Checkout (through to the payment step)', () => {
  // COLLECTION-TIME TRAP: Mocha still EVALUATES a describe.skip body in order to collect its
  // pending tests, so a suite-level `checkout.product` dereference would throw on the eight stores
  // where checkout is null — turning a clean "[skipped: not configured for ADAP]" into a spec-load
  // crash. Every dereference below therefore sits inside a hook or an it().
  const page = new CheckoutPage();
  let persona;
  let consoleErrors;
  // Physical line-item count captured right after Add to Cart, used as the baseline for the
  // post-sign-in "the basket did not change" assertion.
  let cartLineItems;
  // BigCommerce's checkout id IS the cart id (verified live), so this one value addresses both
  // /api/storefront/carts/<id> and /api/storefront/checkouts/<id>.
  let cartId;

  /**
   * Deletes every cart this browser session owns, via BigCommerce's Storefront API.
   *
   * VERIFIED LIVE on BESTUS: GET /api/storefront/carts answers 200 with [] when there is no cart,
   * and an array of { id, lineItems, … } when there is. cy.request shares the browser cookie jar,
   * so the session token that owns the cart rides along automatically — no storefront token, API
   * account or key needed.
   *
   * cy.request here is safe ONLY because this is an /api/ path. This storefront answers 406 to any
   * HTML route requested with cy.request's default wildcard Accept header (verified live: GET
   * /checkout with the wildcard Accept -> 406, with Accept:text/html -> 302). Never point
   * cy.request at an HTML route on this store.
   *
   * storePath() is deliberately NOT applied: visitQuery is a cy.visit quirk (AAP's
   * ?redirect=disable), not an API concern.
   *
   * failOnStatusCode:false throughout — cleanup must never be the thing that fails a run.
   */
  function clearAllCarts(label) {
    cy.request({ method: 'GET', url: '/api/storefront/carts', failOnStatusCode: false })
      .then((res) => {
        const carts = res.status === 200 && Array.isArray(res.body) ? res.body : [];
        carts.forEach((cart) => {
          cy.request({
            method: 'DELETE',
            url: `/api/storefront/carts/${cart.id}`,
            failOnStatusCode: false,
          });
        });
        // Logged unconditionally, including the zero case. Silence would be ambiguous — it could
        // mean "nothing to clean" or "this hook never ran", and the difference matters: a cart left
        // on a signed-in account is what triggers BigCommerce's abandoned-cart email.
        cy.task('log', `[checkout.cy.js] ${label}: deleted ${carts.length} cart(s)`);
      });
  }

  /**
   * Polls the cart API until it holds `n` cart(s).
   *
   * cy.request is NOT a retriable command, so `.its('body').should('have.length', n)` would
   * re-assert against the same frozen response forever — it cannot wait for an add-to-cart that is
   * still in flight. Hence an explicit bounded poll. Returns a Cypress chainable, never a bare
   * promise (see the async-safety rule at the foot of support/e2e.js).
   */
  function waitForCarts(n, attempt = 0) {
    return cy.request({ url: '/api/storefront/carts', failOnStatusCode: false }).then((res) => {
      const carts = Array.isArray(res.body) ? res.body : [];
      if (carts.length === n) return undefined;
      if (attempt >= 20) {
        throw new Error(`expected ${n} cart(s) after Add to Cart, still ${carts.length} after ~10s`);
      }
      cy.wait(500);
      return waitForCarts(n, attempt + 1);
    });
  }

  // NOTE for anyone tempted to re-add an "also clear the account's saved cart" step here (an
  // earlier draft of this spec had one, doing a request-level login to /login.php before the guest
  // flow): it was removed because it cannot work and was not needed. BigCommerce carts are
  // SESSION-scoped, so a freshly-logged-in API session cannot see a cart left behind by a previous
  // browser session — measured directly: a signed-in API call returned [] while a Cypress-session
  // cart was live. Across every run it reported "deleted 0 cart(s)", and the extra line item that
  // originally motivated it turned out to be the product's own latch component, not a merged cart.
  // It also put the password through a cy.request body for no benefit. The afterEach cleanup below
  // is what actually prevents orphans, and the post-sign-in basket assertion is what would catch a
  // merge loudly if BigCommerce ever starts doing one.

  before(() => {
    cy.fixture('personas').then((p) => { persona = storePersona(p.primary); });
  });

  afterEach(() => {
    // Runs even when the flow failed mid-way (Mocha runs afterEach regardless), which is the point.
    // This is not tidiness: an abandoned cart is what BigCommerce's Abandoned Cart Saver mails on,
    // so leaving one behind every run would eventually spam the QA account.
    //
    // afterEach, NOT after(). This looks interchangeable and is not — measured, not reasoned:
    // with the identical body in after() this logged "deleted 0 cart(s)" while afterEach logs
    // "deleted 1 cart(s)". Cypress has already torn the session down by the time an after() all-hook
    // runs, so the cy.request there goes out on a fresh anonymous session, finds no cart, and the
    // cleanup silently does nothing. Because BigCommerce carts are session-scoped, the orphan is
    // then invisible even to a later signed-in API call — so the failure mode leaves no trace and
    // looks exactly like success. That is why clearAllCarts logs its count unconditionally,
    // including zero: the zero is the tell.
    clearAllCarts('after-cleanup');
  });

  /**
   * ONE self-contained it(), with testIsolation left at its default (true). This runs against the
   * mobile-spec habit on purpose.
   *
   * The global retries:{runMode:2} exists to absorb live-site flake, and Mocha retries ONLY the
   * failed it() — before/after all-hooks do not re-run. So a multi-it funnel would retry step 4
   * against whatever the failed attempt left behind: meaningless at best, spuriously green at
   * worst, and with testIsolation:false a retried add-to-cart step would put a SECOND line item in
   * the cart and quote shipping for the wrong basket. A single it() that owns its own setup makes
   * a retry a genuine clean re-attempt, which is the semantics runMode:2 was configured for.
   *
   * Reporting granularity is recovered with cy.task('log') breadcrumbs rather than separate tests:
   * cy.task reaches real stdout and the dashboard log pane (unlike cy.log, invisible in headless
   * `cypress run`), so the last breadcrumb before a failure localizes it just as well as a test
   * title would — without the state coupling.
   */
  /**
   * Steps 1 to 5b of the funnel — everything up to, but not including, the payment step. Shared by
   * the ordinary stop-at-payment test and the armed order-placement test so the two can never
   * drift into testing different journeys.
   *
   * Returns the console-error spy it installed. RETURNED RATHER THAN ASSIGNED to the describe-level
   * `consoleErrors`: two tests now run this funnel, and a shared binding would silently re-point
   * the console-error assertion at whichever funnel happened to run last. Each caller keeps its own.
   *
   * @param {number} total — how many steps the CALLER has, purely for the breadcrumb denominator.
   */
  function runFunnelToPayment(total) {
    // Reset the carry-over state explicitly. These are describe-scoped (the afterEach and the
    // console test read them), so on a retry they still hold the failed attempt's values — and a
    // stale cart id is worse than an absent one, because it addresses a real-looking resource that
    // no longer exists.
    cartId = undefined;
    cartLineItems = undefined;

    const spy = makeConsoleErrorSpy({ ignore: checkout.consoleIgnore || [] });
    // cy.on rather than cy.visit's onBeforeLoad because this flow navigates at least twice
    // (PDP -> /checkout), and possibly a third time if sign-in turns out to be a real page load.
    // cy.on re-attaches the spy to every window this test loads and is auto-removed at the end of
    // the test; an { onBeforeLoad } option would only cover the one visit it is passed to.
    cy.on('window:before:load', spy.onBeforeLoad);

    // 1/6 — clean slate. Delete the server-side cart FIRST, then drop the session: clearing
    // cookies alone would orphan the cart in the BigCommerce admin as an abandoned cart rather
    // than removing it.
    cy.task('log', `[checkout.cy.js] 1/${total} clearing cart + session`);
    clearAllCarts('before-cleanup');
    cy.clearCookies();
    cy.clearLocalStorage();

    // 2/6 — add the configured product. A deterministic slug, NOT pickRandom(): this flow needs a
    // product that is priced, in stock, option-free and parcel-shippable every single run, which
    // is a stricter contract than pdp.popular's.
    const pdpUrl = storePath(checkout.product);
    cy.task('log', `[checkout.cy.js] 2/${total} product under test: ${pdpUrl}`);
    cy.log(`**Checkout product:** ${pdpUrl}`);
    cy.visit(pdpUrl);
    if (checkout.quantity > 1) {
      cy.get(pdpSel.qtyInput).clear({ force: true }).type(String(checkout.quantity), { force: true });
    }
    cy.get(pdpSel.addToCart).should('be.visible').and('not.be.disabled').click({ force: true });
    waitForCarts(1);
    // Record what the cart actually looks like straight after Add to Cart, so the post-sign-in
    // check can assert "unchanged" rather than a hardcoded count. Also names the line items in the
    // run log, which is what tells you WHY a count is what it is when onboarding a new store.
    cy.request('/api/storefront/carts?include=lineItems.physicalItems')
      .then((res) => {
        const cart = res.body[0];
        const items = cart.lineItems.physicalItems;
        cartId = cart.id;
        cartLineItems = items.length;
        cy.task('log',
          `[checkout.cy.js]   cart holds ${items.length} physical line item(s): ` +
          items.map((i) => `${i.quantity}x ${i.name}`).join(' | '));
      });

    // 3/6 — checkout. VERIFIED LIVE: /checkout 302s to /cart.php when the cart is empty, so the
    // waitForCarts(1) above is load-bearing, not decorative.
    cy.task('log', `[checkout.cy.js] 3/${total} opening checkout`);
    page.visit();
    cy.location('pathname').should('not.include', 'cart.php');
    page.assertCustomerStep();

    // 4/6 — sign in.
    cy.task('log', `[checkout.cy.js] 4/${total} signing in`);
    page.signIn(creds.email, creds.password);
    page.assertSignedIn(creds.email);
    // Signing in MERGES any cart persisted against the account into the guest cart, so a cart left
    // behind by an earlier run that died before its after() hook would arrive here as extra line
    // items — and the shipping quote, and the rest of the flow, would then be testing a different
    // basket than the one this spec built.
    //
    // Compared against the count captured BEFORE sign-in rather than a hardcoded 1, deliberately: a
    // single catalog product does not necessarily mean a single line item (this store's access door
    // carries a Lock/Latch component that rides along as its own zero-price physical line — the UI
    // says "1 Item" while the API returns 2). Hardcoding a number would encode one product's
    // packaging into the spec and break on the next store onboarded. What actually matters is that
    // signing in did not CHANGE the basket, which is exactly what this asserts.
    cy.request('/api/storefront/carts?include=lineItems.physicalItems')
      .its('body.0.lineItems.physicalItems')
      .should((items) => {
        expect(items, 'cart line items are unchanged by signing in').to.have.length(cartLineItems);
      });

    // 5a/6 — shipping address. Split from the method step so the run log says which half failed
    // without anyone having to open the video: the address fill and the carrier quote fail for
    // completely different reasons and are fixed in different places.
    cy.task('log', `[checkout.cy.js] 5a/${total} shipping address`);
    page.fillShippingAddress(persona);
    // The spec types its own address rather than accepting whichever one the shared QA account has
    // saved, so this is what proves the typing actually took. checkout-js has been seen to revert
    // to a saved address SILENTLY after an internal error — without this guard such a run stays
    // green while quoting shipping for a stranger's address.
    page.assertAddressHeld(persona);

    // 5b/6 — shipping method.
    cy.task('log', `[checkout.cy.js] 5b/${total} shipping method`);
    page.selectShippingMethod();
    page.submitShipping();
    // The server's view of the address, not the form's: the collapsed shipping step renders the
    // postcode the quote was actually made against.
    page.assertShippingSummary(persona);
    // Normally a no-op: BigCommerce's billing step is skipped because #sameAsBilling is checked by
    // default (on BESTUS the billing continue button is not even rendered). Only acts if this
    // store's checkout actually stops there.
    page.continueBillingIfBlocking();

    return spy;
  }

  itIfStore(creds, 'adds a product, signs in, and reaches the payment step', () => {
    consoleErrors = runFunnelToPayment(6);

    // 6/6 — STOP. Assert the payment step rendered; never submit it.
    cy.task('log', '[checkout.cy.js] 6/6 payment step reached — stopping here');
    page.assertPaymentStep();
    // Cheap second signal: /checkout/order-confirmation is the SDK's verified post-order URL, so
    // never reaching it is independent proof that no order was placed.
    cy.location('pathname').should('not.include', 'order-confirmation');

    page.assertPaymentOptions();

    // The server's view of what would be billed and shipped. Everything above this line asserts
    // what the theme RENDERED; this asserts what BigCommerce would actually act on, which is a
    // different question and the one that matters.
    //
    // WRAPPED IN cy.then() AND NOT OPTIONAL. The test body runs synchronously to ENQUEUE commands
    // before any of them execute, so a bare page.readCheckout(cartId) would capture whatever
    // cartId held at enqueue time: undefined on the first attempt, and — because cartId is
    // describe-scoped so the afterEach can still see it — the PREVIOUS attempt's already-deleted
    // cart on a retry. That cost a real debugging cycle: it surfaces as a 401 from
    // /api/storefront/checkouts/<a valid-looking uuid>, which reads like an auth problem rather
    // than a stale id. cy.then defers the read to execution time, after step 2 has assigned it.
    cy.then(() => page.readCheckout(cartId)).then((state) => {
      cy.task('log',
        `[checkout.cy.js]   checkout totals: subtotal ${state.subtotal} + shipping ` +
        `${state.shippingCostTotal} + handling ${state.handlingCostTotal} + tax ${state.taxTotal} ` +
        `- discount ${state.totalDiscount} = grand ${state.grandTotal} ` +
        `(outstanding ${state.outstandingBalance}, store credit applied ` +
        `${state.isStoreCreditApplied})`);

      // The strongest "no order was placed" signal available, and independent of the URL check
      // above: BigCommerce populates orderId only once an order exists.
      expect(state.orderId, 'no order has been created').to.equal(null);

      expect(state.cart.lineItems.physicalItems,
        'the basket reaching payment is the one this spec built').to.have.length(cartLineItems);

      // A shipped order with no carrier cost means the quote silently fell out.
      expect(state.shippingCostTotal, 'shipping was quoted and carried into the total')
        .to.be.greaterThan(0);
      expect(state.grandTotal, 'the order has a payable total').to.be.greaterThan(0);
      expect(state.taxTotal, 'tax is a number, not absent').to.be.at.least(0);

      // Totals reconcile. Verified live to hold exactly on BESTUS (0 + 26.04 + 0 + 2.15 - 0 =
      // 28.19), but compared with a half-cent tolerance because these are floats. This is what
      // catches a shipping or tax component that renders in its own row yet never reaches the
      // amount the customer is charged.
      //
      // NO subtotal ASSERTION, ON PURPOSE. The IDENTITY is what is under test, not any one term,
      // so it holds unchanged whatever the subtotal is. On BESTUS that subtotal is legitimately 0
      // — the QA customer's group carries a price list zeroing the product (listPrice/salePrice 0
      // against an originalPrice of 180.69), so what is payable is shipping + tax. A store whose
      // QA group does not zero the product (BESTCA) reconciles identically with a non-zero
      // subtotal. Do NOT "fix" either case by asserting on subtotal — that would encode one
      // store's customer-group pricing into a spec all nine share.
      const parts = state.subtotal + state.shippingCostTotal + state.handlingCostTotal
        + state.taxTotal - state.totalDiscount;
      expect(Math.abs(parts - state.grandTotal),
        `components (${parts}) reconcile with grandTotal (${state.grandTotal})`).to.be.lessThan(0.005);

      // Guarded like assertAddressHeld: on the saved-address fallback the spec typed nothing, so
      // there is no expectation to hold it to.
      if (page.usingSavedAddress) {
        cy.task('log',
          '[checkout.cy.js]   fallback path — skipping the server-side address assertions');
        return;
      }
      const consignment = state.consignments[0];
      expect(consignment, 'the order has a consignment to ship').to.exist;
      // The server-side counterpart to assertAddressHeld(): that check proves the form still holds
      // the typed address, this proves BigCommerce accepted it for the actual shipment.
      expect(consignment.address.postalCode, 'ships to the postcode this spec typed')
        .to.equal(persona.zip);
      expect(consignment.address.city, 'ships to the city this spec typed').to.equal(persona.city);
      // selectShippingMethod() checked a radio; this is proof the selection reached the server
      // rather than only the DOM.
      expect(consignment.selectedShippingOption, 'a shipping method is selected server-side')
        .to.include.keys('id', 'description');
    });
  }, NO_CHECKOUT_CREDENTIALS);

  /**
   * Reads closure state set by the flow test above. That works under testIsolation:true because
   * Cypress resets BROWSER state between tests but never reloads the spec bundle — module and
   * closure state survive, and makeConsoleErrorSpy is closure-based for exactly this reason.
   *
   * Ships gated OFF (consoleIgnore defaults to null). BigCommerce checkout will not be
   * console-clean: expect cross-origin checkout-sdk warnings, payment-provider iframes probing for
   * wallets, and blocked GTM leaving fbq/gtag undefined in first-party inline code. Run the flow
   * live once, read what assertClean() prints, then set checkout.consoleIgnore to the triaged list.
   * Keeping the list in store config rather than checks.js keeps it per-store and data-driven.
   */
  itIfStore(
    creds && checkout.consoleIgnore !== null,
    'reaches the payment step without console errors',
    () => { consoleErrors.assertClean(); },
    creds
      ? 'checkout console noise not yet triaged for this store (checkout.consoleIgnore is null)'
      : NO_CHECKOUT_CREDENTIALS
  );

  /**
   * The armed suite: runs the same funnel and then actually buys the thing.
   *
   * DECLARED LAST ON PURPOSE. Mocha runs a suite's own tests before its nested suites, so the
   * console-error test above always reads the spy from the stop-at-payment funnel rather than this
   * one's. That ordering is load-bearing but invisible; runFunnelToPayment returning its spy
   * instead of assigning the shared binding is what keeps it merely tidy rather than critical.
   *
   * THREE GATES, all of which must hold — split across the describe and the it deliberately, so
   * each skip states the reason an operator can act on:
   *   1. checkout.placeOrder (describe) — committed per-store opt-in. NO env var can set it, which
   *      is what stops one armed command from ordering on every onboarded store when run-all.js
   *      fans a single parent env out to all nine.
   *   2. creds (it) — the machine holds the QA sign-in.
   *   3. isPlaceOrder() (it) — the CLI double gate, re-asserted from the parent process env in
   *      cypress.config.js's setupNodeEvents so cypress.env.json / CYPRESS_* / --env cannot arm it.
   *
   * Gates 2 and 3 sit on the it() because describeIfStore has no `reason` parameter — a skipped
   * describe can only say "not configured for BESTUS", which is plainly false on a store that is
   * configured and merely unarmed. itIfStore does take a reason, so that is where they go.
   *
   * OPERAND ORDER IS LOAD-BEARING: `checkout &&` must come first. This condition is evaluated at
   * collection time on ALL NINE stores, and eight of them carry "checkout": null — the same trap
   * documented at the top of this file.
   *
   * retries:0 VIA A NESTED describe, NOT VIA it(). itIfStore's signature is
   * (condition, title, fn, reason) with no options parameter, so a config object handed to it is
   * silently dropped and the test would inherit the suite-wide retries:{runMode:2} — meaning one
   * piece of live-site flake files up to THREE real orders. describeIfStore does forward options.
   * Under-retrying is the right failure direction here: a flaked armed run is cheap to re-run
   * deliberately, a duplicate order is not.
   */
  describeIfStore(
    checkout && checkout.placeOrder,
    'Order placement (real order, paid from store credit)',
    { retries: 0 },
    () => {
      itIfStore(creds && isPlaceOrder(), 'places an order and reaches the order confirmation page', () => {
        runFunnelToPayment(7);

        // 6/7 — payment step, same assertions as the unarmed path.
        cy.task('log', '[checkout.cy.js] 6/7 payment step reached');
        page.assertPaymentStep();
        page.assertPaymentOptions();

        // 7/7 — buy it. Every interlock lives inside placeOrderWithStoreCredit, which is the only
        // module in this suite that can open the order guard's window.
        cy.task('log', '[checkout.cy.js] 7/7 placing the order');
        // A GETTER, not `cartId`. The value is assigned during step 2, which has not run yet at
        // the moment this line is evaluated — see the parameter's doc comment.
        placeOrderWithStoreCredit(page, () => cartId);

        // The cart is consumed by the order, so the afterEach will report "deleted 0 cart(s)".
        // That zero is CORRECT here and means the opposite of what it means on the unarmed path,
        // where it is the documented tell for cleanup that silently did nothing.
        cy.task('log',
          '[checkout.cy.js] order placed — "after-cleanup: deleted 0 cart(s)" below is EXPECTED ' +
          '(BigCommerce consumes the cart when the order is created)');
      }, creds ? NOT_ARMED : NO_CHECKOUT_CREDENTIALS);
    }
  );
});
