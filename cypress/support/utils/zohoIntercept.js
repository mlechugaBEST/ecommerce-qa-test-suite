/**
 * Intercepts a Zoho form POST.
 * Default (stub) mode: returns a fake 200 with a thank-you body so no real lead is created.
 * Live mode: passes the request through when liveSubmit is true.
 * @param {string} alias
 * @param {string} urlPattern — glob matching the Zoho submit endpoint
 * @param {boolean} liveSubmit — pass Cypress.env('LIVE_SUBMIT') && Cypress.env('I_KNOW_THIS_IS_LIVE')
 */
export function setupZohoIntercept(alias, urlPattern, liveSubmit) {
  if (liveSubmit) {
    cy.intercept('POST', urlPattern).as(alias);
  } else {
    cy.intercept('POST', urlPattern, {
      statusCode: 200,
      body: '<html><body>Thank you for contacting us. We have received your message.</body></html>',
      headers: { 'content-type': 'text/html' }
    }).as(alias);
  }
}
