/**
 * Resolve the Cypress CLI entry script so we can invoke it directly via
 * `node <path>`, bypassing `npx`/a shell entirely. `require.resolve('cypress')`
 * can't reach `bin/cypress` directly (blocked by the package's `exports`
 * field), so we resolve `cypress/package.json` and derive the sibling path.
 */
const path = require('path');

function resolveCypressBin() {
  const pkgPath = require.resolve('cypress/package.json');
  return path.join(path.dirname(pkgPath), 'bin', 'cypress');
}

module.exports = { resolveCypressBin };
