const { defineConfig } = require("cypress");
const fs = require("fs");
const path = require("path");

// Store selection: every store ships its own JSON under stores/. The whole store
// object is injected into Cypress.env('site') so specs can read it synchronously
// at module-evaluation time (required for describe vs describe.skip gating).
const STORE = (process.env.STORE || "bestus").toLowerCase();
// Sanitize before it reaches a filesystem path: block ../ traversal and any
// non-store input before path.join (defense-in-depth; existsSync is a weak gate).
if (!/^[a-z0-9_-]+$/.test(STORE)) {
  throw new Error(`Invalid STORE "${STORE}": only a-z, 0-9, hyphen, underscore allowed.`);
}
const storesDir = path.join(__dirname, "stores");
const storeFile = path.join(storesDir, `${STORE}.json`);
if (!fs.existsSync(storeFile)) {
  const available = fs.readdirSync(storesDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
  throw new Error(`Unknown STORE "${STORE}". Available stores: ${available.join(", ")}`);
}
const site = JSON.parse(fs.readFileSync(storeFile, "utf8"));
for (const key of ["storeCode", "baseUrl", "homePath"]) {
  if (!site[key]) throw new Error(`stores/${STORE}.json is missing required key "${key}"`);
}

// Non-throwing schema-shape check: catches a typo'd top-level or forms.* key (e.g. "frms"
// instead of "forms") that would otherwise silently produce an identical-looking
// "[skipped: not configured for CODE]" title in every gated spec — indistinguishable from a
// deliberately-null section. Warns only, never throws: an unrecognized key must never break
// an otherwise-working config. Extend both lists when a new top-level or forms.* section is
// introduced (see the Nullable-section contract in CLAUDE.md).
const KNOWN_TOP_LEVEL_KEYS = [
  "storeCode", "baseUrl", "homePath", "visitQuery", "branding", "plp", "products",
  "discovery", "pdp", "forms", "testEmailTemplate", "personaOverrides",
  "_todo", "_notes", "_absentFeatures",
];
const KNOWN_FORMS_KEYS = [
  "contact", "quoteRequest", "proClub", "productInfo", "architectInquiries", "becomeVendor",
];
for (const key of Object.keys(site)) {
  if (!KNOWN_TOP_LEVEL_KEYS.includes(key)) {
    console.warn(
      `[stores/${STORE}.json] unrecognized top-level key "${key}" — typo? ` +
      `(expected one of: ${KNOWN_TOP_LEVEL_KEYS.join(", ")})`
    );
  }
}
if (site.forms && typeof site.forms === "object") {
  for (const key of Object.keys(site.forms)) {
    if (!KNOWN_FORMS_KEYS.includes(key)) {
      console.warn(
        `[stores/${STORE}.json] unrecognized "forms.${key}" — typo? ` +
        `(expected one of: ${KNOWN_FORMS_KEYS.join(", ")})`
      );
    }
  }
}

module.exports = defineConfig({
  allowCypressEnv: true,
  // Retry failed tests in `cypress run` to absorb transient live-site flake; never retry
  // interactively (openMode) so failures stay visible while debugging.
  retries: { runMode: 2, openMode: 0 },
  // Cypress scrolls action targets to the viewport top by default, which lands them
  // under sticky headers (ADAP) and fails actionability with "hidden from view".
  // Centering keeps targets clear of sticky chrome on every store.
  scrollBehavior: 'center',
  e2e: {
    baseUrl: site.baseUrl,
    viewportWidth: 1920,
    viewportHeight: 1080,
    defaultCommandTimeout: 15000,
    pageLoadTimeout: 60000,
    responseTimeout: 30000,
    screenshotsFolder: `cypress/screenshots/${STORE}`,
    video: true,
    videosFolder: `cypress/videos/${STORE}`,
    // Forward + coerce the live-submit gate vars. Cypress only auto-imports CYPRESS_-prefixed
    // OS env vars, so the plain LIVE_SUBMIT/I_KNOW_THIS_IS_LIVE that test:live (and the double-gate
    // in commands.js) rely on would otherwise never reach Cypress.env() — leaving live mode a dead
    // gate that silently stays stubbed. Coercing "true"→true here (not the raw string) keeps the
    // strict `=== true` double-gate honest: both must be genuinely set. The dashboard strips both
    // vars from the child env before spawn, so a dashboard run coerces to false → stub-only.
    env: {
      site,
      STORE,
      LIVE_SUBMIT: process.env.LIVE_SUBMIT === "true",
      I_KNOW_THIS_IS_LIVE: process.env.I_KNOW_THIS_IS_LIVE === "true",
    },

    setupNodeEvents(on, config) {
      // Required inside setupNodeEvents so prepareAudit and lighthouse share the same
      // module instance (and thus the same internal launchArgs closure variable).
      const { lighthouse, prepareAudit } = require("@cypress-audit/lighthouse");
      const { appendRunLog } = require("./scripts/writeRunLog");

      // Append a proof-of-run block to results/test-results.log after every
      // headless run (does not fire in `cypress open`).
      on('after:run', (results) => appendRunLog(results, STORE));

      on('before:browser:launch', (browser, launchOptions) => {
        prepareAudit(launchOptions);
        if (browser.name === 'chrome' || browser.name === 'chromium') {
          const version = browser.majorVersion;
          launchOptions.args.push(
            `--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Safari/537.36`
          );
          launchOptions.args.push('--disable-blink-features=AutomationControlled');
        }
        return launchOptions;
      });
      on('task', {
        lighthouse: lighthouse(),
        // Minimal PDP-pick attribution for pickRandom()-based specs — console.log from a task
        // reaches this process's real stdout (unlike cy.log, invisible in headless `cypress run`,
        // this suite's default mode). Purely informational; never affects pass/fail.
        log: (message) => {
          console.log(message);
          return null;
        },
      });
    }
  },
});
