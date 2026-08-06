/**
 * Shared mobile/tablet device matrix for all *.mobile.cy.js specs.
 *
 * touchTarget = minimum acceptable height (px) for a visible header interactive element:
 *   44px → phones  (Apple HIG / WCAG 2.5.5 AAA)
 *   24px → tablets (WCAG 2.2 AA 2.5.8 — the site serves desktop nav at these widths,
 *                   where mouse-optimised links of 23–30px are expected)
 *
 * The BESTUS mobile nav is a div.mobile-menu drawer (not a hamburger button), confirmed
 * from page source. It is always in the DOM; opening it requires user interaction.
 * Other themes differ (ADAP uses a #mySidenav slide-out) — MOBILE_NAV below is resolved
 * per store via branding.mobileNavSelector (see store.js).
 *
 * Layout notes that shape the mobile specs:
 * - footer.tcsFooter is display:none on phone viewports — footer tests assert DOM
 *   presence (exist), not visibility.
 * - Desktop-only seasonal banners are display:none on mobile — visible-content checks
 *   filter to :visible.
 * - .categories-left (PLP sidebar) is collapsed/hidden on mobile — assert exist, not visible.
 * - Landscape is covered for phones only; tablet landscape widths (1080–1388px) approach
 *   desktop and rarely produce distinct layout breaks worth a separate pass.
 */
import { mobileNavSelector } from './store.js';

// Trimmed to representative viewport widths (Microsoft Clarity, June 2026): mobile ≈ 37% of
// traffic / iOS ~2:1 over Android, tablet just ~4%. Because these specs are read-only LAYOUT
// checks (layout is width-driven, no device-specific behavior), near-duplicate widths added no
// coverage — the previous 10-device matrix had 412==412, 390≈393, and 800/810/834 in one band.
// These four span the full phone width range (narrow Android → large Android, with a modern
// iPhone) plus one tablet-portrait; the ~1024 tablet-landscape boundary is covered by the
// desktop specs. Names are real devices for readable failure output.
export const PHONES = [
  { name: 'Samsung Galaxy S10 (2019)', width: 360, height: 760, touchTarget: 44 }, // narrow — worst-case overflow
  { name: 'iPhone 15 (2023)',          width: 393, height: 852, touchTarget: 44 }, // modern iPhone (iOS plurality)
  { name: 'Google Pixel 8 (2023)',     width: 412, height: 915, touchTarget: 44 }, // large Android
];

export const TABLETS = [
  { name: 'iPad 9th gen (2021)', width: 810, height: 1080, touchTarget: 24 }, // tablet portrait
];

export const ALL_DEVICES = [...PHONES, ...TABLETS];

// Evaluated at module-import time — relies on Cypress.env('site') already being
// populated (config is env-injected before spec module evaluation, so getStore()
// resolves here). Safe under a live Cypress run; would capture a stale/undefined
// value if this module were ever imported outside one.
export const MOBILE_NAV = mobileNavSelector();
