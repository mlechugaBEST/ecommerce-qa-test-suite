import { ZohoFormPage } from './ZohoFormPage.js';
import { getStore } from '../store.js';

export class ContactFormPage extends ZohoFormPage {
  get path() { return getStore().forms.contact.path; }

  selectInquiryType(v) {
    const store = getStore();
    const storeType = store.forms && store.forms.contact && store.forms.contact.inquiryType;
    cy.get('select[name="Dropdown"]').first().select(storeType || v);
    return this;
  }

  fillAddress1(v) {
    cy.get('input[name="Address_AddressLine1"]').scrollIntoView().clear({ force: true }).type(v, { force: true });
    return this;
  }

  fillAddress2(v) {
    cy.get('input[name="Address_AddressLine2"]').scrollIntoView().clear({ force: true }).type(v, { force: true });
    return this;
  }

  fillCity(v) {
    cy.get('input[name="Address_City"]').scrollIntoView().clear({ force: true }).type(v, { force: true });
    return this;
  }

  fillRegion(v) {
    cy.get('input[name="Address_Region"]').scrollIntoView().clear({ force: true }).type(v, { force: true });
    return this;
  }

  fillZip(v) {
    cy.get('input[name="Address_ZipCode"]').scrollIntoView().clear({ force: true }).type(v, { force: true });
    return this;
  }

  // Address_Country is mandatory on every store's contact form (it is in Zoho's zf_MandArray),
  // but until Aug 2026 that was satisfied by accident: the theme rendered a 269-country list with
  // one option preselected, so zf_CheckMandatory() passed without the suite ever touching it.
  // BESTUS then cut its list to 3 options with nothing preselected, leaving it on "-Select-".
  // zf_CheckMandatory() bails there, so the form never POSTs (cy.wait('@submit') sees no request)
  // and zf_ShowErrorMsg() hides every other field's error — which also silently broke the
  // "Email is malformed" assertion, since zf_ValidCheck() is never reached. Select explicitly so
  // the test drives its own input instead of depending on a per-store default.
  selectCountry(v) {
    // force, matching every other field method in this class and the fleet-wide convention for
    // Zoho controls in CLAUDE.md (Klaviyo popups and Zoho floating labels cover inputs on some
    // themes). Not added to fix any observed failure: the PDA contact flake that prompted the
    // question turned out to be a site-side GCLID race, not a covered element — see checks.js's
    // "g_c is not defined" entry.
    cy.get('select[name="Address_Country"]').select(v, { force: true });
    return this;
  }

  fillMessage(v) {
    cy.get('textarea[name="MultiLine"]').clear().type(v);
    return this;
  }

  attachFile(fixturePath) {
    cy.get('input[type="file"]').selectFile(`cypress/fixtures/${fixturePath}`, { force: true });
    return this;
  }
}
