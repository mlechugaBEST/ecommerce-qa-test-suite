import { BecomeVendorFormPage } from '../support/pages/BecomeVendorFormPage.js';
import { getMultipartField } from '../support/utils/getMultipartField.js';
import { getStore, describeIfStore, storePersona } from '../support/store.js';

const site = getStore();
const vendorForm = site.forms && site.forms.becomeVendor;
const submitPattern = vendorForm && vendorForm.submitUrlPattern;

describeIfStore(vendorForm, 'Become a Vendor form', () => {
  let page;
  let persona;

  before(() => {
    cy.fixture('personas').then((p) => { persona = storePersona(p.primary); });
  });

  beforeEach(() => {
    page = new BecomeVendorFormPage();
  });

  describe('Happy path', () => {
    it('submits successfully with all required fields filled', () => {
      cy.uniqueEmail().then((email) => {
        cy.interceptZoho('submit', submitPattern);
        page.visit().scrollToForm();
        cy.fillPersona(page, persona, email);
        page.submit();
        cy.wait('@submit').its('response.statusCode').should('be.oneOf', [200, 302]);
      });
    });

    it('sends user-entered values in the request payload', () => {
      cy.uniqueEmail().then((email) => {
        cy.interceptZoho('submit', submitPattern);
        page.visit().scrollToForm();
        cy.fillPersona(page, persona, email);
        page.submit();
        cy.wait('@submit').then((interception) => {
          const body = interception.request.body;
          expect(getMultipartField(body, 'Name_First')).to.equal(persona.firstName);
          expect(getMultipartField(body, 'Name_Last')).to.equal(persona.lastName);
          expect(getMultipartField(body, 'Email')).to.equal(email);
        });
      });
    });
  });

  describe('Validation (negative paths)', () => {
    beforeEach(() => {
      page.visit().scrollToForm();
      cy.interceptZoho('submit', submitPattern);
    });

    // This is a custom-built page posting to Zoho, so its client-side validation may be
    // lighter than the embedded Zoho forms — coverage here is intentionally minimal until
    // a live run confirms which fields it enforces.

    it('does not submit the form when required fields are missing', () => {
      page.submit();
      cy.expectNoSubmission();
    });
  });
});
