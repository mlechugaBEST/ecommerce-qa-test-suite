import { pickRandom } from "../support/checks.js";
import { getStore, itIfStore, storePath, homePath } from "../support/store.js";

const site = getStore();

// Lighthouse only works in Chrome. This describe block skips itself in any other browser
// so the spec can be included in a full run without breaking Firefox runs.

// Mirrors the PageSpeed Insights desktop preset: light network throttling (40 ms RTT,
// 10 Mbps) with no CPU slowdown, desktop viewport. Scores will be close to PageSpeed
// desktop but not identical — infrastructure differences always introduce some variance.
const DESKTOP_OPTS = {
  formFactor: "desktop",
  screenEmulation: {
    mobile: false,
    width: 1350,
    height: 940,
    deviceScaleFactor: 1,
    disabled: false,
  },
  throttling: {
    rttMs: 40,
    throughputKbps: 10240,
    cpuSlowdownMultiplier: 1,
    requestLatencyMs: 0,
    downloadThroughputKbps: 0,
    uploadThroughputKbps: 0,
  },
  throttlingMethod: "simulate",
};

// One uniform floor for every page type on every store (throttled desktop, headroom
// for variance), calibrated against a full 27-audit sweep of all 9 live stores
// (July 2 2026):
// - performance 50: homepage/PDP conversion-critical, PLP heaviest (faceted nav,
//   filters, image/JS weight) but still expected to clear 50
// - accessibility 60: healthy themes score 80-98, but several fleet themes carry
//   structural a11y gaps (ADC/BESTCA/FSE "footer-new", AAP touch targets) scoring
//   in the mid-60s; 60 is the honest fleet-wide floor that lets those pass while a
//   drop below it flags a NEW regression
// - seo 65: typical live scores are 83-92 with dips to 75; 65 keeps the check
//   meaningful while letting healthy pages pass. FSE's homepage (missing meta
//   description) scores 67 and clears this floor — that gap is caught by the
//   seo.cy.js DOM meta-description assertion, not here.
// best-practices is intentionally NOT asserted: every BigCommerce storefront scores
// 57-75 on it and the deductions are all platform-level (third-party cookies, console
// noise from vendor scripts, legacy APIs) that store admins cannot fix — it produced
// noise (e.g. AAP PDP at 58) with no actionable signal, so the team dropped it
// (July 22 2026). Any category omitted here is not gated by cy.lighthouse.
// This is the single source of truth — no per-store or per-page overrides.
const LIGHTHOUSE_THRESHOLDS = {
  performance: 50,
  accessibility: 60,
  seo: 65,
};

describe("Lighthouse audit", () => {
  before(function () {
    if (Cypress.browser.name !== "chrome") this.skip();
  });

  it("homepage meets score thresholds", () => {
    cy.visit(homePath());
    cy.lighthouse(LIGHTHOUSE_THRESHOLDS, DESKTOP_OPTS);
  });

  itIfStore(site.plp, "PLP meets score thresholds", () => {
    cy.visit(storePath(site.plp.main));
    cy.lighthouse(LIGHTHOUSE_THRESHOLDS, DESKTOP_OPTS);
  });

  itIfStore(site.pdp, "a random PDP meets score thresholds", () => {
    const pdpUrl = storePath(pickRandom(site.pdp.popular));
    cy.task('log', `[lighthouse.cy.js] PDP under test: ${pdpUrl}`);
    cy.log(`**PDP under test:** ${pdpUrl}`);
    cy.visit(pdpUrl);
    cy.lighthouse(LIGHTHOUSE_THRESHOLDS, DESKTOP_OPTS);
  });
});
