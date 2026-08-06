import { ZohoFormPage } from './ZohoFormPage.js';
import { getStore } from '../store.js';

export class ProClubFormPage extends ZohoFormPage {
  get path() { return getStore().forms.proClub.path; }

  fillAddress1(v) {
    cy.get('input[name="Address_AddressLine1"]').clear().type(v);
    return this;
  }

  fillAddress2(v) {
    cy.get('input[name="Address_AddressLine2"]').clear().type(v);
    return this;
  }

  fillCity(v) {
    cy.get('input[name="Address_City"]').clear().type(v);
    return this;
  }

  fillRegion(v) {
    cy.get('input[name="Address_Region"]').clear().type(v);
    return this;
  }

  fillZip(v) {
    cy.get('input[name="Address_ZipCode"]').clear().type(v);
    return this;
  }

  selectCountry(v) {
    // A store whose Pro Club form has no country dropdown sets forms.proClub.hasCountry:false,
    // making fillPersona's call here a no-op. (BESTCA's form gained a required country
    // dropdown in July 2026, so it is now hasCountry:true — kept for any future no-country store.)
    if (getStore().forms.proClub.hasCountry === false) return this;
    // Option text must match exactly. Verify "Canada" vs "CA" on first run.
    cy.get('select[name="Address_Country"]').select(v);
    return this;
  }
}
