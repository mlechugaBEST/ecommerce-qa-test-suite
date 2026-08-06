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

  fillMessage(v) {
    cy.get('textarea[name="MultiLine"]').clear().type(v);
    return this;
  }

  attachFile(fixturePath) {
    cy.get('input[type="file"]').selectFile(`cypress/fixtures/${fixturePath}`, { force: true });
    return this;
  }
}
