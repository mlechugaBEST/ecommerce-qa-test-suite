import { ContactFormPage } from '../support/pages/ContactFormPage.js';
import { getMultipartField } from '../support/utils/getMultipartField.js';
import { getStore, describeIfStore, itIfStore, storePersona } from '../support/store.js';

const site = getStore();
const contactForm = site.forms && site.forms.contact;
const submitPattern = contactForm && contactForm.submitUrlPattern;

describeIfStore(contactForm, 'Contact Us form', () => {
  let page;
  let persona;

  before(() => {
    cy.fixture('personas').then((p) => { persona = storePersona(p.primary); });
  });

  beforeEach(() => {
    page = new ContactFormPage();
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

    // Requires cypress/fixtures/files/sample.pdf (present in repo).
    it('accepts an optional file attachment', () => {
      cy.uniqueEmail().then((email) => {
        cy.interceptZoho('submit', submitPattern);
        page.visit().scrollToForm();
        cy.fillPersona(page, persona, email);
        page.attachFile('files/sample.pdf');
        page.submit();
        cy.wait('@submit').its('response.statusCode').should('be.oneOf', [200, 302]);
      });
    });
  });

  describe('Validation (negative paths)', () => {
    beforeEach(() => {
      page.visit().scrollToForm();
      cy.interceptZoho('submit', submitPattern);
    });

    // Gated like quote-form's quantity dropdown: forms.contact.noInquiryDropdown skips the
    // test on stores whose contact form has no select[name="Dropdown"]; forms.contact.inquiryTypes
    // overrides the expected option wording per store (BESTUS wording is the default).
    itIfStore(!(contactForm && contactForm.noInquiryDropdown), 'lists the expected inquiry types in the dropdown', () => {
      const inquiryTypes = (contactForm && contactForm.inquiryTypes) ||
        ['Sales & Products', 'Customer Service & Existing Orders'];
      cy.get('select[name="Dropdown"]').first().find('option').then(($options) => {
        const values = [...$options].map((o) => o.text.trim());
        inquiryTypes.forEach((type) => expect(values).to.include(type));
      });
    }, "store's contact form has no inquiry-type dropdown (forms.contact.noInquiryDropdown)");

    it('shows an error when First Name is empty', () => {
      cy.uniqueEmail().then((email) => {
        cy.fillPersona(page, { ...persona, firstName: 'SKIP' }, email);
        cy.get('input[name="Name_First"]').clear({ force: true });
        page.submit();
        cy.expectNoSubmission();
        cy.expectFieldError('input[name="Name_First"]');
      });
    });

    it('shows an error when Last Name is empty', () => {
      cy.uniqueEmail().then((email) => {
        cy.fillPersona(page, { ...persona, lastName: 'SKIP' }, email);
        cy.get('input[name="Name_Last"]').clear({ force: true });
        page.submit();
        cy.expectNoSubmission();
        cy.expectFieldError('input[name="Name_Last"]');
      });
    });

    it('shows an error when Email is empty', () => {
      cy.uniqueEmail().then((email) => {
        cy.fillPersona(page, { ...persona }, email);
        cy.get('input[name="Email"]').clear({ force: true });
        page.submit();
        cy.expectNoSubmission();
        cy.expectFieldError('input[name="Email"]');
      });
    });

    it('shows an error when Email is malformed', () => {
      cy.fillPersona(page, persona, 'not-an-email');
      page.submit();
      cy.expectNoSubmission();
      cy.expectFieldError('input[name="Email"]');
    });

    it('does not submit the form when required fields are missing', () => {
      page.submit();
      cy.expectNoSubmission();
    });
  });
});
