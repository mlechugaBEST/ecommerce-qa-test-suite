import { QuoteFormPage } from '../support/pages/QuoteFormPage.js';
import { getMultipartField } from '../support/utils/getMultipartField.js';
import { getStore, describeIfStore, itIfStore, storePersona } from '../support/store.js';

const site = getStore();
const quoteForm = site.forms && site.forms.quoteRequest;
const submitPattern = quoteForm && quoteForm.submitUrlPattern;
// Fields some stores' Zoho forms genuinely don't require (read from the form's
// zf_MandArray) — their empty-field validation tests skip there. Each store's value
// mirrors its live form, not an oversight: 6 stores mark Name_First optional
// (adc/adap/bestca/brh/cad/fse), pda marks Name_Last optional, and bestus/aap omit
// the key entirely (both names required, so both empty-field tests run).
const optionalFields = (quoteForm && quoteForm.optionalFields) || [];

describeIfStore(quoteForm, 'Request a Quote form', () => {
  let page;
  let persona;

  before(() => {
    cy.fixture('personas').then((p) => { persona = storePersona(p.primary); });
  });

  beforeEach(() => {
    page = new QuoteFormPage();
  });

  describe('Happy path', () => {
    it('submits successfully with all required fields filled', () => {
      cy.uniqueEmail().then((email) => {
        cy.interceptZoho('submit', submitPattern);
        page.visit().scrollToForm();
        cy.fillPersona(page, persona, email);
        page.submit();
        // Assert on the intercepted response — the page navigates to Zoho after submit
        // so DOM assertions are not possible here in stub mode.
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
          // Body is multipart/form-data — parse boundary sections
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

    itIfStore(!optionalFields.includes('Name_First'), 'shows an error when First Name is empty', () => {
      cy.uniqueEmail().then((email) => {
        cy.fillPersona(page, { ...persona, firstName: 'SKIP' }, email);
        cy.get('input[name="Name_First"]').clear({ force: true });
        page.submit();
        cy.expectNoSubmission();
        cy.expectFieldError('input[name="Name_First"]');
      });
    }, "store's quote form does not require First Name (forms.quoteRequest.optionalFields includes Name_First)");

    itIfStore(!optionalFields.includes('Name_Last'), 'shows an error when Last Name is empty', () => {
      cy.uniqueEmail().then((email) => {
        cy.fillPersona(page, { ...persona, lastName: 'SKIP' }, email);
        cy.get('input[name="Name_Last"]').clear({ force: true });
        page.submit();
        cy.expectNoSubmission();
        cy.expectFieldError('input[name="Name_Last"]');
      });
    }, "store's quote form does not require Last Name (forms.quoteRequest.optionalFields includes Name_Last)");

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

    itIfStore(!(quoteForm && quoteForm.noQuantityDropdown), 'lists the expected quantity options', () => {
      const expected = (quoteForm && quoteForm.quantityOptions) ||
        ["I don't know", '1', '2', '3', '4', '5+'];
      cy.get('select[name="Dropdown"]').find('option').then(($options) => {
        const values = [...$options].map((o) => o.text.trim());
        expect(values).to.include.members(expected);
      });
    }, "store's quote form has no quantity dropdown (forms.quoteRequest.noQuantityDropdown)");

    it('does not submit the form when required fields are missing', () => {
      page.submit();
      cy.expectNoSubmission();
    });
  });
});
