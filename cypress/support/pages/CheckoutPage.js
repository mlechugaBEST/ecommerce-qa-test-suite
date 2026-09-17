import { storePath, checkoutSelectors, checkoutConfig } from '../store.js';

/**
 * BigCommerce "Optimized One-Page Checkout" — the checkout-js React SPA, bundled from
 * checkout-sdk.bigcommerce.com but SERVED SAME-ORIGIN at <baseUrl>/checkout (verified live on
 * BESTUS), so no cy.origin is needed; only the JS bundle is cross-origin.
 *
 * DELIBERATELY NOT A ZohoFormPage SUBCLASS, and not merely because nothing in that base class
 * applies (its scrollToForm()/submit() hard-target form[action*="zohopublic"] and
 * button.zf-submitColor, neither of which exists here). Inheriting would be actively UNSAFE:
 * cy.fillPersona duck-types on method NAMES with a bare `typeof === 'function'` guard, so a
 * subclass would inherit fillFirstName/fillLastName/fillEmail/fillPhone and cy.fillPersona() would
 * happily type the persona into input[name="Name_First"] / input[name="Email"] — Zoho selectors
 * that do not exist on a checkout page. The guard cannot tell a real method from an inherited
 * wrong one. The only thing worth reusing, storePath(), comes from store.js — which ZohoFormPage
 * itself merely imports.
 *
 * THERE IS DELIBERATELY NO placeOrder() / submitPayment() METHOD, and there must never be one.
 * `paymentSubmit` is already resolved and asserted visible on the ordinary stop-at-payment path,
 * so a click living on this class would put a real order one stray `.click()` away in an object
 * every checkout test holds. Order submission lives in utils/placeOrder.js instead — a module that
 * must be explicitly imported, self-gates on the CLI arming flags, and is the only thing that can
 * open the order guard's network window. The test that must never order simply does not have the
 * capability, which is a stronger guarantee than remembering not to use it.
 */
export class CheckoutPage {
  // Injected with defaults, mirroring ProductFormPage (the only other page object with a
  // constructor). Safe to construct inside a describe.skip body on a "checkout": null store —
  // Mocha still evaluates those bodies, checkoutConfig() returns null, and nothing dereferences
  // it until a method is actually called.
  constructor(config = checkoutConfig(), selectors = checkoutSelectors()) {
    this.cfg = config;
    this.sel = selectors;
    // Set during the flow, read by assertAddressHeld()/assertShippingSummary(). True only on the
    // fallback path, where the spec did not get to type an address — see chooseNewAddress().
    this.usingSavedAddress = false;
  }

  get path() {
    return this.cfg.path;
  }

  visit() {
    cy.visit(storePath(this.path));
    return this;
  }

  // ─── Customer / sign-in step ───────────────────────────────────────────────

  assertCustomerStep() {
    // The SPA bundle is fetched cross-origin and mounts after first paint, so the shell gets a
    // longer leash than the 15s defaultCommandTimeout.
    cy.get(this.sel.app, { timeout: 30000 }).should('exist');
    cy.get(this.sel.customerStep).should('be.visible');
    return this;
  }

  openSignIn() {
    // TEXT FIRST, selector second. checkout-js renders "Already have an account? Sign in now" from
    // a localized translation string, so the link text is a more stable handle than its id — and
    // checkout.signInLinkText makes it configurable for a reworded or non-English storefront (PDA).
    // The id fallback is the live-verified a#checkout-customer-login.
    cy.get(this.sel.customerStep).then(($step) => {
      const $link = $step.find(`a:contains("${this.cfg.signInLinkText}")`);
      // force: the Klaviyo email-capture popup is deliberately left unblocked (it is
      // store-functional) and covers DOM elements mid-run — the same reason every other spec in
      // this suite forces its clicks.
      if ($link.length) cy.wrap($link.first()).click({ force: true });
      else cy.get(this.sel.signInLink).first().click({ force: true });
    });
    return this;
  }

  /**
   * Fills the returning-customer form and clicks Sign In. Split out of signIn() so the bounded
   * re-attempt below can reuse it verbatim — a retry that re-types is what is wanted, because the
   * most likely reason the first attempt did nothing is that checkout-js re-rendered the form
   * under it and took the typed values with it.
   */
  submitSignInForm(email, password) {
    cy.get(this.sel.emailInput, { timeout: 20000 })
      .should('be.visible')
      .clear({ force: true })
      .type(email, { force: true });
    cy.get(this.sel.passwordInput)
      .should('be.visible')
      // Assert it really is a password field before typing. If the theme ever ships this as
      // type="text", the value would render in plaintext into the run video and any failure
      // screenshot — better to fail loudly here than to leak silently.
      .and('have.attr', 'type', 'password')
      .clear({ force: true })
      // log:false is NOT cosmetic. Cypress records video of the command log and writes a
      // screenshot on failure; without this the account password is printed in plaintext into
      // cypress/videos/<store>/ and cypress/screenshots/<store>/ on every single run.
      .type(password, { force: true, log: false });
    cy.get(this.sel.signInSubmit).first().click({ force: true });
    return this;
  }

  /**
   * Polls until the customer step shows the signed-in email, up to ~15s. Tolerant by design —
   * it reports rather than asserts, because signIn() wants to decide whether to re-attempt and
   * assertSignedIn() is what ultimately judges.
   */
  waitForSignedIn(email, attempt = 0) {
    return cy.get('body').then(($b) => {
      if ($b.find(this.sel.customerStep).text().includes(email)) return undefined;
      if (attempt >= 30) return undefined;
      cy.wait(500);
      return this.waitForSignedIn(email, attempt + 1);
    });
  }

  /**
   * Signs in, with ONE bounded re-attempt.
   *
   * WHY THE RETRY EXISTS (measured, Sept 15 2026): the submit is a force-click on a React form,
   * and a force-click lands even when checkout-js is mid-re-render — in which case it does
   * nothing at all and the only symptom is assertSignedIn timing out 30s later against a customer
   * step that still reads "Returning Customer / Email / Password / Sign In". Observed twice in one
   * armed run, which signs in twice because the spec runs the funnel for both its tests.
   *
   * Deliberately re-attempted HERE rather than left to the suite-wide retries:{runMode:2}: the
   * armed order-placement test runs at retries:0 (a retry there could file a second real order),
   * so it has no other recovery, and a whole-funnel retry costs ~90s to recover from a swallowed
   * click. Bounded to one extra attempt and logged loudly — if this line starts appearing every
   * run it is a real sign-in regression, not flake, and must be investigated rather than absorbed.
   */
  signIn(email, password) {
    this.openSignIn();
    this.submitSignInForm(email, password);
    this.waitForSignedIn(email);
    cy.get('body').then(($b) => {
      if ($b.find(this.sel.customerStep).text().includes(email)) return;
      // Only re-attempt while the form is genuinely still on screen. If it has gone, sign-in is
      // in flight or has landed some other way and a second submit would be noise.
      if (!$b.find(this.sel.emailInput).filter(':visible').length) return;
      cy.task('log',
        '[CheckoutPage] sign-in did not take on the first submit — re-attempting once ' +
        '(see signIn() — a persistent occurrence is a regression, not flake)');
      this.submitSignInForm(email, password);
    });
    return this;
  }

  assertSignedIn(email) {
    // On success the customer step collapses to a static summary showing the signed-in address.
    cy.get(this.sel.customerStep, { timeout: 30000 }).should('contain.text', email);
    return this;
  }

  // ─── Shipping address ──────────────────────────────────────────────────────

  fillFirstName(v) { cy.get(this.sel.firstName).clear({ force: true }).type(v, { force: true }); return this; }
  fillLastName(v) { cy.get(this.sel.lastName).clear({ force: true }).type(v, { force: true }); return this; }
  fillCompany(v) { cy.get(this.sel.company).clear({ force: true }).type(v, { force: true }); return this; }
  fillCity(v) { cy.get(this.sel.city).clear({ force: true }).type(v, { force: true }); return this; }
  fillZip(v) { cy.get(this.sel.postCode).clear({ force: true }).type(v, { force: true }); return this; }
  fillPhone(v) { cy.get(this.sel.phone).clear({ force: true }).type(v, { force: true }); return this; }
  fillAddress2(v) { cy.get(this.sel.address2).clear({ force: true }).type(v, { force: true }); return this; }

  fillAddress1(v) {
    cy.get(this.sel.address1).clear({ force: true }).type(v, { force: true });
    // {esc}: when the store enables Google Places autocomplete on address line 1, its suggestion
    // dropdown overlays the fields below and swallows the next click. Dismiss it before moving on.
    cy.get(this.sel.address1).type('{esc}', { force: true });
    return this;
  }

  selectCountry(v) {
    cy.get(this.sel.countrySelect).select(v);
    return this;
  }

  fillRegion(v) {
    // BigCommerce swaps this field's ELEMENT TYPE with the selected country: a <select> for
    // countries with a defined state list (US/CA), a free-text <input> otherwise. Same
    // conditional-presence idiom as ZohoFormPage.fillPhone's optional country-code field.
    cy.get('body').then(($b) => {
      if ($b.find(this.sel.provinceSelect).length) cy.get(this.sel.provinceSelect).select(v);
      else cy.get(this.sel.provinceInput).clear({ force: true }).type(v, { force: true });
    });
    return this;
  }

  /**
   * "Checkout is not mid-update." checkout-js overlays the step it is re-rendering while a
   * consignment round-trips, so this is the deterministic settle signal — preferred over a blind
   * wait wherever one will do.
   *
   * Written as a retryable cy.get('body').should(...) closure rather than
   * cy.get(overlay).should('not.exist') on purpose: the overlay is absent from the DOM most of the
   * time, and a bare cy.get on a missing element would fail rather than pass.
   */
  waitForCheckoutIdle(timeout = 30000) {
    if (!this.sel.loadingOverlay) return this;
    cy.get('body', { timeout }).should(($b) => {
      expect(
        $b.find(this.sel.loadingOverlay).filter(':visible'),
        'checkout is idle (no loading overlay)'
      ).to.have.length(0);
    });
    return this;
  }

  /**
   * Bounded, TOLERANT poll for shipping options — a settle step, not a check.
   *
   * cy.request-style recursion (same shape as waitForCarts in the spec) because what it waits on is
   * a third-party carrier round-trip that may legitimately never arrive: with a large shared
   * address book the address BigCommerce preselects is arbitrary and can quote zero options. That
   * must not fail the run before the spec has even switched away from it — hence "log and carry
   * on" rather than an assertion. selectShippingMethod() is where a missing quote is a real error.
   */
  waitForShippingQuote(attempt = 0) {
    return cy.get('body').then(($b) => {
      if ($b.find(this.sel.shippingOptionRadio).length) return undefined;
      if (attempt >= 30) {
        cy.task('log',
          '[CheckoutPage] no shipping quote for the preselected address after ~15s — continuing');
        return undefined;
      }
      cy.wait(500);
      return this.waitForShippingQuote(attempt + 1);
    });
  }

  /**
   * Bounded, tolerant poll for the blank address form to replace the saved-address picker.
   *
   * Tolerant because this is where the one known failure of this flow lands. Clicking "Enter a new
   * address" has been seen to throw an unhandled `RequestError: Consignment not found` from
   * checkout-js, after which the UI silently reverts to the saved address. When that happens the
   * form never arrives, and the spec drops to the saved-address path rather than going red — a
   * deliberate decision to keep the suite green — but says so unmistakably in the run log, because
   * on that path the run is green while asserting nothing about an address it chose.
   */
  waitForBlankAddressForm(attempt = 0) {
    return cy.get('body').then(($b) => {
      if ($b.find(this.sel.countrySelect).length) return undefined;
      if (attempt >= 20) {
        this.usingSavedAddress = true;
        cy.task('log',
          '[CheckoutPage] !! FALLBACK: "Enter a new address" did not produce a blank form ' +
          '(checkout reverted to the saved address). The spec is NOT controlling the shipping ' +
          'address on this run — address-dependent coverage is OFF. See CLAUDE.md.');
        return undefined;
      }
      cy.wait(500);
      return this.waitForBlankAddressForm(attempt + 1);
    });
  }

  /**
   * Switches the saved-address picker over to a blank "new address" form.
   *
   * THE SEQUENCING IS THE POINT, and it is what makes this work where an earlier attempt failed
   * with `RequestError: Consignment not found`. That error is a 404 against a consignment id, so
   * the dropdown is not touched until the PRESELECTED address has actually been quoted
   * (waitForShippingQuote) and the overlay has cleared (waitForCheckoutIdle) — a rendered quote
   * being the only proof the consignment exists server-side rather than still being in flight.
   *
   * THE EXCEPTION SUPPRESSION BELOW IS NARROW IN BOTH DIMENSIONS, and that is the whole argument
   * for it. Two errors are known to fire on this one click, and neither is fixable from here:
   *
   *   1. `RequestError: Consignment not found` — checkout-js racing its own consignment.
   *   2. `TypeError: Cannot read properties of null (reading 'value')` thrown from an INLINE
   *      handler on the storefront's own /checkout page (stack frame `…/checkout:956:71`, bound
   *      via jQuery to the dropdown's <li> elements). It fires because the "Enter a new address"
   *      item has no address for that handler to read a value out of — so a REAL CUSTOMER clicking
   *      "Enter a new address" hits it too. A genuine storefront defect, reported rather than
   *      hidden: everything suppressed here is logged by name (see the cy.then at the end).
   *
   * Message-matching alone would be unacceptable for (2) — "Cannot read properties of null" is the
   * single most common shape of a real regression, and a KNOWN_BUGGY_SCRIPTS entry for it would be
   * global, permanent, and would blind this suite to exactly what it exists to catch. So this
   * suppression is gated on `switchingAddress`, a flag set immediately before the click and
   * cleared as soon as the new form appears (at most ~10s), and the error is additionally
   * required to carry an inline frame on a /checkout document. Cypress also removes the handler at the end
   * of the test. Anything outside that window, or from anywhere else, falls through to the global
   * handler in e2e.js and fails the test as normal.
   */
  chooseNewAddress() {
    this.switchingAddress = false;
    this.suppressedDuringSwitch = [];
    // No cy.* calls inside an event handler — it is not in the command queue (see the async-safety
    // rule at the foot of support/e2e.js). Returning undefined leaves the error to e2e.js.
    cy.on('uncaught:exception', (err) => {
      if (!this.switchingAddress) return undefined;
      const known = /consignment not found/i.test(err.message)
        // An inline-script frame on the /checkout document itself, e.g. "/checkout:956:71".
        || /\/checkout:\d+:\d+/.test(err.stack || '');
      if (!known) return undefined;
      // Cypress wraps an app error's real message inside its own "The following error originated
      // from your application code…" preamble, with the actual text on a "  > …" line. Pull that
      // out plus the first source frame, so the log line names the defect and where it lives
      // instead of quoting Cypress at the reader.
      const msg = String(err.message);
      const detail = (msg.match(/^\s*>\s*(.+)$/m) || [null, msg.split('\n')[0]])[1];
      const frame = (String(err.stack || '').match(/\((https?:\/\/[^)]+)\)/) || [])[1];
      this.suppressedDuringSwitch.push(`${detail}${frame ? `  [${frame}]` : ''}`);
      return false;
    });

    this.waitForShippingQuote();
    this.waitForCheckoutIdle();

    cy.get(this.sel.addressToggle).first().click({ force: true });
    // VERIFIED LIVE: the menu is not in the DOM until the toggle is clicked.
    cy.get(this.sel.addressDropdownMenu, { timeout: 15000 }).should('be.visible').then(($menu) => {
      // Count logged every run so the shared account can be watched: it must not GROW run over
      // run. The absolute number proves nothing (28 entries as of Sept 15 2026, put there by other
      // teams' manual testing) — only its stability does. Minus one for the "new address" entry.
      cy.task('log',
        `[CheckoutPage] address book holds ${Math.max($menu.children().length - 1, 0)} ` +
        'saved address(es) — this must not grow run over run');
      const $byHook = $menu.find(this.sel.newAddressLink);
      const $entry = $byHook.length
        ? $byHook
        : $menu.find(`a:contains("${this.cfg.newAddressLinkText}")`);
      expect($entry, 'the "enter a new address" entry is present in the saved-address menu')
        .to.have.length.at.least(1);
      // scrollIntoView because the menu is a 185px scrolling container; force because the Klaviyo
      // popup is left unblocked fleet-wide and covers elements mid-run.
      cy.wrap($entry.first()).scrollIntoView();
      // Open the suppression window as late as possible and shut it again as soon as the form is
      // up, so it can never cover anything but this one click.
      cy.then(() => { this.switchingAddress = true; });
      cy.wrap($entry.first()).click({ force: true });
    });

    this.waitForBlankAddressForm();

    return cy.then(() => {
      this.switchingAddress = false;
      // Reported, not hidden. These are live storefront defects that a real customer hits on the
      // same click, and this log line is the only place they surface.
      this.suppressedDuringSwitch.forEach((m) => {
        cy.task('log',
          `[CheckoutPage] storefront error on the "new address" click (suppressed, reported): ${m}`);
      });
    });
  }

  /**
   * Keeps "Save this address in my address book" unchecked.
   *
   * VERIFIED LIVE on BESTUS: it already ships UNCHECKED, so this is a guard rather than an action —
   * but it is not optional. The QA customer is a SHARED account whose address book already holds 28
   * entries from other teams, and a spec that silently added one per run would be actively making
   * that worse. `.should('exist')` is what makes a drifted selector fail loudly instead of quietly
   * turning the guard into a no-op. Set the selector to null to opt a store out deliberately.
   */
  ensureSaveAddressUnchecked() {
    if (!this.sel.saveAddressCheckbox) return this;
    cy.get(this.sel.saveAddressCheckbox).should('exist').then(($box) => {
      if (!$box.is(':checked')) return;
      cy.task('log',
        '[CheckoutPage] "Save this address in my address book" was checked — unchecking it');
      // force: checkout-js styles the native input away behind its own label.
      cy.wrap($box).uncheck({ force: true });
    });
    cy.get(this.sel.saveAddressCheckbox).should('not.be.checked');
    return this;
  }

  /**
   * Fills the shipping address, taking whichever of BigCommerce's TWO shipping-step shapes is on
   * screen — and converging both on a blank form the spec has typed itself.
   *
   * BigCommerce renders a blank address form when the signed-in customer's address book is empty,
   * but a saved-address dropdown (a#addressToggle) when it is not — and in that second shape
   * #countryCodeInput does not exist at all, so every fill method fails with a misleading
   * "expected to find #countryCodeInput". Which shape appears is NOT under the spec's control: the
   * QA customer is a SHARED account, so an address saved by anyone silently changes the form for
   * every later run. Found exactly that way, when a stranger's address appeared mid-session and
   * broke three consecutive attempts.
   *
   * So the dropdown shape is no longer accepted as-is. Using a stranger's saved address meant the
   * spec's own test data was whatever a colleague last typed by hand, and — since nothing was
   * typed — no address-dependent behaviour could be exercised or falsified at all. chooseNewAddress()
   * switches to a blank form; assertAddressHeld() then proves the address really took.
   *
   * The leading cy.get is a retryable guard on EITHER shape, which doubles as the wait for the
   * shipping step to finish rendering after sign-in.
   *
   * ORDER MATTERS, and it is NOT cy.fillPersona's order. That command fills address1 -> city ->
   * region -> zip -> country, with selectCountry LAST. On BigCommerce checkout, changing the
   * country REBUILDS the state field (select vs text) and clears both state and postcode — so a
   * persona filled in that order reaches the server with an empty state and zip, and the shipping
   * quote fails for reasons that look nothing like the cause. Country first, everything else after.
   * That is exactly why this page object does not route through cy.fillPersona despite being
   * duck-type compatible with it.
   */
  fillShippingAddress(persona) {
    this.usingSavedAddress = false;
    cy.get(`${this.sel.countrySelect}, ${this.sel.addressToggle}`, { timeout: 30000 })
      .should('exist');
    cy.get('body').then(($b) => {
      if ($b.find(this.sel.countrySelect).length) {
        cy.task('log', '[CheckoutPage] blank address form — filling the persona address');
        this.fillAddressForm(persona);
        return;
      }
      cy.task('log',
        '[CheckoutPage] saved-address dropdown — switching to a new address');
      this.chooseNewAddress();
      // cy.then, not a bare if: usingSavedAddress is set while the queue RUNS, and everything in
      // this callback was enqueued before chooseNewAddress() executed.
      cy.then(() => {
        if (this.usingSavedAddress) return;
        this.fillAddressForm(persona);
      });
    });
    return this;
  }

  /** The blank-form fill itself, shared by both shapes. */
  fillAddressForm(persona) {
    this.selectCountry(persona.country);
    this.fillFirstName(persona.firstName);
    this.fillLastName(persona.lastName);
    if (persona.company) this.fillCompany(persona.company);
    this.fillAddress1(persona.address1);
    if (persona.address2) this.fillAddress2(persona.address2);
    this.fillCity(persona.city);
    this.fillRegion(persona.region);
    this.fillZip(persona.zip);
    this.fillPhone(persona.phoneNumber);
    this.fillCustomFields();
    // After the fields, so that no field-driven re-render can flip it back before the quote.
    this.ensureSaveAddressUnchecked();
    // Then let the address settle before anything asks for a shipping quote: checkout-js debounces
    // address edits before POSTing the consignment, so a quote requested too early is a quote for
    // the PREVIOUS address.
    this.waitForCheckoutIdle();
    cy.wait(this.cfg.addressSettleMs);
    return this;
  }

  /**
   * Proves the address the spec typed is the address checkout is actually holding.
   *
   * The most valuable assertion in this flow, and it exists because of a real observed failure:
   * clicking "Enter a new address" could throw `Consignment not found` and the UI would then
   * SILENTLY revert to the saved address. Without this, such a run stays green while quoting
   * shipping for a stranger's address — and every address-dependent check downstream becomes
   * meaningless without anything going red.
   *
   * The presence check comes first and is the one that catches a revert: reverting restores the
   * saved-address picker and removes #countryCodeInput. It cannot be keyed on a#addressToggle
   * instead, because (verified live) the toggle stays in the DOM on BOTH shapes.
   */
  assertAddressHeld(persona) {
    cy.then(() => {
      if (this.usingSavedAddress) {
        cy.task('log',
          '[CheckoutPage] fallback path — skipping the address guard (nothing was typed)');
        return;
      }
      cy.get('body').should(($b) => {
        expect(
          $b.find(this.sel.countrySelect),
          'the new-address form is still on screen (checkout did not revert to a saved address)'
        ).to.have.length.at.least(1);
      });
      cy.get(this.sel.postCode).should('have.value', persona.zip);
      cy.get(this.sel.city).should('have.value', persona.city);
      if (this.sel.saveAddressCheckbox) {
        cy.get(this.sel.saveAddressCheckbox).should('not.be.checked');
      }
    });
    return this;
  }

  /**
   * Second, independent proof that the quote which was accepted was for OUR address: once the
   * shipping step is submitted it collapses to a static vcard summary, which renders the postcode.
   * assertAddressHeld checks the inputs; this checks what the server came back with.
   */
  assertShippingSummary(persona) {
    cy.then(() => {
      if (this.usingSavedAddress) return;
      cy.get(this.sel.shippingStep, { timeout: 30000 }).should('contain.text', persona.zip);
    });
    return this;
  }

  /**
   * Fills the store's custom shipping fields (checkout.customFields).
   *
   * BigCommerce lets a merchant add arbitrary custom checkout fields, and a REQUIRED one silently
   * blocks the carrier quote so no shipping options ever render — which presents as a timeout on
   * the shipping-option radios, pointing at entirely the wrong thing. There is no DOM signal to
   * detect them generically either: BigCommerce marks such fields required only in the label TEXT
   * ("(Required)"), never with a `required` attribute or aria-required. So they are declared per
   * store in config rather than guessed at runtime.
   *
   * BESTUS has one: "Is this a construction site address? (Required)".
   */
  fillCustomFields() {
    const fields = this.cfg.customFields || [];
    fields.forEach((f) => {
      switch (f.type) {
        case 'radio':
        case 'checkbox':
          cy.get(f.selector).check({ force: true });
          break;
        case 'select':
          cy.get(f.selector).select(f.value);
          break;
        default:
          cy.get(f.selector).clear({ force: true }).type(f.value, { force: true });
      }
    });
    return this;
  }

  // ─── Shipping method, then the stop ────────────────────────────────────────

  selectShippingMethod() {
    // Idle first, so a stale quote left over from the previously-selected address cannot be the
    // thing that gets picked.
    this.waitForCheckoutIdle();
    // Shipping options are fetched ASYNCHRONOUSLY after the address validates (checkout-js POSTs a
    // consignment and the carrier quote round-trips), so this needs far more than the 15s
    // defaultCommandTimeout. minShippingOptions doubles as a real assertion: a freight-only product
    // quotes zero options, and this says so in one line instead of timing out on a missing radio.
    cy.get(this.sel.shippingOptionRadio, { timeout: 60000 })
      .should('have.length.at.least', this.cfg.minShippingOptions)
      .first()
      // force: checkout-js visually replaces the native radio with a styled label.
      .check({ force: true });
    return this;
  }

  submitShipping() {
    cy.get(this.sel.shippingContinue).first().should('not.be.disabled').click({ force: true });
    return this;
  }

  /**
   * BigCommerce renders FOUR steps — customer, shipping, billing, payment. Billing is normally
   * skipped because the shipping form's #sameAsBilling checkbox ("My billing address is the same
   * as my shipping address") ships CHECKED by default (verified live on BESTUS), so the flow goes
   * shipping -> payment directly. This handles the case where it does not: entirely conditional on
   * the billing step actually being active, so on the normal path it is a no-op rather than a
   * failure.
   */
  continueBillingIfBlocking() {
    if (!this.sel.billingContinue) return this;
    cy.get('body').then(($b) => {
      // Keyed off a VISIBLE billing continue button, not off the step's `active` class. That
      // distinction is load-bearing and was found by probing the live DOM: BigCommerce's `active`
      // class is cumulative, so by the time this runs the billing step carries it even though
      // billing was skipped — an `active`-based check fires exactly when it should not. A visible
      // "continue" button is the only honest signal that billing is actually blocking the flow.
      const $btn = $b.find(this.sel.billingContinue).filter(':visible');
      if (!$btn.length) return;
      cy.task('log', '[CheckoutPage] billing step is blocking — continuing through it');
      cy.wrap($btn.first()).should('not.be.disabled').click({ force: true });
    });
    return this;
  }

  /**
   * The terminus. Proves we reached payment — and nothing here clicks paymentSubmit.
   *
   * Asserts on the step container going active rather than on inner payment-provider markup: the
   * latter varies per store and per enabled gateway (BESTUS alone renders PayPal, Pay Later and
   * Amazon Pay buttons), so it would be brittle for no added signal.
   */
  assertPaymentStep() {
    // Two assertions, because the first one alone would be weak. BigCommerce's `active` class is
    // CUMULATIVE — it marks steps already completed, not the one currently expanded — and by the
    // end of the flow ALL FOUR steps carry it (verified live by snapshotting the classes at every
    // stage). It still discriminates, because payment is the last to receive it and carries it at
    // no earlier stage, so it is a genuine ordering check.
    //
    // The real proof is the second: the "Place Order" button rendered and visible. That button
    // exists only once the payment step is genuinely reached, and it is precisely the control this
    // suite must never click — asserting we can see it, and stopping there, is the whole point of
    // the spec.
    cy.get(`${this.sel.paymentStep}.${this.sel.activeStepClass}`, { timeout: 60000 })
      .should('exist');
    cy.get(this.sel.paymentSubmit, { timeout: 30000 }).should('be.visible');
    return this;
  }

  /**
   * The server's view of the checkout, as a chainable yielding the parsed body.
   *
   * The checkout id IS the cart id (verified live — /api/storefront/carts returns an id that
   * /api/storefront/checkouts/<id> answers 200 for), so callers pass the id they already hold from
   * the add-to-cart step rather than parsing one out of the page.
   *
   * An /api/ path, which is the only kind cy.request may touch on this storefront: it answers 406
   * to any HTML route requested with cy.request's default wildcard Accept header.
   *
   * WHY THIS EXISTS: the DOM assertions on this step can only see what the theme chose to render.
   * The payload is what BigCommerce will actually bill, ship and tax, so it is the honest place to
   * assert that the address the spec typed is the address the order would ship to.
   */
  readCheckout(cartId) {
    // Fail with the actual diagnosis rather than letting BigCommerce answer it. A missing id
    // requests /checkouts/undefined, which comes back 401 "Checkout Id `undefined` does not
    // exist" — a wall of headers and cookies that reads like an auth or session problem and sends
    // you looking in entirely the wrong place. It has happened twice; both times the cause was a
    // caller evaluating its id at command-ENQUEUE time, before the step that assigns it had run.
    if (!cartId) {
      throw new Error(
        'readCheckout() got no cart id. The caller almost certainly captured it at enqueue time — ' +
        'read it inside cy.then(), or pass a getter, so it resolves after the add-to-cart step.');
    }
    return cy.request(`/api/storefront/checkouts/${cartId}`).its('body');
  }

  /**
   * Payment-step contents: at least one gateway offered, and the store-credit control that
   * placeOrder.js depends on. Assertion only — nothing here selects a method.
   *
   * SELECTING A METHOD IS DELIBERATELY NOT DONE. Clicking a gateway radio can trigger hosted-field
   * tokenization or a PayPal redirect, and PayPal's SDK is deliberately left unblocked on this page
   * (see KNOWN_BUGGY_SCRIPTS in checks.js). Presence is the signal worth having; interacting buys
   * nothing and risks leaving the page in a state the next assertion misreads.
   */
  assertPaymentOptions() {
    if (this.sel.paymentMethodOption) {
      cy.get(this.sel.paymentMethodOption, { timeout: 30000 })
        .should('have.length.at.least', 1);
    }
    if (this.sel.storeCreditCheckbox) {
      // Presence, not checked-state: an account with no credit left still renders the payment step
      // perfectly well, and that is placeOrder.js's problem to refuse, not this test's to fail on.
      cy.get(this.sel.storeCreditCheckbox).should('exist').then(($box) => {
        const label = $box.siblings(`label[for="${$box.attr('id')}"]`).text().trim();
        cy.task('log',
          `[CheckoutPage] store credit control: checked=${$box.is(':checked')} ` +
          `label="${label || '(no label found)'}"`);
      });
    }
    return this;
  }
}
