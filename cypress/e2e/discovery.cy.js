/**
 * Product Discovery — search, category/refinement pages, sorting, pagination, and the
 * handoff from results into a PDP. All checks run against the live store in stub mode
 * (no form POSTs). Each test navigates on its own, so this spec uses default isolation.
 *
 * Selectors and the cross-page assertions (search, sort, pagination) live in
 * cypress/support/checks.js so they read as documented helpers.
 */
import {
  applySortOption,
  assertDiscoveryPage,
  assertNoSearchResults,
  assertPaginationAdvanced,
  assertSearchResults,
  assertSortApplied,
  getVisibleProductTitles,
  makeConsoleErrorSpy,
  performHeaderSearch,
  productCardSelector,
  waitForProducts,
} from '../support/checks.js';
import { getStore, describeIfStore, itIfStore, storePath } from '../support/store.js';

const site = getStore();
const discovery = site.discovery || {};

describeIfStore(site.discovery, 'Product discovery', () => {
  // ─── Console health ──────────────────────────────────────────────────────────
  describe('Console health', () => {
    it('renders a discovery category without console errors', () => {
      const consoleErrors = makeConsoleErrorSpy();
      cy.visit(storePath(discovery.sort.category), { onBeforeLoad: consoleErrors.onBeforeLoad });
      waitForProducts();
      consoleErrors.assertClean();
    });
  });

  // ─── Search ────────────────────────────────────────────────────────────────────
  describe('Search', () => {
    it('returns products for a known product term', () => {
      performHeaderSearch(discovery.search.knownTerm);
      assertSearchResults(discovery.search.expectedTokens);
    });

    itIfStore(discovery.search.noResultsTerm, 'shows a no-results message for a nonsense search term', () => {
      performHeaderSearch(discovery.search.noResultsTerm);
      assertNoSearchResults();
    }, 'store uses native BC search which always returns results — no zero-result state (discovery.search.noResultsTerm is null)');
  });

  // ─── Categories and refinement pages ─────────────────────────────────────────
  describe('Categories and refinement pages', () => {
    it('renders each representative discovery category', () => {
      discovery.categories.forEach((path) => {
        cy.visit(storePath(path));
        assertDiscoveryPage();
      });
    });
  });

  // ─── Sorting ─────────────────────────────────────────────────────────────────
  describe('Sorting', () => {
    it('sorts products by price low to high', () => {
      cy.visit(storePath(discovery.sort.category));
      waitForProducts(3);

      // Capture the default (Bestselling) order so we can prove the sort changed it. We can't
      // assert numeric price order here: the cheapest items are "Call for pricing" (no price) and
      // sort to the top, so the visible grid often shows no prices. assertSortApplied verifies the
      // sort took effect (hash + re-rendered set) and checks ascending order only if prices show.
      getVisibleProductTitles().then((defaultOrder) => {
        applySortOption(discovery.sort.label, {
          urlHash: discovery.sort.urlHash,
          queryParam: discovery.sort.queryParam,
          queryValue: discovery.sort.queryValue,
        }).then(() => {
          assertSortApplied(defaultOrder, { expectedHash: discovery.sort.urlHash });
        });
      });
    });
  });

  // ─── Pagination ──────────────────────────────────────────────────────────────
  describe('Pagination', () => {
    it('moves to page 2 and loads a different set of products', () => {
      cy.visit(storePath(discovery.multiPageCategory));
      waitForProducts(3);

      getVisibleProductTitles().then((pageOneTitles) => {
        cy.get('.ss__pagination, .ss-pagination-container, .pagination-list').filter(':visible').first().within(() => {
          cy.get(
            '.ss-page-next a.ss-page-link, a.ss-page-link[href*="pp=2"], .pagination-item--next a, a.pagination-link[href*="page=2"], a.ss__pagination__link[href*="page=2"], a.ss__pagination__link[href*="p=2"]'
            // force: marketing popups (e.g. Klaviyo) can cover the link; navigation still succeeds.
          ).first().click({ force: true });
        });
        assertPaginationAdvanced(pageOneTitles);
      });
    });
  });

  // ─── PDP handoff ─────────────────────────────────────────────────────────────
  describe('PDP handoff', () => {
    it('opens a PDP from discovery results', () => {
      performHeaderSearch(discovery.search.knownTerm);
      waitForProducts();
      cy.get(productCardSelector()).first().find('.card-title a').click({ force: true });
      // filter(':visible'): ADC's PDP renders a hidden mobile-only h1.productView-title.Mobile_title
      // first in the DOM, so .first() alone would grab the display:none element.
      cy.get('h1.productView-title, h1').filter(':visible').first().should('be.visible').invoke('text').should('not.be.empty');
      // Native BC search appends search_query to the destination PDP URL — skip for those stores.
      if (discovery.search.pdpUrlClean !== false) {
        cy.url().should('not.include', 'search_query');
      }
    });
  });
});
