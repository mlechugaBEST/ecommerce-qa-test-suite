/**
 * Homepage – Mobile Layout Tests
 *
 * Runs the shared device matrix (see cypress/support/devices.js) against the homepage.
 * Each device loads the page once (testIsolation:false) and every assertion runs against
 * that single visit. Layout findings — hidden desktop footer, desktop-only seasonal
 * banners, the div.mobile-menu drawer, and the 44px/24px touch-target thresholds — are
 * documented in devices.js.
 *
 * Not retested here (viewport-agnostic, covered in homepage.cy.js): 404 link-resolution.
 */
import { ALL_DEVICES, PHONES, MOBILE_NAV } from '../support/devices.js';
import {
  assertFooterHeadings,
  assertNoHorizontalOverflow,
  assertMaxTouchTarget,
  blockThirdParty,
  makeConsoleErrorSpy,
} from '../support/checks.js';
import { getStore, itIfStore, homePath, footerConfig, anyHeaderSelector } from '../support/store.js';

const { branding } = getStore();
const footer = footerConfig();
// Mobile OR desktop header — themes switch at their own breakpoints (see store.js).
const header = anyHeaderSelector();

// ═════════════════════════════════════════════════════════════════════════════
// Portrait tests — all devices
// ═════════════════════════════════════════════════════════════════════════════
ALL_DEVICES.forEach(({ name, width, height, touchTarget }) => {
  describe(`Homepage – ${name} (${width}x${height})`, { testIsolation: false }, () => {
    const consoleErrors = makeConsoleErrorSpy();

    before(() => {
      blockThirdParty();
      cy.viewport(width, height);
      cy.visit(homePath(), { onBeforeLoad: consoleErrors.onBeforeLoad });
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

    it('loads with key elements visible', () => {
      cy.get(header).filter(':visible').should('have.length.at.least', 1);
      // The desktop footer is display:none on phone viewports — assert DOM presence only.
      cy.get(footer.rootSelector).should('exist');
      // Desktop-only seasonal banners are display:none on mobile — find a visible main element.
      cy.get('[class*="carousel"], [class*="hero"], [class*="banner"], main, [role="main"]')
        .filter(':visible')
        .should('have.length.at.least', 1);
    });

    it('footer has all four section headings in the DOM', () => {
      assertFooterHeadings('exist');
    });

    it('footer contact info has phone and fax links in the DOM', () => {
      cy.get(footer.contactInfoBox).should('have.length.at.least', footer.minContactBoxes);
      cy.get(footer.phoneLinks)
        .should('have.length.at.least', footer.minPhoneLinks)
        .each(($a) => {
          expect($a.text().trim()).to.match(/[\d\-\(\)\s\+]+/);
        });
    });

    itIfStore(branding.footerLocationText, 'footer shows the store location', () => {
      // Footer-wide: some themes keep the address in sibling text nodes (see homepage.cy.js).
      cy.get('footer').contains(branding.footerLocationText).should('exist');
    });

    itIfStore(branding.warehousesLink, 'footer warehouses link is in the DOM', () => {
      cy.get(`footer a[href="${branding.warehousesLink.href}"]`)
        .should('exist')
        .and('contain.text', branding.warehousesLink.text);
    });

    itIfStore(footer.paymentIcons, 'footer payment icons section exists in the DOM', () => {
      cy.get(footer.paymentIcons).should('exist');
    }, 'store theme has no payment icons in footer');

    it('footer copyright year is current', () => {
      cy.get(footer.copyright).should('contain.text', new Date().getFullYear().toString());
      cy.get(footer.copyright).should('contain.text', branding.copyrightText);
    });

    itIfStore(footer.minPhoneLinks > 0, 'footer phone number exists in the DOM', () => {
      cy.get('footer a[href^="tel:"]').first().invoke('text').then((text) => {
        expect(text.trim()).to.match(/[\d\-\(\)\s\+]+/);
      });
    }, 'store has no phone link in footer (branding.footer.minPhoneLinks: 0)');

    it('has no horizontal overflow', () => {
      assertNoHorizontalOverflow(width);
    });

    it('mobile navigation is present', () => {
      cy.get(MOBILE_NAV).should('exist');
    });

    // BESTCA's mobile header renders its logo/icons via a lazy-loaded image + icon fonts and
    // opens a Klaviyo popup that locks the body — under Electron this leaves zero header
    // interactive elements measurable as :visible (the 53px logo renders fine in real browsers).
    // branding.skipMobileTouchTarget skips it in Electron only; Chrome/Firefox still run it.
    // branding.skipTouchTarget skips it in every browser: a known header touch-target
    // deficiency the store's dev team has reviewed and chosen to keep as-is (AAP, FSE).
    itIfStore(!(branding.skipTouchTarget || (branding.skipMobileTouchTarget && Cypress.browser.name === 'electron')), `interactive header elements meet minimum touch target height (${touchTarget}px)`, () => {
      assertMaxTouchTarget(touchTarget);
    }, branding.skipTouchTarget
      ? "known header touch-target deficiency, kept as-is per store dev team (branding.skipTouchTarget)"
      : "header touch targets unmeasurable under Electron (skipMobileTouchTarget); runs in Chrome/Firefox");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Landscape tests — phones only (tablet landscape widths approach desktop)
// ═════════════════════════════════════════════════════════════════════════════
PHONES.forEach(({ name, width, height }) => {
  describe(`Homepage – ${name} landscape (${height}x${width})`, { testIsolation: false }, () => {
    before(() => {
      blockThirdParty(); // testIsolation:false — intercepts must be registered in before() (see checks.js)
      cy.viewport(height, width); // landscape: swap width and height
      cy.visit(homePath());
    });

    beforeEach(() => {
      cy.viewport(height, width);
    });

    it('loads with key elements visible', () => {
      cy.get(header).filter(':visible').should('have.length.at.least', 1);
      cy.get(footer.rootSelector).should('exist');
      cy.get('[class*="carousel"], [class*="hero"], [class*="banner"], main, [role="main"]')
        .filter(':visible')
        .should('have.length.at.least', 1);
    });

    it('has no horizontal overflow', () => {
      // In landscape the viewport width is `height` (the larger dimension).
      assertNoHorizontalOverflow(height);
    });
  });
});
