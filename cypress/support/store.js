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
