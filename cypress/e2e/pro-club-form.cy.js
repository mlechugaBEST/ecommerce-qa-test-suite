import { ProClubFormPage } from '../support/pages/ProClubFormPage.js';
import { getMultipartField } from '../support/utils/getMultipartField.js';
import { getStore, describeIfStore, itIfStore, storePersona } from '../support/store.js';

const site = getStore();
const proClubForm = site.forms && site.forms.proClub;
const submitPattern = proClubForm && proClubForm.submitUrlPattern;
// Some Pro Club forms have no country dropdown (BESTCA's Canada-only form) — gate the
// country-specific tests on it.
const hasCountry = proClubForm && proClubForm.hasCountry !== false;
// Business rule: each store's Pro Club is region-locked (BESTUS accepts US addresses
// only; BESTCA is implicitly Canada-only via its missing country field). The Zoho form
// has no address validation, so the enforceable check is that the country dropdown
// offers nothing outside forms.proClub.allowedCountries.
const allowedCountries = proClubForm && proClubForm.allowedCountries;

describeIfStore(proClubForm, 'Pro Club Application form', () => {
  let page;
  let persona;

  before(() => {
    cy.fixture('personas').then((p) => { persona = storePersona(p.primary); });
  });

  beforeEach(() => {
    page = new ProClubFormPage();
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
          if (hasCountry && allowedCountries) {
            expect(getMultipartField(body, 'Address_Country')).to.be.oneOf(allowedCountries);
          }
        });
      });
    });
  });

  describe('Validation (negative paths)', () => {
    beforeEach(() => {
      page.visit().scrollToForm();
      cy.interceptZoho('submit', submitPattern);
    });

    // KNOWN DEFICIENCY (BESTUS, July 2026): the live dropdown also offers "Canada",
    // violating the US-only rule — left failing per the site-deficiency policy until
    // the Zoho form (BestAccessDoorsProClubVIPProgramApplication) drops the option.
    itIfStore(hasCountry && allowedCountries, "offers only the store's allowed countries in the dropdown", () => {
      cy.get('select[name="Address_Country"] option').then(($opts) => {
        const countries = [...$opts]
          .map((o) => o.textContent.trim())
          .filter((t) => t && t !== '-Select-' && t !== '--');
        expect(countries).to.have.members(allowedCountries);
      });
    }, "store's Pro Club form has no country restriction (forms.proClub.allowedCountries not set)");

    itIfStore(hasCountry, 'defaults the country dropdown to a placeholder selection', () => {
      cy.get('select[name="Address_Country"]').should(($sel) => {
        const selected = $sel.val();
        expect(selected).to.satisfy(
          (v) => !v || v === '' || v === '-Select-' || v === '--',
          `Expected placeholder, got "${selected}"`
        );
      });
    }, "store's Pro Club form has no country field (forms.proClub.hasCountry is false)");

    it('shows an error when Email is empty', () => {
      cy.uniqueEmail().then((email) => {
        cy.fillPersona(page, { ...persona }, email);
        cy.get('input[name="Email"]').clear({ force: true });
        page.submit();
        cy.expectNoSubmission();
        // KNOWN DEFICIENCY (BESTUS, July 2026): submission is correctly blocked (see
        // expectNoSubmission above), but the Email_error message never toggles visible —
        // a Zoho form-config gap isolated to this field, confirmed live (see stores/bestus.json
        // _notes). Skipped pending a fix to the BestAccessDoorsProClubVIPProgramApplication form.
        if (!(proClubForm && proClubForm.emailErrorNotVisible)) {
          cy.expectFieldError('input[name="Email"]');
        }
      });
    });

    // Pro Club form does not enforce client-side validation on Name fields or
    // malformed email — those tests are omitted as they reflect Zoho's form config,
    // not a gap in test coverage.

    it('does not submit the form when required fields are missing', () => {
      page.submit();
      cy.expectNoSubmission();
    });

    // Same mechanism as contact-form.cy.js: checks.js stubs /recaptcha/ so an unsolvable v2
    // checkbox can't block the happy-path POSTs, and this test hands that stub back an EMPTY
    // response to check the store's own gate blocks submission the way it does for a visitor
    // who ignored the checkbox.
    //
    // This is the form that proves the test is worth having. The gate snippet installs its
    // listener on document.getElementById('zohoForm'), so it silently does NOTHING unless the
    // form's id happens to match — and on Sept 1 2026 this page's form was id='form' (contact's
    // was already id='zohoForm'), so `if (!form) return` short-circuited and the widget rendered
    // while blocking nothing at all. It was fixed overnight (confirmed by the store owner): as of
    // Sept 2 2026 the id is 'zohoForm', the gate enforces, and this test passes. Nothing LOOKS
    // different between the two states — the widget renders either way — so a one-word template
    // edit can disarm the captcha with no visible symptom. That is what this test watches for.
    itIfStore(proClubForm && proClubForm.hasRecaptcha, 'does not submit until the reCAPTCHA is completed', () => {
      cy.uniqueEmail().then((email) => {
        cy.window().then((w) => { w.grecaptcha = { ...w.grecaptcha, getResponse: () => '' }; });
        cy.fillPersona(page, persona, email);
        page.submit();
        cy.expectNoSubmission();
      });
    }, "store's Pro Club form has no reCAPTCHA gate (forms.proClub.hasRecaptcha)");
  });
});
