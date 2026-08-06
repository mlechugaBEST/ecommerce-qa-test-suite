/**
 * Product Discovery – Mobile Layout Tests
 *
 * Runs the shared device matrix (see cypress/support/devices.js) against discovery surfaces:
 * a category/refinement page and a search-results page. Per device, the category page loads
 * once (testIsolation:false) and the read-only checks share that visit; the search test runs
 * last because it navigates away. Layout findings (hidden desktop footer, the div.mobile-menu
 * drawer, mobile-collapsed sidebar) are documented in devices.js.
 */
import {
  assertDiscoveryPage,
  assertNoHorizontalOverflow,
  assertSearchResults,
  blockThirdParty,
  makeConsoleErrorSpy,
  performHeaderSearch,
} from '../support/checks.js';
import { ALL_DEVICES, MOBILE_NAV } from '../support/devices.js';
import { getStore, describeIfStore, storePath } from '../support/store.js';

const site = getStore();
const discovery = site.discovery || {};

describeIfStore(site.discovery, 'Product discovery mobile', () => {
  ALL_DEVICES.forEach(({ name, width, height }) => {
    describe(`Discovery – ${name} (${width}x${height})`, { testIsolation: false }, () => {
      const consoleErrors = makeConsoleErrorSpy();

      before(() => {
        blockThirdParty();
        cy.viewport(width, height);
        cy.visit(storePath(discovery.mobileCategory), { onBeforeLoad: consoleErrors.onBeforeLoad });
      });

      // Cypress resets the viewport to the config default before each test, even under
      // testIsolation:false — re-assert the device viewport so the page reflows to mobile.
      beforeEach(() => {
        cy.viewport(width, height);
      });

      it('has no console errors', () => {
        consoleErrors.assertClean();
      });

      it('renders a category page without horizontal overflow', () => {
        assertDiscoveryPage();
        cy.get(MOBILE_NAV).should('exist');
        assertNoHorizontalOverflow(width);
      });

      // Runs last: navigates away from the shared category visit to the search-results page.
      it('renders search results without horizontal overflow', () => {
        performHeaderSearch(discovery.search.knownTerm);
        // Some themes render the results heading as a non-h1 (BESTCA: <h2 class="page-heading">),
        // so accept a bare .page-heading too — same union assertDiscoveryPage uses. Other stores'
        // results page has no title heading at all (ADC renders only sidebar <h2> labels, no
        // results <h1>) — gate via discovery.search.resultsHaveHeading:false. The products check
        // below still proves the search rendered.
        if (discovery.search.resultsHaveHeading !== false) {
          // filter(':visible') mirrors assertDiscoveryPage/discovery.cy.js — some themes render
          // hidden mobile-only headings (ADC/ADAP) that .first() would otherwise grab.
          cy.get('h1.page-heading, .page-heading, h1').filter(':visible').first().should('exist').invoke('text').should('not.be.empty');
        }
        assertSearchResults(discovery.search.expectedTokens);
        cy.get(MOBILE_NAV).should('exist');
        assertNoHorizontalOverflow(width);
      });
    });
  });
});
