import { ZohoFormPage } from './ZohoFormPage.js';
import { getStore } from '../store.js';

export class QuoteFormPage extends ZohoFormPage {
  get path() { return getStore().forms.quoteRequest.path; }

  fillModel(v) {
    cy.get('input[name="SingleLine1"]').scrollIntoView().clear({ force: true }).type(v, { force: true });
    return this;
  }

  fillSize(v) {
    cy.get('input[name="SingleLine2"]').scrollIntoView().clear({ force: true }).type(v, { force: true });
    return this;
  }

  selectQuantity(v) {
    cy.get('body').then(($body) => {
      if ($body.find('select[name="Dropdown"]').length) {
        cy.get('select[name="Dropdown"]').select(v);
      }
    });
    return this;
  }

  fillAddress(v) {
    const quoteForm = getStore().forms.quoteRequest;
    const field = (quoteForm && quoteForm.addressField) || 'SingleLine3';
    cy.get('body').then(($body) => {
      if ($body.find(`input[name="${field}"]`).length) {
        cy.get(`input[name="${field}"]`).scrollIntoView().clear({ force: true }).type(v, { force: true });
      }
    });
    return this;
  }
}
