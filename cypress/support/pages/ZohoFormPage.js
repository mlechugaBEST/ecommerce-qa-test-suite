import { storePath } from '../store.js';

export class ZohoFormPage {
  get path() {
    throw new Error('ZohoFormPage subclass must define path');
  }

  visit() {
    cy.visit(storePath(this.path));
    return this;
  }

  scrollToForm() {
    // The Zoho form's id varies by store theme (form#form on BESTUS, no id on ADAP) —
    // target it by its submit action instead.
    cy.get('form[action*="zohopublic"]').first().scrollIntoView();
    return this;
  }

  // `:visible` on every field selector: some themes (BESTUS PDPs) render the Zoho
  // form twice — a visible desktop copy and a hidden responsive/mobile copy — so a
  // bare name selector matches 2 elements and Cypress rejects .clear()/.type() on
  // multiple. The hidden copy is :hidden (below-the-fold and overlay-covered fields
  // stay :visible), so this reliably targets the one real form on single-form stores.
  fillFirstName(v) {
    // force: some store themes (AAP) use a Zoho floating-label template that covers
    // all text inputs, same pattern as fillPhone. Forced typing still drives the real
    // input and zf client-side validation.
    cy.get('input[name="Name_First"]:visible').scrollIntoView().clear({ force: true }).type(v, { force: true });
    return this;
  }

  fillLastName(v) {
    cy.get('input[name="Name_Last"]:visible').scrollIntoView().clear({ force: true }).type(v, { force: true });
    return this;
  }

  fillCompany(v) {
    cy.get('input[name="SingleLine"]:visible').first().scrollIntoView().clear({ force: true }).type(v, { force: true });
    return this;
  }

  fillEmail(v) {
    cy.get('input[name="Email"]:visible').scrollIntoView().clear({ force: true }).type(v, { force: true });
    return this;
  }

  fillPhone(code, number) {
    // Country code input is only present on some Zoho forms (e.g. quote form).
    cy.get('body').then(($body) => {
      if ($body.find('input[name="PhoneNumber_countrycodeval"]:visible').length) {
        cy.get('input[name="PhoneNumber_countrycodeval"]:visible').clear({ force: true }).type(code, { force: true });
      }
    });
    // force: Zoho's floating label fully overlays this input (and ADAP PDPs add a
    // sticky product bar), so Cypress actionability rejects a field real users can
    // fill normally. Forced typing still drives the real input and zf validation.
    cy.get('input[name="PhoneNumber_countrycode"]:visible').scrollIntoView().clear({ force: true }).type(number, { force: true });
    return this;
  }

  submit() {
    // :visible + .first(): themes that render the form twice (BESTUS PDPs) also
    // duplicate the submit button — click the one real (visible) button.
    cy.get('button.zf-submitColor:visible').first().click({ force: true });
    return this;
  }
}
