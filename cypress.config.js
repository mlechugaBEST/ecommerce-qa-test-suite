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
  "discovery", "pdp", "checkout", "forms", "testEmailTemplate", "personaOverrides",
  "_todo", "_notes", "_absentFeatures",
];
const KNOWN_FORMS_KEYS = [
  "contact", "quoteRequest", "proClub", "productInfo", "architectInquiries", "becomeVendor",
];
const KNOWN_CHECKOUT_KEYS = [
  "path", "product", "quantity", "signInLinkText", "minShippingOptions",
  "newAddressLinkText", "addressSettleMs", "customFields", "consoleIgnore", "selectors",
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
// Same check for checkout.*, and worth having for the same reason: a typo'd "selectrs" silently
// falls all the way back to CHECKOUT_SELECTOR_DEFAULTS and then fails with a pile of confusing
// "element not found" errors on a store that had correctly overridden them. The truthiness guard
// comes first because typeof null === "object".
if (site.checkout && typeof site.checkout === "object") {
  for (const key of Object.keys(site.checkout)) {
    if (!KNOWN_CHECKOUT_KEYS.includes(key)) {
      console.warn(
        `[stores/${STORE}.json] unrecognized "checkout.${key}" — typo? ` +
        `(expected one of: ${KNOWN_CHECKOUT_KEYS.join(", ")})`
      );
    }
  }
}

// Checkout sign-in credentials for THIS store only. Resolved Node-side (OS env var >
// credentials.json) so that only the ACTIVE store's pair ever reaches the browser — see the
// comment on the env: block below for why that matters.
const { resolveCheckoutCredentials } = require("./scripts/resolveCheckoutCredentials");
const checkoutCreds = resolveCheckoutCredentials(STORE, __dirname);

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
    //
    // CHECKOUT_EMAIL / CHECKOUT_PASSWORD follow the same forward-and-resolve pattern, and NOT the
    // CYPRESS_-prefix auto-import that PRODUCT_URL/RANDOMIZE_PRODUCT use. That choice is
    // load-bearing: CYPRESS_ auto-import pulls in EVERY CYPRESS_* var present, so on a machine
    // provisioned for the whole fleet a single-store run would load all nine stores' passwords
    // into Cypress.env() — and into the `cypress open` Settings panel. Resolving Node-side keeps
    // the blast radius at one store, the one actually under test. They are siblings of `site`,
    // never merged into it: getStore() is handed to page objects and its contents get logged in
    // places a password must not reach.
    env: {
      site,
      STORE,
      LIVE_SUBMIT: process.env.LIVE_SUBMIT === "true",
      I_KNOW_THIS_IS_LIVE: process.env.I_KNOW_THIS_IS_LIVE === "true",
      CHECKOUT_EMAIL: checkoutCreds ? checkoutCreds.email : null,
      CHECKOUT_PASSWORD: checkoutCreds ? checkoutCreds.password : null,
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
