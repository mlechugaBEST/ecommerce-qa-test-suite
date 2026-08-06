import { assertBreadcrumbs, assertProductInfoForm, blockThirdParty, makeConsoleErrorSpy, pickRandom } from '../support/checks.js';
import { getStore, describeIfStore, itIfStore, storePath, pdpSelectors } from '../support/store.js';

const site = getStore();
const sel = pdpSelectors();

// A random product URL from the store's pdp.popular list is chosen each run. All checks
// are read-only, so the page is loaded once (testIsolation:false) and shared across tests.
describeIfStore(site.pdp, 'Product Detail Page', { testIsolation: false }, () => {
  const consoleErrors = makeConsoleErrorSpy();
  // Set at runtime in before() — some stores mix call-for-pricing (quote-only) SKUs
  // into an otherwise fully-priced catalog, so this can't be known from static config
  // the way pdp.quoteOnly (a whole-store fact) is. Detected via Add to Cart absence.
  let quoteOnlyProduct = false;

  before(() => {
    blockThirdParty();
    const pdpUrl = storePath(pickRandom(site.pdp.popular));
    cy.task('log', `[pdp.cy.js] PDP under test: ${pdpUrl}`);
    cy.log(`**PDP under test:** ${pdpUrl}`);
    cy.visit(pdpUrl, { onBeforeLoad: consoleErrors.onBeforeLoad });
    cy.get('body').then(($body) => {
      quoteOnlyProduct = $body.find(sel.addToCart).length === 0;
      if (quoteOnlyProduct) {
        cy.task('log', `[pdp.cy.js] detected quote-only product, skipping price/qty/cart/lead-time: ${pdpUrl}`);
      }
    });
  });

  // ─── Page structure ────────────────────────────────────────────────────────

  it('loads without console errors', () => {
    consoleErrors.assertClean();
  });

  it('renders breadcrumbs with Home and at least one category link', () => {
    assertBreadcrumbs();
  });

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
    if (sel.qtyIncrement) cy.get(sel.qtyIncrement).should('be.visible');
    if (sel.qtyDecrement) cy.get(sel.qtyDecrement).should('be.visible');
  });

  it('Add to Cart button is visible and not disabled', function () {
    if ((site.pdp && site.pdp.quoteOnly) || quoteOnlyProduct) return this.skip();
    cy.get(sel.addToCart).should('be.visible').and('not.be.disabled');
  });

  // ─── Content sections ──────────────────────────────────────────────────────

  it('spec sheet links open PDFs in a new tab', () => {
    cy.get('a[href*=".pdf"]').should('have.length.at.least', 1).each(($a) => {
      expect($a.attr('href')).to.match(/\.pdf$/i);
      // Some stores (ADAP) don't set target="_blank" on every spec-sheet link.
      if (sel.pdfNewTab) expect($a.attr('target')).to.eq('_blank');
    });
  });

  it('description section is present and has content', () => {
    cy.get(sel.description).invoke('text').should('not.be.empty');
  });

  it('YouTube video is present when a video section exists', () => {
    cy.get('body').then(($body) => {
      if ($body.find('.product-video').length) {
        // Themes embed the video differently: BESTUS uses a lazy <iframe data-src=…youtube…>,
        // ADAP uses the <lite-youtube videoid="…"> web component (which only injects the real
        // iframe on click), and some use a plain <iframe src=…youtube…>. Accept any of them.
        cy.get('.product-video iframe[data-src*="youtube"], .product-video iframe[src*="youtube"], .product-video lite-youtube[videoid]').should('exist');
      }
    });
  });

  itIfStore(sel.relatedCarousel, 'related products carousel renders with items', () => {
    cy.get(sel.relatedCarousel).should('exist').children().should('have.length.at.least', 1);
  }, "store theme has no related-products carousel (pdp.selectors.relatedCarousel is null)");

  itIfStore(sel.reviewsContainer, 'reviews section and Yotpo widget are present', () => {
    cy.get(sel.reviewsContainer).should('exist');
    cy.get('.yotpo-widget-instance')
      .should('exist')
      .invoke('attr', 'data-yotpo-product-id')
      .should('not.be.empty');
  }, "store theme has no reviews widget (pdp.selectors.reviewsContainer is null)");

  // Profile is store-dependent — BESTCA's Snap theme emits "similar" rather than "recently-viewed".
  // ADC's theme ships no SearchSpring recommendations script at all, so it sets
  // pdp.recentlyViewedProfile:null to skip this check.
  itIfStore(!(site.pdp && site.pdp.recentlyViewedProfile === null), 'recently viewed SearchSpring script tag is present', () => {
    const profile = (site.pdp && site.pdp.recentlyViewedProfile) || 'recently-viewed';
    cy.get(`script[type="searchspring/personalized-recommendations"][profile="${profile}"]`).should('exist');
  }, "store theme ships no SearchSpring recommendations script (pdp.recentlyViewedProfile is null)");

  // ─── Product info request form ─────────────────────────────────────────────

  itIfStore(sel.productInfoForm, 'product info request form is present with required fields', () => {
    assertProductInfoForm();
  }, "store theme has no product-info request form (pdp.selectors.productInfoForm is null)");

  // ─── SKU and meta ──────────────────────────────────────────────────────────

  it('SKU is displayed', () => {
    cy.get(sel.sku).invoke('text').should('not.be.empty');
  });

  it('lead time / stock status is displayed', function () {
    if ((site.pdp && site.pdp.quoteOnly) || quoteOnlyProduct) return this.skip();
    cy.get(sel.leadTime).invoke('text').should('not.be.empty');
  });
});
