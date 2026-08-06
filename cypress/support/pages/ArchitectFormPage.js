import { ZohoFormPage } from './ZohoFormPage.js';
import { getStore } from '../store.js';

/**
 * Architects & Spec Writers Zoho form (ADC: /architects/, form "ADCcaArchitects").
 * A standard Zoho form, so first/last name, company (SingleLine), email, phone, and the
 * submit button all come from ZohoFormPage. It adds city, region, and the message textarea.
 * Required fields (zf_MandArray): Name_First, Name_Last, Email, PhoneNumber_countrycode.
 */
export class ArchitectFormPage extends ZohoFormPage {
  get path() { return getStore().forms.architectInquiries.path; }

  fillCity(v) {
    cy.get('input[name="Address_City"]').clear().type(v);
    return this;
  }

  fillRegion(v) {
    cy.get('input[name="Address_Region"]').clear().type(v);
    return this;
  }

  fillMessage(v) {
    cy.get('textarea[name="MultiLine"]').clear().type(v);
    return this;
  }
}
