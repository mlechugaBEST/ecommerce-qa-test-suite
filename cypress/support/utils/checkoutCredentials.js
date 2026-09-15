/**
 * The single source of truth for "does this machine hold checkout credentials for the store under
 * test?" — the same role isLiveSubmit() plays for the live-submit double gate, and for the same
 * stated reason: the spec's gate, the page object, and the skip message must never drift apart on
 * what counts as configured.
 *
 * cypress.config.js resolves the ACTIVE store's pair Node-side (OS env var > credentials.json, see
 * scripts/resolveCheckoutCredentials.js) and injects it as CHECKOUT_EMAIL / CHECKOUT_PASSWORD —
 * fixed key names, one store per process, deliberately OUTSIDE Cypress.env('site') so a password
 * can never ride along with the store config into a page object or a log line.
 *
 * Read synchronously at module-evaluation time, which is what lets a spec use this in a
 * describeIfStore/itIfStore gate (collection time), exactly like getStore().
 */

/**
 * @returns {{email: string, password: string}|null} null when either value is missing, so a
 * half-configured machine SKIPS rather than attempting a real sign-in with a blank password.
 */
export function checkoutCredentials() {
  const email = Cypress.env('CHECKOUT_EMAIL');
  const password = Cypress.env('CHECKOUT_PASSWORD');
  if (typeof email !== 'string' || !email.trim()) return null;
  if (typeof password !== 'string' || !password) return null;
  return { email: email.trim(), password };
}

/**
 * Skip reason for a store that IS configured for checkout but whose credentials are absent on this
 * machine. A deliberate gate, so it gets an itIfStore `reason` (per the skip-reason contract in
 * CLAUDE.md) rather than the default "not configured for <CODE>" — the two say very different
 * things to whoever reads the results, and only one of them is something an operator can fix.
 */
export const NO_CHECKOUT_CREDENTIALS =
  'checkout credentials not on this machine — set CHECKOUT_EMAIL_<CODE>/CHECKOUT_PASSWORD_<CODE> ' +
  'or fill credentials.json (copy credentials.example.json)';
