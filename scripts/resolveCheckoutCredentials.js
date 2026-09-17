/**
 * Resolve the checkout sign-in credentials for ONE store, Node-side.
 *
 * checkout.cy.js signs in as a real customer on a live storefront, so it needs a real password.
 * Every other value this suite uses lives in a committed stores/<code>.json; this one must not,
 * so it is resolved here instead and injected into Cypress.env() by cypress.config.js.
 *
 * Sources, first non-empty value wins, resolved PER FIELD:
 *   1. OS env vars  CHECKOUT_EMAIL_<CODE> / CHECKOUT_PASSWORD_<CODE>   (CI, and `setx` on a
 *      shared/UNC deployment where the repo folder is readable by everyone)
 *   2. %LOCALAPPDATA%\BestAccessDoorsTests\credentials.json            (per-user — the only
 *      private spot when the tests run from a network share; mirrors ensure-node.bat's EN_ALT)
 *   3. <repo>\credentials.json                                         (the ordinary local case)
 *
 * Per-field resolution is deliberate: the email is not really a secret and is fine sitting in the
 * shared file, while the password can be layered on top from an env var.
 *
 * WHY PER-STORE ENV VARS RATHER THAN ONE FLAT PAIR: scripts/run-all.js spawns all nine stores from
 * a SINGLE parent env, changing only STORE. One flat CHECKOUT_PASSWORD therefore could not serve
 * them, and worse — a bestca run with BESTUS's password set would hammer a real customer account
 * with failed sign-ins, which is how an account gets locked.
 *
 * CONTRACT (all three matter):
 *   - Returns { email, password } or null. NEVER a partial pair — a blank password would turn a
 *     clean skip into a failed real sign-in attempt.
 *   - NEVER throws. This runs at cypress.config.js module scope, so a throw here takes down every
 *     spec for the store, not just checkout.
 *   - NEVER logs a value. Everything printed here reaches results/test-results.log, the dashboard's
 *     live log pane (which streams child stdout to a browser), and whoever is looking at the
 *     operator's screen. Key names and file paths only.
 */
const fs = require('fs');
const path = require('path');

const FILE_NAME = 'credentials.json';

// Values meaning "copied the template, haven't filled it in yet". Treated as absent so an
// unedited copy yields a clean skip rather than a real sign-in attempt with the literal
// string "REPLACE_ME" as the password.
const PLACEHOLDER = /^(|replace_me|changeme|change_me|your_password_here|todo|xxx+)$/i;

/** CHECKOUT_PASSWORD_BESTUS etc. Hyphens → underscores: STORE's own regex allows a hyphen, and
 *  CHECKOUT_PASSWORD_FOO-BAR is not a settable env-var name on Windows or POSIX. */
function envKey(prefix, store) {
  return `${prefix}_${store.toUpperCase().replace(/-/g, '_')}`;
}

// Trim deliberately: `set CHECKOUT_PASSWORD_BESTUS=hunter2 ` in a .bat keeps the trailing space,
// and a pasted value routinely carries a stray newline. A password that genuinely depends on
// surrounding whitespace is not one we want in this fleet.
function clean(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return PLACEHOLDER.test(trimmed) ? null : trimmed;
}

function readFileSource(file, store) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null; // absent is the normal case, not an error worth reporting
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // Warn, never throw: a stray comma must not take the whole suite down.
    console.warn(`[checkout] ignoring ${file} — not valid JSON (${err.message}).`);
    return null;
  }
  const entry = parsed && parsed[store];
  if (!entry || typeof entry !== 'object') return null;
  return { email: clean(entry.email), password: clean(entry.password) };
}

/**
 * @param {string} store  lowercase store code (already validated by cypress.config.js)
 * @param {string} rootDir  repo root
 * @returns {{email: string, password: string}|null}
 */
function resolveCheckoutCredentials(store, rootDir) {
  const perUser = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'BestAccessDoorsTests', FILE_NAME)
    : null;

  const sources = [
    {
      email: clean(process.env[envKey('CHECKOUT_EMAIL', store)]),
      password: clean(process.env[envKey('CHECKOUT_PASSWORD', store)]),
    },
    perUser ? readFileSource(perUser, store) : null,
    readFileSource(path.join(rootDir, FILE_NAME), store),
  ].filter(Boolean);

  const pick = (field) => sources.reduce((found, s) => found || s[field], null);
  const email = pick('email');
  const password = pick('password');

  if (!email || !password) {
    // Half-configured is the one case worth shouting about: a typo in a variable NAME is
    // otherwise indistinguishable from "this machine holds no secret", and silently skips.
    if (email || password) {
      console.warn(
        `[checkout] ${store}: found ${email ? 'an email but no password' : 'a password but no email'} — ` +
        `both are required. Expected ${envKey('CHECKOUT_EMAIL', store)} / ` +
        `${envKey('CHECKOUT_PASSWORD', store)}, or a "${store}" entry in ${FILE_NAME}. ` +
        `Checkout tests will skip.`
      );
    }
    return null;
  }
  return { email, password };
}

module.exports = { resolveCheckoutCredentials, envKey };
