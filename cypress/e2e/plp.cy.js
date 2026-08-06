import { waitForProducts, assertProductCards, blockThirdParty, makeConsoleErrorSpy, productCardSelector } from '../support/checks.js';
import { getStore, describeIfStore, itIfStore, storePath, plpSelectors } from '../support/store.js';

const site = getStore();
const plp = site.plp || {};
const sel = plpSelectors();
const PLP = plp.main && storePath(plp.main);
const SUBCAT = plp.subcategory && storePath(plp.subcategory);

// Read-only PLP checks share one page load (testIsolation:false). The navigation test
// (which leaves the page) lives in its own default-isolation block at the bottom.
describeIfStore(site.plp, 'Product Listing Page', { testIsolation: false }, () => {
  const consoleErrors = makeConsoleErrorSpy();

  before(() => {
    blockThirdParty();
    cy.visit(PLP, { onBeforeLoad: consoleErrors.onBeforeLoad });
  });

  it('has no console errors on page load', () => {
    consoleErrors.assertClean();
  });

  // ─── Page structure ────────────────────────────────────────────────────────

  it('loads with correct heading and breadcrumb', () => {
    cy.get(sel.heading).should('contain.text', plp.mainHeading);
    cy.get(sel.breadcrumbs).within(() => {
      if (sel.breadcrumbHome) cy.get(sel.breadcrumbHome).should('be.visible');
      cy.contains('a', plp.breadcrumbLabel).should('be.visible');
    });
  });

  itIfStore(sel.sidebar, 'sidebar is visible with category navigation', () => {
    cy.get(sel.sidebar).should('be.visible');
    cy.get(sel.sidebarBlocks).should('have.length.at.least', sel.sidebarBlocksMin);
    cy.get(sel.sidebarLinks).each(($a) => {
      expect($a.text().trim()).to.not.be.empty;
    });
  }, "store theme has no category sidebar (plp.selectors.sidebar is null)");

  itIfStore(sel.bestSellers, 'best sellers sidebar block renders with labelled links', () => {
    cy.get(sel.bestSellers).should('have.length.at.least', 1).each(($a) => {
      expect($a.text().trim()).to.not.be.empty;
    });
  }, "store theme has no best-sellers sidebar block (plp.selectors.bestSellers is null)");

  itIfStore(sel.subcategoryBox, 'subcategory boxes render with non-empty titles and valid links', () => {
    cy.get(sel.subcategoryBox).should('have.length.at.least', 1).each(($box) => {
      expect($box.find(sel.subcategoryTitle).text().trim()).to.not.be.empty;
      const href = $box.find(sel.subcategoryLink).attr('href');
      expect(href).to.not.be.empty;
      expect(href).to.include('/');
    });
  }, "store theme has no subcategory boxes (plp.selectors.subcategoryBox is null)");

  // ─── Product grid ──────────────────────────────────────────────────────────

  it('renders products on the top-level PLP', () => {
    waitForProducts(1);
  });

  it('each product card has an image, title, price, and link', () => {
    waitForProducts();
    assertProductCards(3);
  });

  // ─── Pagination ────────────────────────────────────────────────────────────

  it('pagination controls are present after products load', () => {
    waitForProducts();
    cy.get('[class*="pagination"], [class*="Pagination"], [aria-label*="pagination"], [aria-label*="page"]')
      .should('exist');
  });

  itIfStore(sel.pagination, 'pagination marks page 1 active and links to further pages including page 2', () => {
    // Pagination is rendered more than once (top + bottom of the grid); scope to the
    // first visible copy so .within() gets a single element.
    cy.get(sel.pagination.container).filter(':visible').should('have.length.at.least', 1).first().within(() => {
      // Current page (1) is marked active and rendered as a non-clickable label.
      cy.get(sel.pagination.active).should('contain.text', '1');
      // Multiple pages are linked.
      cy.get(sel.pagination.links).should('have.length.at.least', 2);
      // The "Next" control points to page 2. BESTUS's SearchSpring uses the `pp` query
      // param, not `page` — don't "correct" this; it's per-store via pageTwoToken.
      cy.get(sel.pagination.next).should('have.attr', 'href').and('include', sel.pagination.pageTwoToken);
    });
  }, "store theme has no detailed pagination markup (plp.selectors.pagination is null)");

  // ─── Link health ───────────────────────────────────────────────────────────

  itIfStore(sel.sidebar, 'sidebar category links all resolve without 404', () => {
    cy.assertLinksResolve(sel.sidebarLinks);
  }, "store theme has no category sidebar (plp.selectors.sidebar is null)");
});

// ─── Subcategory page (separate URL, read-only) ────────────────────────────────
describeIfStore(site.plp && plp.subcategory, 'PLP subcategory page', { testIsolation: false }, () => {
  before(() => {
    cy.visit(SUBCAT);
  });

  it('shows correct heading and breadcrumb trail', () => {
    cy.get(sel.heading).invoke('text').should('not.be.empty');
    cy.get(sel.breadcrumbs).within(() => {
      cy.contains('a', plp.breadcrumbLabel).should('be.visible');
    });
  });

  it('loads products on the subcategory page', () => {
    waitForProducts();
  });

  itIfStore(sel.sidebar, 'subcategory page has a sidebar', () => {
    cy.get(sel.sidebar).should('exist');
  }, 'store theme has no category sidebar (plp.selectors.sidebar is null)');
});

// ─── Navigation (leaves the page → needs fresh isolation) ──────────────────────
describeIfStore(site.plp, 'PLP navigation', () => {
  it('clicking a product card navigates to the PDP', () => {
    cy.visit(PLP);
    waitForProducts();
    // force: marketing popups (e.g. Klaviyo) can cover the card link.
    cy.get(productCardSelector()).first().find('.card-title a').click({ force: true });
    cy.url().should('not.include', plp.main);
    cy.get('h1').should('be.visible');
  });
});
