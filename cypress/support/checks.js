/**
 * Shared, importable assertion helpers used across specs. Each issues Cypress commands
 * and is safe to call inside an `it`. Grouped assertions live here (rather than as custom
 * commands) so they read as plain functions with their rationale documented alongside.
 */

import { getStore, homePath, footerConfig, pdpSelectors, plpSelectors, anyHeaderSelector } from './store.js';

// Product-card container is theme-dependent (BESTUS ul.productGrid vs BESTCA's SearchSpring
// "Snap" ul.ss__results) — read it from the store's PLP selectors. Exported so specs that
// reference the grid directly (plp navigation, discovery handoff) stay in sync.
export const productCardSelector = () => plpSelectors().productCard;
// Container that holds a card's price(s). We read EVERY $-amount inside it and take the minimum
// (see readCardPrice) rather than targeting one element, because the live store's price markup
// varies by product: a sale card glues RRP+sale ("$75.96$54.25"), a multi-variant/range card shows
// a "from–to" span ("$27.98 – $50.08"), and a plain card shows one price. In all three the value
// SearchSpring sorts on (calculated_price) is the *lowest* amount shown, so min is correct and
// markup-agnostic — and it naturally skips the higher RRP without needing the effective-price node.
const CARD_PRICE_CONTAINER = '.product-item-price, .price-section, [data-product-price-without-tax], [class*="price"]';
const SEARCH_INPUT =
  'input[name="search_query"], input[name*="search"], input[type="search"], input[placeholder*="Search"], input[placeholder*="Buscar"], input[aria-label*="Search"]';
// The live store sorts via a native SearchSpring select (name/id "ss__sort--select"). The generic
// fallbacks are kept for other BAD stores that may render BigCommerce-native sort controls.
const SORT_SELECT =
  'select[name="ss__sort--select"], select#ss__sort--select, select[name*="sort"], select[id*="sort"], select[name="sort"], select#sort, .actionBar select, .ss__sort select, select[aria-label*="Sort"], select[title*="Sort"]';
const SORT_ACTION =
  'a[href*="sort."], a[href*="sort="], button, [role="button"], [role="option"], [data-sort], [class*="sort"] a';

const normaliseText = (text) => text.replace(/\s+/g, ' ').trim();

// Returns a card's effective/sort price as a number: the minimum $-amount found in its price
// container (handles sale RRP+price, "from–to" ranges, and plain prices — see CARD_PRICE_CONTAINER).
// Returns null when the card shows no parseable price (e.g. quote-only items).
const readCardPrice = (card) => {
  const el = card.querySelector(CARD_PRICE_CONTAINER);
  if (!el) return null;
  const amounts = (el.textContent.replace(/,/g, '').match(/\$\s*\d+(?:\.\d{1,2})?/g) || [])
    .map((m) => Number(m.replace(/[^0-9.]/g, '')))
    .filter((n) => !Number.isNaN(n));
  return amounts.length ? Math.min(...amounts) : null;
};

/** Waits for the product grid to populate. */
export const waitForProducts = (min = 1) =>
  cy.get(productCardSelector(), { timeout: 20000 }).should('have.length.at.least', min);

/** Picks a random element from a non-empty list. */
export const pickRandom = (list) => list[Math.floor(Math.random() * list.length)];

// Noisy third-party analytics / ad / visitor-tracking hosts (GA, GTM, Meta, Reddit, Spotify,
// Taboola, leadsy, PageSense, Geotargetly, etc.). Derived by auditing every resource the live
// site loads (see the throwaway cypress/e2e/_audit-hosts.cy.js). Store-functional vendors
// (SearchSpring search API, Yotpo reviews, Zoho forms, PayPal, fonts, library CDNs) are
// deliberately excluded. Regexes (not globs) so they match the request's subdomain host, e.g.
// www.google-analytics.com or wvbknd.leadsy.ai — a glob matching the host as a path segment
// would not, because the host is a single URL authority segment, not a path segment.
//
// Single source of truth for two consumers: blockThirdParty() stubs these hosts' network
// requests, and e2e.js's uncaught:exception handler checks a thrown error's stack against this
// same list so it only suppresses exceptions actually sourced from these known vendor scripts.
// Most entries stub to an empty 204 (`body` omitted); a few need a real script body instead,
// because the live site's own first-party bootstrap code assumes the blocked script already ran
// and executes a follow-up call against a global it defines — see the gaconnector entry below
// for a documented example, and the reCAPTCHA entry at the end for the stronger form of it, where
// the stubbed global also has to RETURN what the page's code is testing for.
//
// Not every entry is a tracker: the reCAPTCHA entry stubs a functional widget, because a challenge
// no automated run can pass otherwise blocks the form submissions the specs exist to verify.
export const THIRD_PARTY_HOSTS = [
  // Analytics / tag managers
  { pattern: /google-analytics\.com/ },
  { pattern: /googletagmanager\.com/ },
  { pattern: /analytics\.google\.com/ },
  {
    // GA Connector — lead-source tracking. The live site's own inline bootstrap loads this
    // script then, 3s later, unconditionally calls `gaconnector2.track(id)` assuming it already
    // defined that global — stubbing an empty body leaves it undefined, throwing a first-party
    // ReferenceError. Serve a no-op stand-in instead so the site's own call succeeds silently.
    pattern: /gaconnector\.com/,
    body: 'window.gaconnector2 = window.gaconnector2 || { track: function () {} };',
  },
  { pattern: /pagesense/ }, // Zoho PageSense heatmaps (cdn.pagesense.io + *.zoho.com collectors)

  // Ad / social pixels
  { pattern: /facebook\.(com|net)/ }, // Meta pixel (fbevents.js + www.facebook.com)
  { pattern: /reddit\.com/ },         // Reddit Ads pixel
  { pattern: /redditstatic\.com/ },
  { pattern: /spotify\.com/ },        // Spotify ad pixel (pixels.spotify.com + pixel.byspotify.com)
  { pattern: /taboola\.com/ },        // Taboola content/ad network

  // Visitor tracking / fingerprinting / affiliate
  { pattern: /leadsy\.ai/ },
  { pattern: /iesnare\.com/ },        // iovation/LexisNexis device fingerprinting
  { pattern: /geotargetly/ },         // Geotargetly geo personalization
  { pattern: /affiliatly\.com/ },     // Affiliatly affiliate tracking

  // Vendor sub-trackers — the functional API/UI for each vendor stays loaded, only its
  // tracking beacons are stubbed.
  { pattern: /analytics\.searchspring\.net/ }, // SearchSpring analytics (search API kept)
  { pattern: /beacon\.searchspring\.io/ },     // SearchSpring beacon (search API kept)
  { pattern: /salesiq\.zohopublic\.com/ },     // Zoho SalesIQ live-chat widget
  { pattern: /clarity\.ms/ },                  // Microsoft Clarity session recording
  { pattern: /ipapi\.co/ },                    // ipapi.co geo-IP (PDA locale detection)
  // BigCommerce tax-exempt form widget (1.door-pay.com). Its bc_tax_exempt_form_load.js throws
  // "Cannot set properties of undefined (setting 'hostUrl')" on every BRH page load — a bug in
  // the vendor script itself. Non-essential to any test (form specs don't exercise tax-exempt),
  // so stub it to 204 and it never runs.
  { pattern: /door-pay\.com/ },

  // Bot-protection widgets — functional, not tracking. Stubbed anyway, because an unsolvable
  // human-verification challenge blocks the very submission the form specs exist to verify.
  {
    // Google reCAPTCHA v2 checkbox. BESTUS added one to /contact-us/ (found Sept 1 2026) together
    // with its own inline gate: a submit listener that preventDefault()s while
    // grecaptcha.getResponse() === ''. A v2 checkbox cannot be solved by automation — nor by a
    // human mid-run — so the POST never left the browser and all three happy-path tests failed
    // with cy.wait('@submit') "No request ever occurred" while every validation test still passed
    // (Zoho's own onSubmit handler runs upstream of the gate). Serve a stand-in that defines the
    // global with a NON-EMPTY token, so the site's gate falls through to zf_ValidateAndSubmit()
    // and the form POSTs exactly as it did before the widget was added — same "the page's own code
    // expects this global to exist" case as the gaconnector entry above, one step further: here we
    // also have to satisfy what that code asks the global.
    //
    // Deliberately applies in LIVE_SUBMIT mode too (blockThirdParty runs unconditionally): this
    // sitekey is the storefront's own client-side gate, NOT Zoho's captcha, and Zoho's endpoint
    // never verifies it — so a live submission lands the same real lead it always did.
    //
    // Also the one entry here matched on a PATH segment rather than a host, so it covers
    // www.google.com/recaptcha/api.js, the recaptcha.net mirror and gstatic's
    // /recaptcha/releases/* sub-resources at once. It collides with no store-functional URL, and
    // as a stack pattern in e2e.js's uncaught:exception handler it can only match Google's own
    // widget code.
    //
    // Per-form presence is recorded as forms.<name>.hasRecaptcha in the store config, which gates
    // the "does not submit until the reCAPTCHA is completed" test that checks the gate is really
    // enforced (contact-form.cy.js / pro-club-form.cy.js). See CLAUDE.md Global Setup.
    pattern: /\/recaptcha\//,
    body:
      'window.grecaptcha = { getResponse: function () { return "cypress-stub-token"; }, ' +
      'render: function () { return 0; }, reset: function () {}, execute: function () {}, ' +
      'ready: function (cb) { cb(); } };',
  },
];

/**
 * Stubs every THIRD_PARTY_HOSTS request so it resolves cleanly instead of rejecting and logging
 * "Failed to fetch" to console.error — an empty 204 by default, or a real script `body` for the
 * few hosts where that's not enough (see THIRD_PARTY_HOSTS above): either the page's own code
 * calls a global the blocked script was meant to define (gaconnector), or it also reads that
 * global's return value to decide whether to proceed (reCAPTCHA's submit gate).
 *
 * Registered globally in e2e.js `beforeEach` for specs that visit inside each test. Mobile specs
 * that share one visit under `testIsolation:false` must ALSO call this at the top of their `before()`
 * — that hook runs before the global `beforeEach`, so without it the initial visit's beacons fire
 * unintercepted and fail the console-error check.
 */
export function blockThirdParty() {
  THIRD_PARTY_HOSTS.forEach(({ pattern, body }) => {
    cy.intercept(
      pattern,
      body
        ? { statusCode: 200, headers: { 'content-type': 'application/javascript' }, body }
        : { statusCode: 204, body: '' }
    );
  });
}

// Scripts with a known, already-triaged bug of their own — either a vendor script we
// deliberately leave loaded for real (network-blocking it, like THIRD_PARTY_HOSTS, would break
// the thing we're testing) or a first-party asset with a confirmed, low-severity defect pending
// a fix. Consumed only by e2e.js's uncaught:exception handler, never by blockThirdParty() — these
// scripts still run for real, we just don't want their known bug to fail unrelated tests.
// Each entry matches by `stackPattern` (when the browser gives a real, attributable stack) or
// `messagePattern` (for a browser-redacted error with no stack at all — same-origin scripts can
// still lose their stack this way when loaded as a raw external <script src>, e.g. the
// tracking_code.js entry below). An entry may also carry an optional `store` field (e.g. 'brh')
// which restricts it to that one store — used when a message is too generic to suppress fleet-wide
// (e.g. a store-specific theme bug) without masking real errors elsewhere.
export const KNOWN_BUGGY_SCRIPTS = [
  {
    // Zoho SalesIQ chat widget UI bundle. Its `float~modern` chunk has an internal bug
    // ("Cannot read properties of undefined (reading 'float')") that can throw when a page
    // navigates away while the widget is still initializing — observed live on a BESTUS PLP
    // card click through to its PDP. A real bug in Zoho's widget, not ours to fix.
    stackPattern: /static\.zohocdn\.com/,
  },
  {
    // BESTUS's /content/assets/js/tracking_code.js (loaded only on /request-a-quote/) is
    // deployed with literal <script>/</script> wrapper tags still inside the file content — a
    // Zoho UTM/lead-tracking snippet meant for inline embedding, mistakenly saved as a
    // standalone external file. Loaded via <script src>, the browser parses the raw text as JS
    // and chokes on the leading '<', throwing this exact SyntaxError with no stack at all (same
    // redacted shape as a cross-origin error, even though it's same-origin) — so there's no
    // stack/host to match on, only this message. Confirmed low-severity: the real Zoho
    // form/submission is unaffected, only this script's own UTM-attribution cookie logic never
    // runs on that page (see stores/bestus.json _notes for the fix).
    messagePattern: /Unexpected token '<'/,
  },
  {
    // Meta Pixel (fbq) / Segment (analytics) / gtag / TikTok (ttq) globals are defined by
    // third-party scripts that blockThirdParty() stubs (facebook.net directly; Segment/gtag
    // via blocked GTM). Several storefronts (ADAP, ADC) then call these globals from their OWN
    // inline page code without a `typeof … !== 'undefined'` guard, so the call throws a
    // ReferenceError whose stack is the first-party page URL (no blocked host to match on) —
    // same shape as the gaconnector case, but there's no single interceptable host to attach a
    // no-op stub body to (Segment loads via GTM), so we suppress by message instead. This is
    // vendor-adjacent noise, not a first-party regression: the identical error fires in prod for
    // any adblock user, and only a tracking call is lost. Extend the alternation if a new pixel
    // global surfaces the same way.
    messagePattern: /\b(fbq|analytics|gtag|ttq) is not defined\b/,
  },
  {
    // ADAP theme calls jQuery.fancybox() before the lightbox plugin script has loaded
    // (script-order/timing) → TypeError with a first-party page stack. Low-severity (the
    // product-gallery lightbox), and fires for real users on the same race. The message is
    // specific enough to match globally. ADAP dev team notified.
    messagePattern: /\.fancybox is not a function/,
  },
  {
    // PDA's contact/quote pages load Zoho's GCLID helper deferred
    // (forms.zoho.com/js/zf_gclid_live.js) and then call into it from inline page code on a fixed
    // 500ms timer: setTimeout(function(){ downloadHtmlGclid(); }, 500) -> g_c(GAd.indexValueArr[0]).
    // When that third-party script has not executed within 500ms, g_c is undefined and the timer
    // callback throws a ReferenceError with a first-party stack. Purely a network-timing race, so it
    // is intermittent (~1 run in 3) — and confirmed PRE-EXISTING, not caused by any test change: a
    // 3x/3x A-B on main vs branch flaked 2/3 on main and 1/3 on the branch. PDA is the ONLY store
    // with this pattern; the other eight load zf_gclid.js but never call g_c from inline code, so
    // they have no race. Low-severity and it fires for real users on slow connections too — only the
    // GCLID attribution value is lost, the form itself submits normally. PDA devs notified: the fix
    // is to hook the script's load event rather than guess a timer. See stores/pda.json _notes.
    messagePattern: /g_c is not defined/,
  },
  {
    // Klaviyo (email-capture popup) is deliberately left loaded on the stores that use it (AAP, PDA,
    // BRH) because the popup is store-functional (see the AAP/PDA drift notes). Its telemetry
    // (`logMetric`) fire-and-forgets a fetch that fails under Cypress (blocked host / CORS), and
    // because nothing on the page catches it, the rejection surfaces as an unhandled promise
    // rejection that fails the test. Match the MESSAGE, not the stack: the frames such a rejection
    // does carry belong to klaviyo.js and BigCommerce's csrf-protection-header wrapper, neither of
    // which is a THIRD_PARTY_HOSTS entry (Klaviyo is deliberately not blocked), so no stackPattern
    // here would fire. This is safe because uncaught:exception only fires for UNHANDLED rejections,
    // and every fetch our own specs check (assertLinksResolve, image health) is awaited/caught — so
    // it can never mask a real test signal, only fire-and-forget third-party telemetry. (The
    // matching `[fetch failed] …klaviyo…` console-spy line is separately ignored via DEFAULT_IGNORE
    // in makeConsoleErrorSpy below.) NOTE this entry is only reachable on visits WITHOUT the
    // makeConsoleErrorSpy fetch wrapper (form specs, seo/images/lighthouse) — where the rejection is
    // app-frame. On spied visits the wrapper now handles the rejection at the source; it must never
    // hand back a rejected promise of its own, since a spec-frame rejection bypasses this list
    // entirely (see the wrapper's comment in makeConsoleErrorSpy and the note in e2e.js).
    messagePattern: /Failed to fetch/,
  },
];

// NOTE on BRH's document-ready theme bugs (.trim()-on-undefined, "$ is not a function"): those are
// NOT handled here. jQuery surfaces them asynchronously via setTimeout in a way that never reaches
// the uncaught:exception handler, so they're prevented at the source by a setTimeout wrap in e2e.js
// (window:before:load), scoped to the jQuery+bestroofhatches.com ready channel. See that file.

/**
 * Asserts the first `limit` product cards each have an image, title, link — and a $-price
 * when the store shows per-card prices. ADC's catalog interleaves priced and quote-only
 * (price-less) cards, so it sets plp.selectors.cardPrice to null to skip the price check.
 */
export function assertProductCards(limit = 3) {
  const { cardImage, cardTitle, cardLink, cardPrice } = plpSelectors();
  cy.get(productCardSelector()).each(($li, i) => {
    if (i >= limit) return false;
    cy.wrap($li).within(() => {
      cy.get(cardImage).should('exist').invoke('attr', 'src').should('not.be.empty');
      cy.get(cardTitle).invoke('text').should('not.be.empty');
      if (cardPrice) cy.get(cardPrice).invoke('text').should('match', /\$[\d,]+(\.\d{2})?/);
      cy.get(cardLink)
        .first()
        .invoke('attr', 'href')
        .should('not.be.empty')
        .and('include', '/');
    });
  });
}

export function getVisibleProductTitles(limit = 12) {
  const { cardTitle } = plpSelectors();
  return cy.get(productCardSelector()).then(($cards) =>
    [...$cards].slice(0, limit).map((card) => normaliseText(card.querySelector(cardTitle)?.textContent || ''))
  );
}

export function performHeaderSearch(term) {
  cy.visit(homePath());
  cy.get(SEARCH_INPUT, { timeout: 15000 }).then(($inputs) => {
    const input = $inputs.filter(':visible').first()[0] || $inputs.first()[0];
    cy.wrap(input).clear({ force: true }).type(term, { force: true });
    const $form = Cypress.$(input).closest('form');
    if ($form.length) {
      cy.wrap($form).submit();
    } else {
      cy.wrap(input).type('{enter}', { force: true });
    }
  });
  // Confirm we actually navigated to a search-results URL. `products` is deliberately not
  // accepted here — almost every BigCommerce URL contains it, so it would mask a search that
  // never fired. SearchSpring/BigCommerce search uses search_query or the _bc_fsnf facet param.
  cy.location('href', { timeout: 20000 }).should('match', /search_query|\/search|_bc_fsnf/i);
}

export function assertSearchResults(expectedTokens = []) {
  waitForProducts();
  assertProductCards(3);
  if (!expectedTokens.length) return;

  cy.get(productCardSelector()).then(($cards) => {
    const text = normaliseText([...$cards].map((card) => card.textContent).join(' ')).toLowerCase();
    const matched = expectedTokens.some((token) => text.includes(token.toLowerCase()));
    expect(matched, `At least one result contains one of: ${expectedTokens.join(', ')}`).to.eq(true);
  });
}

export function assertNoSearchResults() {
  // The empty-state is rendered client-side by SearchSpring; its exact wording should be
  // confirmed against the live site. To stay robust we accept EITHER a recognised no-results
  // message OR an empty product grid, while still rejecting hard error pages.
  cy.get('body', { timeout: 20000 }).should(($body) => {
    const text = normaliseText($body.text());
    expect(text, 'page body is not blank').to.not.equal('');
    // \b404\b: product model numbers like "W4048" in mega-menu text contain "404".
    expect(text, 'not a generic error page').not.to.match(/\b404\b|page not found|server error|forbidden/i);

    const hasNoResultsMessage =
      /no (products|results|matches)|0 results|did not match|could not find|couldn't find|nothing matches|try (again|a different)/i.test(
        text
      );
    const hasNoProducts = $body.find(productCardSelector()).length === 0;
    expect(
      hasNoResultsMessage || hasNoProducts,
      'shows a no-results message or an empty product grid'
    ).to.eq(true);
  });
}

export function assertDiscoveryPage({ heading } = {}) {
  // filter(':visible'): some themes (ADAP) render a hidden mobile-only h1 first.
  // Include bare .page-heading: ADAP's desktop title is <p class="h1 page-heading
  // page-heading--desktopOnly"> — its only real <h1> is the hidden mobile-only one.
  cy.get('h1.page-heading, .page-heading, h1').filter(':visible').first().should('be.visible').invoke('text').should('not.be.empty');
  if (heading) cy.get('h1.page-heading, .page-heading, h1').filter(':visible').first().should('contain.text', heading);
  cy.get('.breadcrumbs.new_breadcrumbs, .breadcrumbs').should('exist');
  // Skip sidebar check for stores with no sidebar (plp.selectors.sidebar: null — e.g. CAD native BC).
  // Include the configured sidebar selector first so non-BESTUS selectors (.sidebarBlock, etc.) match.
  if (plpSelectors().sidebar) cy.get(`${plpSelectors().sidebar}, .categories-left, #searchspring-sidebar, [class*="facets"], [class*="filter"]`).should('exist');
  waitForProducts();
  assertProductCards(3);
}

export function applySortOption(label, urlFallback = {}) {
  // Normalise to a space-separated, alphanumeric phrase so "Price (Low to High)",
  // "Price: Low to High", etc. all reduce to "price low to high". Matching the contiguous
  // phrase (not loose tokens) is what distinguishes "low to high" from "high to low".
  const normalise = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const phrase = normalise(label);
  const tokens = phrase.split(' ').filter(Boolean);
  const matchesPhrase = (text) => {
    const t = normalise(text);
    return t.includes(phrase) || tokens.every((token) => t.includes(token) && !t.includes('high to low'));
  };

  return cy.get('body', { timeout: 15000 }).then(($body) => {
    // SORT_SELECT can match non-sort selects too (ADAP's per-page "20/40/60" select
    // sits before the real sort select in the DOM), so scan every match — visible
    // ones first — for the select that actually contains a matching option.
    const selects = [...$body.find(SORT_SELECT)].sort(
      (a, b) => (Cypress.$(b).is(':visible') ? 1 : 0) - (Cypress.$(a).is(':visible') ? 1 : 0)
    );
    for (const select of selects) {
      const option = [...select.options].find((o) => matchesPhrase(`${o.textContent} ${o.value}`));
      if (option) {
        return cy.wrap(select).select(option.value || option.textContent, { force: true }).then(() => waitForProducts());
      }
      // No option label in this select matches the store's wording — try the next
      // matched select, then the action links / URL fallback below.
    }

    const actions = [...$body.find(SORT_ACTION)].filter((el) =>
      matchesPhrase(`${el.textContent} ${el.getAttribute('href') || ''} ${el.getAttribute('data-sort') || ''}`)
    );
    const action = actions.find((el) => Cypress.$(el).is(':visible')) || actions[0];
    if (action) {
      return cy.wrap(action).click({ force: true }).then(() => waitForProducts());
    }

    // Fallback: drive the sort via the URL — hash-routed SearchSpring stores pass
    // urlHash (discovery.sort.urlHash); native-BC stores pass queryParam/queryValue
    // (discovery.sort.queryParam/queryValue, e.g. ?sort=priceasc).
    return cy.location('href').then((href) => {
      const url = new URL(href);
      if (urlFallback.urlHash) {
        url.hash = urlFallback.urlHash;
      } else if (urlFallback.queryParam) {
        url.searchParams.set(urlFallback.queryParam, urlFallback.queryValue);
      } else {
        // Re-visiting the same URL would silently "pass" without sorting — fail loudly instead.
        throw new Error(
          `applySortOption: no sort select/action matched "${label}" and no URL fallback ` +
            '(discovery.sort.urlHash or queryParam/queryValue) is configured for this store.'
        );
      }
      return cy.visit(`${url.pathname}${url.search}${url.hash}`).then(() => waitForProducts());
    });
  });
}

/**
 * Verifies a sort actually applied, without depending on readable prices. Many products show
 * "Call for pricing" (no $ amount) and sort to the TOP of an ascending price sort, so the visible
 * grid can carry zero numeric prices — making a strict price-order assertion impossible. Instead:
 *   1. the URL hash reflects the chosen sort (proves the price-asc sort is active), and
 *   2. the grid re-rendered to a different product order than `previousTitles` (proves it took effect).
 * As a bonus, IF any priced products are visible, they must be ascending — but this never fails the
 * test when the page is all price-less. cy.get(...).should(cb) retries to wait out the re-render.
 */
export function assertSortApplied(previousTitles, { expectedHash } = {}) {
  const { cardTitle } = plpSelectors();
  if (expectedHash) {
    const key = expectedHash.replace(/^#\/?/, '');
    cy.location('hash', { timeout: 20000 }).should('include', key);
  }
  cy.get(productCardSelector(), { timeout: 20000 }).should(($cards) => {
    const cards = [...$cards];
    const titles = cards
      .slice(0, previousTitles.length)
      .map((c) => normaliseText(c.querySelector(cardTitle)?.textContent || ''));
    expect(titles, 'grid re-rendered to a different product order after sorting').to.not.deep.eq(previousTitles);

    const prices = cards.map((c) => readCardPrice(c)).filter((p) => p !== null);
    if (prices.length >= 2) {
      expect(prices, 'visible priced products ordered low to high').to.deep.eq([...prices].sort((a, b) => a - b));
    }
  });
}

export function assertPaginationAdvanced(previousTitles) {
  // BESTUS paginates with pp=2; other SearchSpring templates use p=2 (ADAP), page=2, or #...page:2.
  cy.location('href', { timeout: 20000 }).should('match', /\b(?:pp|page|p)[=:]2\b/);
  cy.get('.ss__pagination, .ss-pagination-container, .pagination-list').filter(':visible').first().within(() => {
    // .ss__pagination__current: BESTCA's SearchSpring "Snap" template marks the active page
    // with this instead of .ss-page.ss-active.
    cy.get('.ss-page.ss-active, .ss__pagination__current, [aria-current="page"], .pagination-item--current')
      .should('contain.text', '2');
  });
  waitForProducts();
  getVisibleProductTitles().then((currentTitles) => {
    expect(currentTitles, 'page 2 products differ from page 1').not.to.deep.eq(previousTitles);
  });
}

/** Asserts the page does not overflow horizontally beyond `maxWidth + 15px tolerance`. */
export function assertNoHorizontalOverflow(maxWidth) {
  // body.scrollWidth > viewport width means content spills off-screen, forcing the user
  // to scroll horizontally — the most common mobile layout bug. Allow 15px tolerance for
  // scrollbar width (6–15px varies by OS/browser), subpixel rendering, and carousel settle.
  //
  // Retryable on purpose: the check runs inside cy.get('body').should(...), so Cypress
  // re-invokes the callback until it passes or the assertion timeout elapses. This absorbs
  // transient layout states — notably a flash of unstyled content (FOUC) where an image
  // with no width/height attribute renders at its natural width before the theme stylesheet
  // clamps it (PDA's header logo is a CSS-only 128px but 418px intrinsic, which produced a
  // phantom ~466px overflow on a single-shot measurement). A genuine overflow never settles,
  // so it still fails once the retries time out.
  cy.get('body').should(($body) => {
    const doc = $body[0].ownerDocument;
    const win = doc.defaultView;
    if (doc.body.scrollWidth <= maxWidth + 15) return;

    // body.scrollWidth also counts content clipped by an overflow-x:hidden/auto
    // ancestor — content the user can never scroll to (ADAP's slick-carousel tracks
    // are thousands of px wide inside clipped .slick-list wrappers). Only elements
    // whose overflow escapes every clipping ancestor produce user-visible overflow,
    // so fail on those — and name them, so a failure pinpoints the broken element.
    const isClipped = (el) => {
      for (let p = el.parentElement; p && p !== doc.documentElement; p = p.parentElement) {
        const ox = win.getComputedStyle(p).overflowX;
        if (ox === 'hidden' || ox === 'clip' || ox === 'auto' || ox === 'scroll') return true;
      }
      return false;
    };
    const describe = (el) => {
      const id = el.id ? `#${el.id}` : '';
      const cls = String(el.className).trim().split(/\s+/).slice(0, 2).filter(Boolean).join('.');
      return `${el.tagName.toLowerCase()}${id}${cls ? '.' + cls : ''}@${Math.round(el.getBoundingClientRect().right)}px`;
    };
    // Per-store exclusions (branding.overflowIgnore) for third-party widgets that
    // mis-size themselves under Cypress's per-test viewport reset (1920 → device)
    // but render correctly on real devices — ADAP's Yotpo carousel .scroller was
    // verified overflow-free in a live browser at these widths.
    const ignore = (getStore().branding && getStore().branding.overflowIgnore) || [];
    const offenders = [...doc.body.querySelectorAll('*')]
      .filter((el) => el.getBoundingClientRect().right > maxWidth + 15 && !isClipped(el))
      .filter((el) => !ignore.some((s) => el.closest(s)))
      .slice(0, 5)
      .map(describe);
    // Offender names go in the message string — chai collapses array contents
    // ("[ Array(2) ]") in failure output, which hides exactly what we need.
    expect(
      offenders,
      `unclipped elements extending past the ${maxWidth}px viewport (body.scrollWidth=${doc.body.scrollWidth}): ${offenders.join(', ') || 'none'}`
    ).to.be.empty;
  });
}

/**
 * Asserts the tallest visible interactive header element is at least `minHeight` px.
 * Uses Math.max (not .first()) because DOM order puts small utility/skip links first;
 * the real question is whether there is at least one prominently-sized tappable element.
 */
export function assertMaxTouchTarget(minHeight) {
  // Whichever header the theme shows at this width (mobile or desktop) is the
  // one the user taps, so measure interactive elements across both containers.
  const selector = anyHeaderSelector()
    .split(', ')
    .map((h) => `${h} a[href], ${h} button`)
    .join(', ');
  cy.get(selector)
    .filter(':visible')
    .filter((i, el) => el.getBoundingClientRect().height > 0)
    .should('have.length.at.least', 1)
    .then(($els) => {
      const maxHeight = Math.max(...[...$els].map((el) => el.getBoundingClientRect().height));
      expect(maxHeight, 'Tallest header interactive element height').to.be.gte(minHeight);
    });
}

/** Asserts the breadcrumb trail has a Home link and at least two labels. */
export function assertBreadcrumbs() {
  // Selectors are theme-dependent (see PDP_SELECTOR_DEFAULTS in store.js); home/label
  // checks only run when the store's theme has those elements.
  const sel = pdpSelectors();
  cy.get(sel.breadcrumbs).should('be.visible').within(() => {
    if (sel.breadcrumbHome) cy.get(sel.breadcrumbHome).should('be.visible');
    if (sel.breadcrumbLabel) cy.get(sel.breadcrumbLabel).should('have.length.at.least', 2);
  });
}

/** Asserts the on-PDP "have a product question" Zoho form is present with its required fields. */
export function assertProductInfoForm() {
  cy.get(pdpSelectors().productInfoForm).should('exist').within(() => {
    cy.get('form[action*="zohopublic"]').should('exist');
    cy.get('input[name="Name_First"]').should('exist');
    cy.get('input[name="Name_Last"]').should('exist');
    cy.get('input[name="Email"]').should('exist');
  });
}

/**
 * Asserts the footer's sections are present along with their heading text.
 * Selectors and expected headings come from the store's footer config (theme-dependent —
 * see FOOTER_DEFAULTS in store.js and branding.footer in stores/<code>.json).
 * @param {'exist'|'be.visible'} mode — desktop footer is visible; mobile footer is display:none.
 */
export function assertFooterHeadings(mode = 'exist') {
  const footer = footerConfig();
  cy.get(footer.rootSelector).should(mode);
  footer.sections.forEach((selector) => cy.get(selector).should(mode));

  cy.get(footer.headingSelector).then(($headings) => {
    const texts = [...$headings].map((el) => {
      const clone = el.cloneNode(true);
      clone.querySelectorAll('svg').forEach((svg) => svg.remove());
      return clone.textContent.trim();
    });
    footer.headings.forEach((heading) => expect(texts).to.include(heading));
  });
}

/** Asserts <title> and <meta name="description"> are present and non-empty. */
export function assertMetaTags() {
  cy.title().should('not.be.empty');
  cy.get('meta[name="description"]')
    .invoke('attr', 'content')
    .should('not.be.empty');
}

/**
 * Finds the JSON-LD block with @type "Product" and asserts the key fields observed on
 * live PDPs: name, sku, description, image, offers.price, offers.priceCurrency,
 * offers.availability. Pass requirePrice:false for a call-for-pricing (quote-only)
 * product, where offers.price is legitimately absent — name/sku/description/image
 * still apply, since those survive on quote-only PDPs (e.g. BRH's un-gated SKU check).
 */
export function assertProductJsonLd({ requirePrice = true } = {}) {
  cy.get('script[type="application/ld+json"]').then(($scripts) => {
    // Some themes wrap the real Product node in an array or an @graph container
    // (BESTUS nests it in @graph alongside ItemPage/ItemList), so flatten both
    // shapes before searching rather than only inspecting each script's top level.
    const blocks = [...$scripts].flatMap((el) => {
      let parsed;
      try { parsed = JSON.parse(el.textContent); } catch { return []; }
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed['@graph'])) return parsed['@graph'];
      return [parsed];
    });
    // Third-party widgets (Yotpo, etc.) can inject their own Product blocks at runtime
    // that omit fields like sku. Require sku to ensure we match the site-rendered block.
    const product = blocks.find((b) => b && b['@type'] === 'Product' && typeof b.sku === 'string');
    expect(product, 'JSON-LD Product block with sku').to.exist;
    expect(product.name, 'product name').to.be.a('string').and.not.be.empty;
    expect(product.sku, 'product sku').to.be.a('string').and.not.be.empty;
    expect(product.description, 'product description').to.be.a('string').and.not.be.empty;
    // image may be a plain URL string, an ImageObject ({@type:"ImageObject", url,
    // contentUrl}), or an array of either — the BESTUS @graph block uses ImageObject.
    const rawImage = Array.isArray(product.image) ? product.image[0] : product.image;
    const imageUrl = typeof rawImage === 'string' ? rawImage : (rawImage && (rawImage.url || rawImage.contentUrl));
    expect(imageUrl, 'product image').to.be.a('string').and.not.be.empty;
    if (requirePrice) {
      expect(product.offers?.price, 'offers.price').to.match(/^\d+(\.\d+)?$/);
      // Currency is store-dependent — BESTCA (Canada) emits CAD. Defaults to USD.
      const currency = (getStore().branding && getStore().branding.currency) || 'USD';
      expect(product.offers?.priceCurrency, 'offers.priceCurrency').to.equal(currency);
      expect(product.offers?.availability, 'offers.availability').to.be.a('string').and.not.be.empty;
    }
  });
}

/**
 * Creates a console.error spy to attach at page-load time and assert on later.
 * Returns { onBeforeLoad, assertClean }. Uses a closure ref (not a cy alias) so it
 * survives across tests that share a single visit under testIsolation:false.
 *
 *   const consoleErrors = makeConsoleErrorSpy();
 *   before(() => cy.visit(url, { onBeforeLoad: consoleErrors.onBeforeLoad }));
 *   it('has no console errors', () => consoleErrors.assertClean());
 */
// Known noisy third-party beacons (GA/GTM/analytics/leadsy) are blocked at the network layer
// in e2e.js — returning 204 so their fetch resolves and never logs "Failed to fetch". We prefer
// blocking by URL over string-ignoring here, so this list is minimal and a real fetch failure
// surfaces. Add a substring only for console noise that can't be blocked by URL.
//  - 'klaviyo': the email-capture popup is deliberately left loaded (store-functional on AAP/PDA/
//    BRH), so its host can't be network-blocked without breaking the popup; its telemetry fetch
//    fails under Cypress and the wrapped-fetch re-log ("[fetch failed] …klaviyo…") is pure noise.
const DEFAULT_IGNORE = ['klaviyo'];

/**
 * fetch()'s first argument may be a URL string, a URL object, or a Request — and on these
 * storefronts it usually IS a Request, because BigCommerce's csrf-protection-header script
 * re-wraps window.fetch and normalizes the call before it reaches our wrapper. Interpolating
 * that straight into a template literal yields a useless "[object Request]", which loses the
 * very thing the wrapper exists to report (and the URL substring the ignore list matches on).
 */
const fetchUrlOf = (input) =>
  typeof input === 'string' ? input : (input && input.url) || String(input);

/**
 * @param {string[]} [ignore] - extra substrings; merged with DEFAULT_IGNORE. Calls whose
 *   first arg contains any matching substring are excluded from the assertion.
 */
export function makeConsoleErrorSpy({ ignore = [] } = {}) {
  const ignoreList = [...DEFAULT_IGNORE, ...ignore];
  const ref = {};
  return {
    onBeforeLoad: (win) => {
      ref.spy = cy.spy(win.console, 'error');
      // Wrap fetch so failed requests are re-logged with their URL, making it easy
      // to identify which script triggered "Failed to fetch" in assertClean output.
      const origFetch = win.fetch.bind(win);
      win.fetch = (...args) => {
        const p = origFetch(...args);
        // Log on a SIDE branch and hand back the ORIGINAL promise — never
        // `return p.catch(… ; return Promise.reject(err))`. This wrapper is spec-bundle code
        // running inside the AUT, so a promise it creates and returns is attributed to the
        // SPEC frame, and Cypress fails spec-frame unhandled rejections unconditionally:
        // cy.onUncaughtException only consults the uncaught:exception event (and therefore
        // KNOWN_BUGGY_SCRIPTS / THIRD_PARTY_HOSTS) when frameType === 'app'. The old
        // re-rejection turned Klaviyo's fire-and-forget logMetric "Failed to fetch" into
        // exactly that unsuppressable shape, killing before-all hooks (see e2e.js).
        // Attaching our own handler here also means such a fire-and-forget third-party fetch
        // no longer surfaces as an unhandled rejection at all, while app code that awaits a
        // failed fetch without catching still rejects in the APP frame and stays triageable.
        p.catch((err) => {
          win.console.error(`[fetch failed] ${fetchUrlOf(args[0])}`, err);
        });
        return p;
      };
    },
    assertClean: () =>
      cy.then(() => {
        // Build the full text of a console.error call from ALL its args. The fetch wrapper logs
        // "[fetch failed] <url>" as the first arg and the Error (whose message is "Failed to
        // fetch") as the second, so ignore substrings must scan every arg — not just args[0] —
        // or a caller-supplied ignore entry could never match the wrapped-fetch error text.
        const callText = (args) =>
          args.map((a) => (a instanceof Error ? `${a.message} ${a.stack || ''}` : String(a))).join(' ');
        const calls = (ref.spy.args || []).filter(
          (args) => !ignoreList.some((substr) => callText(args).includes(substr))
        );
        if (calls.length) {
          const summary = calls.map((args) => {
            const first = args[0];
            const msg = (first instanceof Error && first.stack)
              ? first.stack
              : args.map(String).join(' ');
            return msg;
          }).join('\n\n  ');
          throw new Error(`Expected no console.error calls, but got ${calls.length}:\n  ${summary}`);
        }
      }),
  };
}
