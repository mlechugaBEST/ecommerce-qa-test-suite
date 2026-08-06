/**
 * PLP – Mobile Layout Tests
 *
 * Runs the shared device matrix (see cypress/support/devices.js) against the Product
 * Listing Page. Each device loads the page once (testIsolation:false). Layout findings —
 * the collapsed .categories-left sidebar and the div.mobile-menu drawer — are documented
 * in devices.js.
 *
 * Not retested here (viewport-agnostic, covered in plp.cy.js): 404 link-resolution,
 * pagination JSON blob, card→PDP navigation, SearchSpring subcategory sidebar.
 */
import { ALL_DEVICES, PHONES, MOBILE_NAV } from '../support/devices.js';
import {
  waitForProducts,
  assertProductCards,
  assertNoHorizontalOverflow,
  blockThirdParty,
  makeConsoleErrorSpy,
} from '../support/checks.js';
import { getStore, describeIfStore, itIfStore, storePath, plpSelectors } from '../support/store.js';

const site = getStore();
const plp = site.plp || {};
const sel = plpSelectors();
const PLP = plp.main && storePath(plp.main);

// ═════════════════════════════════════════════════════════════════════════════
// Portrait tests — all devices
// ═════════════════════════════════════════════════════════════════════════════
ALL_DEVICES.forEach(({ name, width, height }) => {
  describeIfStore(site.plp, `PLP – ${name} (${width}x${height})`, { testIsolation: false }, () => {
    const consoleErrors = makeConsoleErrorSpy();

    before(() => {
      blockThirdParty();
      cy.viewport(width, height);
      cy.visit(PLP, { onBeforeLoad: consoleErrors.onBeforeLoad });
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

    it('loads with correct heading and breadcrumb', () => {
      cy.get(sel.heading).should('contain.text', plp.mainHeading);
      cy.get(sel.breadcrumbs).within(() => {
        if (sel.breadcrumbHome) cy.get(sel.breadcrumbHome).should('be.visible');
        cy.contains('a', plp.breadcrumbLabel).should('be.visible');
      });
    });

    it('product grid renders', () => {
      waitForProducts(1);
    });

    it('each product card has an image, title, price, and link', () => {
      waitForProducts();
      assertProductCards(3);
    });

    itIfStore(sel.subcategoryBox, 'subcategory boxes render with non-empty titles and valid links', () => {
      cy.get(sel.subcategoryBox).should('have.length.at.least', 1).each(($box) => {
        expect($box.find(sel.subcategoryTitle).text().trim()).to.not.be.empty;
        const href = $box.find(sel.subcategoryLink).attr('href');
        expect(href).to.not.be.empty;
        expect(href).to.include('/');
      });
    }, "store theme has no subcategory boxes (plp.selectors.subcategoryBox is null)");

    itIfStore(sel.sidebar, 'sidebar is present in the DOM', () => {
      // The sidebar is collapsed/hidden on mobile — assert DOM presence only.
      cy.get(sel.sidebar).should('exist');
    }, "store theme has no category sidebar (plp.selectors.sidebar is null)");

    it('has no horizontal overflow', () => {
      assertNoHorizontalOverflow(width);
    });

    it('mobile navigation is present', () => {
      cy.get(MOBILE_NAV).should('exist');
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Landscape tests — phones only
// ═════════════════════════════════════════════════════════════════════════════
PHONES.forEach(({ name, width, height }) => {
  describeIfStore(site.plp, `PLP – ${name} landscape (${height}x${width})`, { testIsolation: false }, () => {
    before(() => {
      blockThirdParty(); // testIsolation:false — intercepts must be registered in before() (see checks.js)
      cy.viewport(height, width); // landscape: swap width and height
      cy.visit(PLP);
    });

    beforeEach(() => {
      cy.viewport(height, width);
    });

    it('loads with correct heading', () => {
      cy.get(sel.heading).should('contain.text', plp.mainHeading);
    });

    it('has no horizontal overflow', () => {
      assertNoHorizontalOverflow(height);
    });
  });
});
