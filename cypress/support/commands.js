import { uniqueEmail } from './utils/uniqueEmail.js';
import { setupZohoIntercept, isLiveSubmit } from './utils/zohoIntercept.js';
import { getStore } from './store.js';

Cypress.Commands.add('uniqueEmail', () => {
  return cy.wrap(uniqueEmail(getStore().testEmailTemplate), { log: false });
});

/**
 * Fills all persona fields that the page object supports.
 * Duck-typed: calls a fill method only if it exists on the page object.
 */
Cypress.Commands.add('fillPersona', (formPage, persona, email) => {
  if (typeof formPage.fillFirstName     === 'function') formPage.fillFirstName(persona.firstName);
  if (typeof formPage.fillLastName      === 'function') formPage.fillLastName(persona.lastName);
  if (typeof formPage.fillCompany       === 'function') formPage.fillCompany(persona.company);
  if (typeof formPage.fillWebsite       === 'function') formPage.fillWebsite(persona.website);
  if (typeof formPage.fillEmail         === 'function') formPage.fillEmail(email);
  if (typeof formPage.fillPhone         === 'function') formPage.fillPhone(persona.phoneCode, persona.phoneNumber);
  if (typeof formPage.fillDetails       === 'function') formPage.fillDetails(persona.details);
  if (typeof formPage.fillMessage       === 'function') formPage.fillMessage(persona.details);
  if (typeof formPage.selectInquiryType === 'function') formPage.selectInquiryType(persona.inquiryType);
  if (typeof formPage.fillAddress1      === 'function') formPage.fillAddress1(persona.address1);
  if (typeof formPage.fillAddress2      === 'function' && persona.address2) formPage.fillAddress2(persona.address2);
  if (typeof formPage.fillCity          === 'function') formPage.fillCity(persona.city);
  if (typeof formPage.fillRegion        === 'function') formPage.fillRegion(persona.region);
  if (typeof formPage.fillZip           === 'function') formPage.fillZip(persona.zip);
  if (typeof formPage.selectCountry     === 'function') formPage.selectCountry(persona.country);
  if (typeof formPage.fillModel         === 'function') formPage.fillModel(persona.model);
  if (typeof formPage.fillSize          === 'function') formPage.fillSize(persona.size);
  if (typeof formPage.selectQuantity    === 'function') formPage.selectQuantity(persona.quantity);
  if (typeof formPage.fillAddress       === 'function') formPage.fillAddress(persona.address1);
});

Cypress.Commands.add('interceptZoho', (alias, urlPattern) => {
  setupZohoIntercept(alias, urlPattern, isLiveSubmit());
});

/**
 * Asserts a form did NOT submit. `cy.get('@submit.all').should('have.length', 0)`
 * on its own passes the instant it's checked — 0 requests have matched *so far* —
 * so it gives no window for a slightly-delayed/async POST (e.g. a race between
 * the click handler and Zoho's client-side validation) to land and be caught.
 * This waits briefly first so a late submission actually has a chance to fire
 * before we assert none did.
 */
Cypress.Commands.add('expectNoSubmission', (alias = 'submit') => {
  cy.wait(500);
  cy.get(`@${alias}.all`).should('have.length', 0);
});

/**
 * Asserts a Zoho validation error is shown for the field matched by `selector`.
 * Zoho pre-renders every field's error `<p class="zf-errorMessage" style="display:none;">`
 * into the DOM unconditionally and only toggles it visible on failure — so this must
 * assert visibility, not mere existence (the element "exists" whether or not validation
 * ever ran). It's also scoped to the field's own `.zf-tempFrmWrapper` (Zoho's own
 * per-field container, not a theme class) rather than searching the whole page, so it
 * can't match some other field's error placeholder or a hidden duplicate-form copy.
 */
Cypress.Commands.add('expectFieldError', (selector) => {
  // filter(':visible').first(): some themes (BESTUS PDPs) render the Zoho form twice
  // (visible desktop + hidden responsive copy), so `selector` can match 2 fields —
  // walk from the one real (visible) field.
  cy.get(selector)
    .filter(':visible')
    .first()
    .closest('.zf-tempFrmWrapper')
    .find('[class*="error"], [class*="invalid"], [class*="Error"]')
    .should('be.visible');
});

/**
 * Asserts hrefs under `selector` resolve. Same-origin links are strict — any status >= 400 is
 * broken (matching images.cy.js's `< 400` image-health check). External links (other origins,
 * which we don't control) are lenient — only genuine dead/error codes fail; bot/auth blocks
 * (401/403/405/429/999) that a plain cy.request provokes but a real user never sees are tolerated.
 * Skips in-page (#), tel:,
 * mailto:, and non-http(s) (javascript: etc.) links, plus any href containing a
 * token in `exclude`. Links are deduplicated by origin+path+query (hash dropped).
 *
 * Mega-menu headers can hold 1,000+ unique links, and serial cy.request calls made
 * this take many minutes — so same-origin links are checked with parallel fetch()
 * batches (no CORS same-origin), and when they exceed `sample` a random sample is
 * checked instead: each run samples differently, so coverage accumulates across runs.
 * External links are few and stay on serial cy.request (fetch would hit CORS).
 *
 * @param {string} selector — e.g. 'header a[href]'
 * @param {{ exclude?: string[], sample?: number|false }} options — `exclude`: host
 *   substrings to skip (matched against the link's resolved hostname, e.g.
 *   ['amazon','facebook']); `sample`: max same-origin links per run
 *   (default 50, pass false to always check all)
 */
Cypress.Commands.add('assertLinksResolve', (selector, options = {}) => {
  const exclude = options.exclude || [];
  const sample = options.sample === undefined ? 50 : options.sample;

  cy.get(selector).then(($links) => {
    const baseOrigin = new URL(Cypress.config('baseUrl')).origin;
    const seen = new Set();
    const sameOrigin = [];
    const external = [];

    [...$links].forEach((a) => {
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('tel:') || href.startsWith('mailto:')) return;
      let url;
      try {
        url = new URL(href, Cypress.config('baseUrl'));
      } catch {
        return;
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
      // Match exclude tokens against the resolved HOST, not the raw href — a substring
      // test on the full href skips first-party slugs like /amazon-locker-access-door.
      if (exclude.some((token) => url.hostname.includes(token))) return;
      const target = url.origin + url.pathname + url.search;
      if (seen.has(target)) return;
      seen.add(target);
      (url.origin === baseOrigin ? sameOrigin : external).push(target);
    });

    const toCheck =
      sample && sameOrigin.length > sample
        ? [...sameOrigin].sort(() => Math.random() - 0.5).slice(0, sample)
        : sameOrigin;

    cy.then({ timeout: 120000 }, async () => {
      const broken = [];
      for (let i = 0; i < toCheck.length; i += 10) {
        await Promise.all(
          toCheck.slice(i, i + 10).map(async (url) => {
            try {
              const res = await fetch(url, { redirect: 'follow' });
              if (res.status >= 400) broken.push(`${url} -> ${res.status}`);
            } catch (e) {
              broken.push(`${url} -> ${e.message}`);
            }
          })
        );
      }
      expect(
        broken,
        `broken links (checked ${toCheck.length} of ${sameOrigin.length} same-origin)`
      ).to.be.empty;
    });

    // External links (sites we don't control): a plain cy.request carries no browser UA/cookies,
    // so social/partner hosts routinely answer bot requests with 401/403/405/429/999 that a real
    // user never sees. Treat only genuine dead/error codes as broken; tolerate those bot/auth
    // blocks. Same-origin links above stay strict (< 400) — that's the signal we actually own.
    const OK_EXTERNAL = new Set([401, 403, 405, 429, 999]);
    external.forEach((url) => {
      cy.request({ url, failOnStatusCode: false })
        .its('status')
        .should((s) => {
          expect(s < 400 || OK_EXTERNAL.has(s), `external link status ${s}: ${url}`).to.be.true;
        });
    });
  });
});
