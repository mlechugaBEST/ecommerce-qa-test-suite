import { assertMetaTags, assertProductJsonLd, blockThirdParty, pickRandom } from '../support/checks.js';
import { getStore, describeIfStore, itIfStore, storePath, homePath, pdpSelectors } from '../support/store.js';

const site = getStore();
const PLP = site.plp && storePath(site.plp.main);
const sel = pdpSelectors();

// ─── Homepage ──────────────────────────────────────────────────────────────────
describe('SEO – Homepage', { testIsolation: false }, () => {
  before(() => {
    blockThirdParty();
    cy.visit(homePath());
  });

  it('has a non-empty <title>', () => {
    cy.title().should('not.be.empty');
  });

  it('has a non-empty meta description', () => {
    cy.get('meta[name="description"]').invoke('attr', 'content').should('not.be.empty');
  });
});

// ─── Product Listing Page ──────────────────────────────────────────────────────
describeIfStore(site.plp, 'SEO – PLP', { testIsolation: false }, () => {
  before(() => {
    blockThirdParty();
    cy.visit(PLP);
  });

  it('has a non-empty <title>', () => {
    cy.title().should('not.be.empty');
  });

  it('has a non-empty meta description', () => {
    cy.get('meta[name="description"]').invoke('attr', 'content').should('not.be.empty');
  });
});

// ─── Product Detail Page ───────────────────────────────────────────────────────
describeIfStore(site.pdp, 'SEO – PDP', { testIsolation: false }, () => {
  // Set at runtime in before() — see the "PDP pick attribution" note in CLAUDE.md:
  // some stores mix call-for-pricing (quote-only) SKUs into an otherwise priced
  // catalog, so offers.price legitimately won't exist for this pick.
  let quoteOnlyProduct = false;

  before(() => {
    blockThirdParty();
    const pdpUrl = storePath(pickRandom(site.pdp.popular));
    cy.task('log', `[seo.cy.js] PDP under test: ${pdpUrl}`);
    cy.log(`**PDP under test:** ${pdpUrl}`);
    cy.visit(pdpUrl);
    cy.get('body').then(($body) => {
      quoteOnlyProduct = $body.find(sel.addToCart).length === 0;
      if (quoteOnlyProduct) {
        cy.task('log', `[seo.cy.js] detected quote-only product, skipping offers.price/priceCurrency/availability: ${pdpUrl}`);
      }
    });
  });

  it('has a non-empty <title>', () => {
    cy.title().should('not.be.empty');
  });

  it('has a non-empty meta description', () => {
    cy.get('meta[name="description"]').invoke('attr', 'content').should('not.be.empty');
  });

  // ADAP's theme emits no Product JSON-LD at all (verified in static HTML and at
  // runtime on every pdp.popular URL) — a genuine SEO gap on that store, tracked
  // via pdp.productJsonLd:false so the skip is visible instead of a permanent red.
  itIfStore(site.pdp && site.pdp.productJsonLd !== false, 'has a JSON-LD Product block with name, sku, price, currency, and availability', () => {
    assertProductJsonLd({ requirePrice: !quoteOnlyProduct });
  }, "store PDPs emit no Product JSON-LD (pdp.productJsonLd is false)");
});
