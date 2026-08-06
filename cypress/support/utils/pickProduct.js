/**
 * Resolves the product URL for product-form tests.
 * Precedence: explicit override → random from known list → default.
 * @param {object} site — parsed site.json fixture
 * @param {string|null} productUrlOverride — pass Cypress.env('PRODUCT_URL') or null
 * @param {boolean} randomize — pass !!Cypress.env('RANDOMIZE_PRODUCT')
 * @returns {string}
 */
export function pickProduct(site, productUrlOverride, randomize) {
  if (productUrlOverride) return productUrlOverride;

  if (randomize && site.products.known.length > 0) {
    const idx = Math.floor(Math.random() * site.products.known.length);
    return site.products.known[idx];
  }

  return site.products.default;
}
