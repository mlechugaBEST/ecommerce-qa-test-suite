/**
 * Store config access + per-store gating helpers.
 *
 * The active store's JSON (stores/<STORE>.json) is injected into Cypress.env('site')
 * by cypress.config.js, so it is available synchronously when spec files are
 * evaluated — which is what lets describeIfStore choose describe vs describe.skip
 * at collection time. This module is the only place that should read Cypress.env('site').
 */

export function getStore() {
  const site = Cypress.env('site');
  if (!site) {
    throw new Error(
      'Store config missing — was Cypress launched via cypress.config.js with a valid STORE env var?'
    );
  }
  return site;
}

/**
 * Conditional suite: when `condition` is falsy (store lacks the feature or it is
 * not configured yet), the suite runs as describe.skip so it shows up as pending
 * in the results instead of silently disappearing.
 */
export function describeIfStore(condition, title, options, fn) {
  if (typeof options === 'function') {
    fn = options;
    options = undefined;
  }
  const block = condition ? describe : describe.skip;
  const fullTitle = condition
    ? title
    : `${title} [skipped: not configured for ${getStore().storeCode}]`;
  return options ? block(fullTitle, options, fn) : block(fullTitle, fn);
}

/**
 * Same as describeIfStore, at the individual-test level. Pass an optional `reason`
 * to explain a *deliberate* gate — a theme that lacks the element, a form that
 * doesn't require the field, a browser-only limitation — and it replaces the
 * default "not configured" suffix so the skip reads clearly to anyone running the
 * suite (e.g. `[skipped: theme hides breadcrumbs on mobile]`). Omit it for genuine
 * "feature not configured yet" gates, where "not configured for <CODE>" is accurate.
 */
export function itIfStore(condition, title, fn, reason) {
  const block = condition ? it : it.skip;
  const suffix = reason
    ? `[skipped: ${reason}]`
    : `[skipped: not configured for ${getStore().storeCode}]`;
  const fullTitle = condition ? title : `${title} ${suffix}`;
  return block(fullTitle, fn);
}

// Footer markup for the BESTUS theme ("tcs" footer). Other stores run different
// BigCommerce themes (e.g. BESTCA uses footer.footer with h5.footer-info-heading),
// so any of these can be overridden per store via branding.footer in stores/<code>.json.
const FOOTER_DEFAULTS = {
  rootSelector: 'footer.tcsFooter',
  sections: ['footer .footer-top', 'footer .footer-bottom', 'footer .Copyright'],
  headingSelector: 'footer .box h3',
  headings: ["WHAT'S IN STORE", 'SECURE SHOPPING', 'MY ACCOUNT', 'Contact Info'],
  navLinks: 'footer .box ul li a',
  contactInfoBox: 'footer .Contact-info-box',
  minContactBoxes: 3,
  // Some themes (BESTCA) render tel links as siblings of the contact-info label
  // elements rather than inside them, so the phone-link selector is independent.
  phoneLinks: 'footer .Contact-info-box a[href^="tel:"]',
  minPhoneLinks: 2,
  copyright: 'footer .Copyright p',
  paymentIcons: 'footer .footer-payment-icons',
};

/** The store's footer selectors/expectations: BESTUS defaults merged with branding.footer. */
export function footerConfig() {
  const { branding } = getStore();
  return { ...FOOTER_DEFAULTS, ...((branding && branding.footer) || {}) };
}

/**
 * Header container selector. The BESTUS theme uses a semantic <header> element, but
 * ADAP's theme has none — its desktop header is div.desktop-header-section and its
 * mobile header div.iPad_header — so stores override via branding.headerSelector
 * and branding.mobileHeaderSelector (the latter falls back to the former).
 */
export function headerSelector() {
  const { branding } = getStore();
  return (branding && branding.headerSelector) || 'header';
}

/** Mobile header container selector (defaults to headerSelector()). */
export function mobileHeaderSelector() {
  const { branding } = getStore();
  return (branding && branding.mobileHeaderSelector) || headerSelector();
}

/**
 * Selector matching the mobile AND desktop header containers (deduplicated).
 * Mobile specs assert on this with .filter(':visible') because themes switch
 * headers at their own breakpoints — ADAP hides .iPad_header above ~1000px
 * (iPad Pro portrait is 1024px wide) and shows its desktop header instead.
 */
export function anyHeaderSelector() {
  return [...new Set([mobileHeaderSelector(), headerSelector()])].join(', ');
}

/**
 * Mobile navigation drawer selector. BESTUS renders div.mobile-menu; ADAP's theme
 * uses a #mySidenav slide-out instead. Overridden via branding.mobileNavSelector.
 */
export function mobileNavSelector() {
  const { branding } = getStore();
  return (branding && branding.mobileNavSelector) || 'div.mobile-menu';
}

// PLP structure selectors for the BESTUS theme. Nullable keys (breadcrumbHome, sidebar,
// bestSellers, subcategoryBox) make their tests skip when a store sets them to null.
// Overridden per store via plp.selectors (see stores/adap.json).
const PLP_SELECTOR_DEFAULTS = {
  // Category/heading <h1>. BESTUS's theme uses h1.page-heading; ADC's "footer-new"
  // SearchSpring theme titles categories with h1.container-header instead — overridden
  // per store via plp.selectors.heading.
  heading: 'h1.page-heading',
  breadcrumbs: '.breadcrumbs.new_breadcrumbs',
  breadcrumbHome: 'a.breadcrumb-home',
  sidebar: '.categories-left',
  sidebarBlocks: '.categories-left .sidebarBlock',
  // Minimum sidebar blocks the "sidebar is visible" test requires. BESTUS has several
  // (Categories, Best Sellers, Brands); BESTCA's theme has a single Categories block, so
  // it overrides this to 1 via plp.selectors.sidebarBlocksMin.
  sidebarBlocksMin: 2,
  sidebarLinks: '.categories-left .navList-item a',
  bestSellers: '#treeView li a',
  subcategoryBox: '.subCategoriesBox',
  // Inner elements of a subcategory box: its title text node and the category link. BESTUS uses
  // .nameTitle + a.navList-action; ADC's SearchSpring "Snap" theme renders .subcategory-item tiles
  // whose title and href both live on a.subcategory-link. Overridden per store via plp.selectors.
  subcategoryTitle: '.nameTitle',
  subcategoryLink: 'a.navList-action',
  // Product-card container. BESTUS's SearchSpring template renders BigCommerce-native
  // ul.productGrid; BESTCA runs the stock SearchSpring "Snap" theme which renders
  // ul.ss__results.ss__results--grid instead (cards keep .card-figure img / .card-title a).
  // Overridden per store via plp.selectors.productCard.
  productCard: 'ul.productGrid li.product',
  // Per-card price element, asserted to show a $-amount on the first few cards. ADC's catalog
  // is MIXED — priced "Best Access Doors" products and quote-only products (no price element)
  // are interleaved in the same grid — so it sets this to null to skip the per-card price check
  // (PDP/JSON-LD price coverage still applies on priced products). Nullable.
  cardPrice: '[class*="price"]',
  // Remaining per-card inner elements: image, title text, and link. No fleet store has
  // needed to override these yet (every theme's card partial shares this markup), but they're
  // routed through the same plp.selectors override contract as productCard/cardPrice so a
  // future theme drift doesn't require a checks.js code change. cardLink is kept as ONE
  // combined-selector string (not split into two keys) — matches the exact current hardcoded
  // behavior: whichever of the two anchors wraps a link on this theme's card, .first() below
  // picks it.
  cardImage: '.card-figure img',
  cardTitle: '.card-title',
  cardLink: '.card-figure a, .card-title a',
  // Detailed pagination markup (BESTUS SearchSpring template). Overridden per store —
  // e.g. ADAP's older template uses .ss-pagination-container/li.pagination-item with ?p=2.
  // Nullable: a store whose theme has no detailed pagination markup sets this to null —
  // the generic pagination-presence test and the discovery page-2 test still run.
  pagination: {
    container: '.ss__pagination',
    active: '.ss-page.ss-active',
    links: 'a.ss-page-link',
    next: '.ss-page-next a.ss-page-link',
    pageTwoToken: 'pp=2',
  },
};

/** The store's PLP structure selectors: BESTUS defaults merged with plp.selectors. */
export function plpSelectors() {
  const { plp } = getStore();
  return { ...PLP_SELECTOR_DEFAULTS, ...((plp && plp.selectors) || {}) };
}

// PDP structure selectors for the BESTUS theme. Nullable keys (breadcrumbHome,
// breadcrumbLabel, relatedCarousel, productInfoForm) make their checks skip when null.
// Overridden per store via pdp.selectors (see stores/adap.json).
const PDP_SELECTOR_DEFAULTS = {
  // Core Stencil/BigCommerce PDP structure. Every fleet store is Stencil today so these
  // hold as-is, but they live here (not hardcoded in the specs) so a future custom-theme
  // store can override them via pdp.selectors like every other PDP selector. Non-nullable.
  title: 'h1.productView-title',
  price: '[data-product-price-without-tax]',
  addToCart: '#form-action-addToCart',
  qtyInput: 'input[name="qty[]"]',
  sku: '[data-product-sku]',
  breadcrumbs: '.breadcrumbs.new_breadcrumbs',
  breadcrumbHome: 'a.breadcrumb-home',
  breadcrumbLabel: '.breadcrumb-label',
  galleryImage: 'section[data-image-gallery] .thumbnail_image',
  description: '.productView-description1',
  // Quantity stepper buttons. BESTUS's theme renders button[data-action="inc"/"dec"];
  // BESTCA's Snap theme has a bare .form-increment input with no stepper buttons, so it
  // sets these to null and the inc/dec presence checks skip. Nullable.
  qtyIncrement: 'button[data-action="inc"]',
  qtyDecrement: 'button[data-action="dec"]',
  leadTime: '.leadtime_value',
  relatedCarousel: '.content-carousel .owl-carousel',
  productInfoForm: '#have_a_product_question_request',
  // Wrapper around the Yotpo reviews widget — ADAP has no #productreviewbox and
  // renders reviews in #yotpo-reviews-main-widget instead. Nullable (skips test).
  reviewsContainer: '#productreviewbox',
  pdfNewTab: true,
};

/** The store's PDP structure selectors: BESTUS defaults merged with pdp.selectors. */
export function pdpSelectors() {
  const { pdp } = getStore();
  return { ...PDP_SELECTOR_DEFAULTS, ...((pdp && pdp.selectors) || {}) };
}

// BigCommerce "Optimized One-Page Checkout" — the checkout-js React SPA, bundled from
// checkout-sdk.bigcommerce.com but SERVED SAME-ORIGIN at <baseUrl>/checkout (verified live on
// BESTUS), so no cy.origin is needed; only the JS bundle itself is cross-origin. Every fleet store
// runs it today, but BigCommerce rolls that bundle forward on its own schedule and themes can
// restyle it, so these sit behind the same defaults+override contract as PLP/PDP and are
// overridable per store via checkout.selectors.
//
// Several values are COMBINED selectors (comma-separated candidates) rather than one string — the
// same idiom as PLP_SELECTOR_DEFAULTS.cardLink and checks.js's SORT_SELECT: whichever candidate the
// live bundle renders, the `.first()` / `:visible` at the call site picks it. checkout-js ships
// stable ids on the address fields (they come from BigCommerce's address-field schema rather than
// from markup) plus data-test hooks used by its own e2e suite, so the id is listed first and the
// data-test hook as a fallback — a bundle that drops either still resolves.
//
// Flat on purpose — no nested sub-objects like PLP's `pagination`. checkoutSelectors() is a SHALLOW
// merge, so a nested group would force a store overriding one selector to restate the whole group.
const CHECKOUT_SELECTOR_DEFAULTS = {
  // App shell + the accordion step containers. VERIFIED LIVE on BESTUS (Sept 2026) by dumping the
  // rendered checkout DOM: the steps are <li> elements, NOT the "#checkout-<step>" ids an earlier
  // draft guessed. There are FOUR of them — billing sits between shipping and payment — though in
  // practice billing is skipped, because the shipping form's "My billing address is the same as my
  // shipping address" checkbox (#sameAsBilling) ships CHECKED by default.
  app: '#checkout-app',
  customerStep: 'li.checkout-step--customer',
  shippingStep: 'li.checkout-step--shipping',
  billingStep: 'li.checkout-step--billing',
  paymentStep: 'li.checkout-step--payment',
  // The class BigCommerce puts on a step it considers reached. NOTE it is CUMULATIVE, not
  // "currently expanded" — verified live by snapshotting all four steps at every stage: the
  // customer step keeps `active` after sign-in while the shipping step does NOT have it even
  // though its form is visibly rendered and fillable, and at the end of the flow all four carry
  // it at once. So it is usable as an ORDERING signal (payment gets it last, and only at the end)
  // but never as "which step am I on" — see continueBillingIfBlocking() in CheckoutPage for the
  // check that this fact invalidated.
  activeStepClass: 'active',
  orderSummary: '.cart-section, aside.layout-cart',

  // Customer / sign-in step. The guest form is form#checkout-customer-guest; clicking the sign-in
  // link swaps it for form#checkout-customer-returning. Both forms use the SAME submit button id
  // (#checkout-customer-continue), so the login selectors are scoped to the returning form to make
  // sure we never drive the guest form by accident.
  //
  // NOTE: data-test="customer-continue-button" lives on the SIGN-IN LINK, not on the submit button
  // (verified live). An earlier draft had it as a fallback on signInSubmit, which would have
  // clicked "Sign in now" again instead of submitting the credentials.
  signInLink: 'a#checkout-customer-login',
  emailInput: '#checkout-customer-returning input#email',
  passwordInput: '#checkout-customer-returning input#password',
  signInSubmit: '#checkout-customer-returning button#checkout-customer-continue',

  // Shipping address. Schema-driven ids — ALL VERIFIED LIVE on BESTUS (Sept 2026).
  firstName: '#firstNameInput',
  lastName: '#lastNameInput',
  company: '#companyInput',
  phone: '#phoneInput',
  address1: '#addressLine1Input',
  address2: '#addressLine2Input',
  city: '#cityInput',
  postCode: '#postCodeInput',
  countrySelect: '#countryCodeInput',
  // BigCommerce swaps this field's ELEMENT TYPE with the selected country, and this is not
  // theoretical — VERIFIED LIVE: with no country chosen the field renders as input#provinceInput
  // (name="shippingAddress.stateOrProvince"), and selecting "United States" REPLACES it with
  // select#provinceCodeInput. Both are configured and CheckoutPage.fillRegion() picks whichever is
  // actually in the DOM at the time.
  provinceSelect: 'select#provinceCodeInput',
  provinceInput: 'input#provinceInput',
  shippingContinue: 'button#checkout-shipping-continue',
  // Saved-address picker. When the signed-in customer has ANY address in their address book,
  // BigCommerce renders this dropdown INSTEAD of the blank address form, and #countryCodeInput
  // does not exist until "Enter a new address" is clicked.
  addressToggle: 'a#addressToggle',
  // The menu the toggle opens. VERIFIED LIVE (Sept 15 2026): it is named by the toggle's
  // aria-controls, is NOT in the DOM at all until the toggle is clicked, and is NOT a descendant of
  // the toggle's parent — so it has to be located by its own id, not by traversing from the toggle.
  // It is a scrolling container (max-height 185px, overflow-y:scroll) holding one <li> per saved
  // address plus the "new address" entry.
  addressDropdownMenu: 'ul#addressDropdown',
  // The "Enter a new address" entry inside that menu. VERIFIED LIVE: it carries a stable
  // data-test hook and is the FIRST item in the list, above every saved address — so it needs no
  // scrolling however large the address book grows. checkout.newAddressLinkText is the text
  // fallback, kept for a storefront that ships a different checkout-js build or a localized one
  // (PDA) where the data-test attribute might not survive.
  newAddressLink: 'a[data-test="add-new-address"]',
  // "Save this address in my address book." VERIFIED LIVE: it ships UNCHECKED on BESTUS, so the
  // spec's job is to KEEP it that way, not to change it — the account is shared and already holds
  // 28 addresses from other teams' manual testing. Matched on `name`, not `id`: the id is the
  // literal string "shippingAddress.shouldSaveAddress", whose dot would have to be CSS-escaped.
  // Nullable — set to null on a store whose theme ships no such checkbox.
  saveAddressCheckbox: 'input[name="shippingAddress.shouldSaveAddress"]',
  // "Checkout is mid-update" — checkout-js's overlay while a consignment round-trips.
  // Deliberately NOT '.loadingOverlay-container': that wrapper is present and visible at ALL
  // times (verified live), so keying on it would make the idle wait permanently false. The inner
  // .loadingOverlay is the transient one. '.loading-skeleton' is likewise excluded — it is a
  // lazy-render placeholder, not an update indicator.
  loadingOverlay: '.loadingOverlay',
  // Billing is normally auto-skipped via #sameAsBilling (checked by default), but a store that
  // unchecks it would stop here, so the continue button is configured and clicked only if the
  // billing step actually becomes active. Nullable: set to null on a store with no billing step.
  billingContinue: 'button#checkout-billing-continue',

  // Shipping method. The radio's name differs between single-consignment and multi-shipping
  // (shippingOptionIds vs shippingOptionIds.<consignmentId>), hence the ^= plus two
  // container-scoped fallbacks. Not yet observed live — options only render once the address
  // validates and a carrier quote returns.
  shippingOptionRadio:
    'input[type="radio"][name^="shippingOptionIds"], .shippingOptionsList input[type="radio"], ' +
    '.shippingOptions-container input[type="radio"]',

  // Payment step — ASSERTION TARGET ONLY. Nothing in this suite ever submits it: CheckoutPage has
  // no placeOrder() method, and the order guard in e2e.js blocks the endpoint regardless. The
  // assertion deliberately rides on the step container going active rather than on any inner
  // payment-provider markup, which varies per store and per enabled gateway.
  paymentSubmit: '#checkout-payment-continue',
};

/** The store's checkout selectors: BigCommerce defaults merged with checkout.selectors. */
export function checkoutSelectors() {
  const { checkout } = getStore();
  return { ...CHECKOUT_SELECTOR_DEFAULTS, ...((checkout && checkout.selectors) || {}) };
}

// Non-selector checkout defaults. Mirrors footerConfig()'s shape (a merged config object, not just
// selectors) rather than plpSelectors()'s.
const CHECKOUT_DEFAULTS = {
  path: '/checkout',
  quantity: 1,
  signInLinkText: 'Sign in now',
  minShippingOptions: 1,
  // Text of the "use a different address" entry in the saved-address picker. Only a FALLBACK now —
  // the entry carries a data-test hook (selectors.newAddressLink) which is matched first. Kept
  // because a localized storefront is the case most likely to need it.
  newAddressLinkText: 'Enter a new address',
  // How long to let the checkout settle after the address is complete, before asking for a
  // shipping quote. checkout-js debounces address edits and then POSTs a consignment; asking for
  // the quote too early is how the shipping step ends up quoting the PREVIOUS address. In config
  // rather than hardcoded so a slower store can raise it without a code change.
  addressSettleMs: 2000,
  // Store-specific required fields on the shipping form, filled after the standard address. A
  // BigCommerce merchant can add arbitrary custom checkout fields, and a required one blocks the
  // carrier quote — with no DOM signal at all, since BigCommerce marks them required only in the
  // label TEXT ("(Required)"), never with a `required` attribute. Entries are
  // { selector, type: 'radio'|'checkbox'|'text'|'select', value? }.
  customFields: [],
  // null, not [] — an un-triaged store must not silently inherit a console-error assertion that
  // nobody has actually looked at. null makes the console test skip with a reason.
  consoleIgnore: null,
};

/**
 * The store's checkout config (defaults merged), or null when checkout is not configured.
 * Returns null rather than a defaults-only object so describeIfStore(checkoutConfig(), …) gates
 * correctly on the stores that carry "checkout": null.
 */
export function checkoutConfig() {
  const { checkout } = getStore();
  if (!checkout) return null;
  const { selectors, ...rest } = checkout;
  return { ...CHECKOUT_DEFAULTS, ...rest };
}

/**
 * Merges the store's top-level `personaOverrides` (stores/<code>.json) over a
 * persona fixture. Lets a store localize form input data — BESTUS overrides the
 * shared fixture's Canadian address with a US one because its forms must be
 * submitted with US addresses. Stores without the key get the fixture as-is.
 */
export function storePersona(base) {
  return { ...base, ...(getStore().personaOverrides || {}) };
}

/**
 * Builds a visitable URL from a store-relative path, honoring the store's
 * visitQuery quirk (e.g. AAP requires ?redirect=disable on every visit).
 */
export function storePath(p) {
  const { visitQuery } = getStore();
  if (!visitQuery) return p;
  return p + (p.includes('?') ? '&' : '?') + visitQuery;
}

/** The store's homepage path (FSE's homepage is /new-home/, not /). */
export function homePath() {
  return storePath(getStore().homePath || '/');
}
