/**
 * PDP – Mobile Layout Tests
 *
 * Runs the shared device matrix (see cypress/support/devices.js) against the Product
 * Detail Page. A random product URL from site.json's pdp.popular is chosen per device,
 * and each device loads the page once (testIsolation:false). Layout findings — the hidden
 * desktop footer, the div.mobile-menu drawer, and the 44px/24px touch-target thresholds —
 * are documented in devices.js.
 *
 * Not retested here (viewport-agnostic, covered in pdp.cy.js): PDF spec links, YouTube
 * iframe, SearchSpring recently-viewed script, footer sections.
 */
import { ALL_DEVICES, PHONES, MOBILE_NAV } from '../support/devices.js';
import {
  assertBreadcrumbs,
  assertProductInfoForm,
  assertNoHorizontalOverflow,
  assertMaxTouchTarget,
  blockThirdParty,
  makeConsoleErrorSpy,
  pickRandom,
} from '../support/checks.js';
import { getStore, describeIfStore, itIfStore, storePath, pdpSelectors, anyHeaderSelector } from '../support/store.js';

const site = getStore();
const sel = pdpSelectors();
// Mobile OR desktop header — themes switch at their own breakpoints (see store.js).
const header = anyHeaderSelector();

// ─── Shared URL ──────────────────────────────────────────────────────────────
// One product URL is picked once per spec run and reused across all devices so
// that the overflow check is consistent. If each device picked independently via
// pickRandom(), different products could produce different overflow results —
// masking real bugs on some products and producing false failures on others
// (confirmed: two 412px devices can disagree when testing different products).
const pdpUrl = site.pdp && storePath(pickRandom(site.pdp.popular));

// ═════════════════════════════════════════════════════════════════════════════
// Portrait tests — all devices
// ═════════════════════════════════════════════════════════════════════════════
ALL_DEVICES.forEach(({ name, width, height, touchTarget }) => {
  describeIfStore(site.pdp, `PDP – ${name} (${width}x${height})`, { testIsolation: false }, () => {
    const consoleErrors = makeConsoleErrorSpy();
    // Set at runtime in before() — see pdp.cy.js for why this can't be static config.
    let quoteOnlyProduct = false;

    before(() => {
      blockThirdParty();
      cy.viewport(width, height);
      cy.task('log', `[pdp.mobile.cy.js] PDP under test (${name}): ${pdpUrl}`);
      cy.log(`**PDP under test:** ${pdpUrl}`);
      cy.visit(pdpUrl, { onBeforeLoad: consoleErrors.onBeforeLoad });
      cy.get('body').then(($body) => {
        quoteOnlyProduct = $body.find(sel.addToCart).length === 0;
        if (quoteOnlyProduct) {
          cy.task('log', `[pdp.mobile.cy.js] detected quote-only product (${name}), skipping price/qty/cart/lead-time: ${pdpUrl}`);
        }
      });
    });

    // Cypress resets the viewport to the config default (1920x1080) before each test —
    // even under testIsolation:false — so re-assert the device viewport here. The page
    // was loaded at this width in before(); this just reflows it back to mobile.
    beforeEach(() => {
      cy.viewport(width, height);
    });

    it('has no console errors', () => {
      consoleErrors.assertClean();
    });

    it('loads with header visible', () => {
      cy.get(header).filter(':visible').should('have.length.at.least', 1);
    });

    // Some themes hide the breadcrumb trail on mobile (BESTCA: nav.Breadcrumb is display:none
    // below desktop widths) — gate the visibility assertion behind pdp.mobileBreadcrumbsHidden.
    itIfStore(!(site.pdp && site.pdp.mobileBreadcrumbsHidden), 'renders breadcrumbs with Home and at least one category link', () => {
      assertBreadcrumbs();
    }, "store theme hides breadcrumbs on mobile (pdp.mobileBreadcrumbsHidden)");

    it('shows a non-empty product title', () => {
      cy.get(sel.title).invoke('text').should('not.be.empty');
    });

    it('displays a sale price', function () {
      if ((site.pdp && site.pdp.quoteOnly) || quoteOnlyProduct) return this.skip();
      cy.get(sel.price).invoke('text').should('match', /\$[\d,]+(\.\d{2})?/);
    });

    it('shows at least one product image with a valid src', () => {
      cy.get('section[data-image-gallery]').should('exist');
      cy.get(sel.galleryImage).first().invoke('attr', 'src').should('not.be.empty');
    });

    it('quantity input is visible and defaults to 1', function () {
      if ((site.pdp && site.pdp.quoteOnly) || quoteOnlyProduct) return this.skip();
      cy.get(sel.qtyInput).should('be.visible').and('have.value', '1');
      // Stepper buttons are nullable — BESTCA's Snap theme has none (see PDP_SELECTOR_DEFAULTS).
      // 'exist' (not 'be.visible') is deliberate: mobile specs assert DOM presence for elements
      // themes hide at phone widths (see "Mobile Testing Pattern" in CLAUDE.md).
      if (sel.qtyIncrement) cy.get(sel.qtyIncrement).should('exist');
      if (sel.qtyDecrement) cy.get(sel.qtyDecrement).should('exist');
    });

    it('Add to Cart button is visible and not disabled', function () {
      if ((site.pdp && site.pdp.quoteOnly) || quoteOnlyProduct) return this.skip();
      cy.get(sel.addToCart).should('be.visible').and('not.be.disabled');
    });

    it('description section is present and has content', () => {
      cy.get(sel.description).invoke('text').should('not.be.empty');
    });

    itIfStore(sel.relatedCarousel, 'related products carousel renders with items', () => {
      cy.get(sel.relatedCarousel).should('exist').children().should('have.length.at.least', 1);
    }, "store theme has no related-products carousel (pdp.selectors.relatedCarousel is null)");

    it('SKU is displayed', () => {
      cy.get(sel.sku).invoke('text').should('not.be.empty');
    });

    it('lead time / stock status is displayed', function () {
      if ((site.pdp && site.pdp.quoteOnly) || quoteOnlyProduct) return this.skip();
      cy.get(sel.leadTime).invoke('text').should('not.be.empty');
    });

    itIfStore(sel.productInfoForm, 'product info request form is present with required fields', () => {
      assertProductInfoForm();
    }, "store theme has no product-info request form (pdp.selectors.productInfoForm is null)");

    it('mobile navigation is present', () => {
      cy.get(MOBILE_NAV).should('exist');
    });

    it('has no horizontal overflow', () => {
      assertNoHorizontalOverflow(width);
    });

    // BESTCA's mobile header renders its logo/icons via a lazy-loaded image + icon fonts and
    // opens a Klaviyo popup that locks the body — under Electron this leaves zero header
    // interactive elements measurable as :visible (the 53px logo renders fine in real browsers).
    // branding.skipMobileTouchTarget skips it in Electron only; Chrome/Firefox still run it.
    // branding.skipTouchTarget skips it in every browser: a known header touch-target
    // deficiency the store's dev team has reviewed and chosen to keep as-is (AAP, FSE).
    itIfStore(!(site.branding.skipTouchTarget || (site.branding.skipMobileTouchTarget && Cypress.browser.name === 'electron')), `interactive header elements meet minimum touch target height (${touchTarget}px)`, () => {
      assertMaxTouchTarget(touchTarget);
    }, site.branding.skipTouchTarget
      ? "known header touch-target deficiency, kept as-is per store dev team (branding.skipTouchTarget)"
      : "header touch targets unmeasurable under Electron (skipMobileTouchTarget); runs in Chrome/Firefox");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Landscape tests — phones only
// ═════════════════════════════════════════════════════════════════════════════
PHONES.forEach(({ name, width, height }) => {
  describeIfStore(site.pdp, `PDP – ${name} landscape (${height}x${width})`, { testIsolation: false }, () => {
    before(() => {
      blockThirdParty();
      cy.viewport(height, width); // landscape: swap width and height
      cy.task('log', `[pdp.mobile.cy.js] PDP under test (${name} landscape): ${pdpUrl}`);
      cy.log(`**PDP under test:** ${pdpUrl}`);
      cy.visit(pdpUrl);
    });

    beforeEach(() => {
      cy.viewport(height, width);
    });

    it('shows a non-empty product title', () => {
      cy.get(sel.title).invoke('text').should('not.be.empty');
    });

    it('has no horizontal overflow', () => {
      assertNoHorizontalOverflow(height);
    });
  });
});
