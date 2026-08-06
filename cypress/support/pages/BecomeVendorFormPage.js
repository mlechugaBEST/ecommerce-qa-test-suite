import { ZohoFormPage } from './ZohoFormPage.js';
import { getStore } from '../store.js';

export class BecomeVendorFormPage extends ZohoFormPage {
  get path() { return getStore().forms.becomeVendor.path; }

  fillWebsite(v) {
    cy.get('input[name="Website"]').clear().type(v);
    return this;
  }

  fillDetails(v) {
    // Custom-built vendor form (ADAP): the details field is a plain textarea named
    // "Additional Details" with placeholder-text-in-value behavior, not Zoho's MultiLine.
    cy.get('textarea[name="Additional Details"]').clear().type(v);
    return this;
  }

  submit() {
    // This form has no button.zf-submitColor — click the form's own button instead.
    cy.get('form[action*="zohopublic"] button').first().click({ force: true });
    return this;
  }
}
