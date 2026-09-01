import { ZohoFormPage } from './ZohoFormPage.js';
import { pickProduct } from '../utils/pickProduct.js';

export class ProductFormPage extends ZohoFormPage {
  /**
   * @param {object} site — parsed site.json fixture
   * @param {string|null} productUrlOverride — Cypress.env('PRODUCT_URL'), resolved by caller
   * @param {boolean} randomize — Cypress.env('RANDOMIZE_PRODUCT'), resolved by caller
   */
  constructor(site, productUrlOverride, randomize) {
    super();
    this._site = site;
    this._path = pickProduct(site, productUrlOverride || null, !!randomize);
  }

  get path() { return this._path; }

  fillDetails(v) {
    // :visible — BESTUS PDPs render the product-info form twice (desktop + hidden
    // responsive copy); target the one real (visible) MultiLine textarea.
    cy.get('textarea[name="MultiLine"]:visible').clear({ force: true }).type(v, { force: true });
    return this;
  }

  // No Lead Website field to fill. These forms used to carry a SingleLine2 "Lead Website" input
  // (BESTUS hard-coded it to value="Best_Access_Doors") which the suite deliberately left to the
  // page's own JS. It was removed from the Zoho product forms in Aug 2026 — a deliberate change by
  // the form owners, and unrelated to the storefront embed mix-up around the same date (see
  // CLAUDE.md, Stub vs. Live Mode). Verified absent on all 8 stores that have a product form, so
  // there is nothing to populate here and no fillLeadWebsite() is needed.
}
