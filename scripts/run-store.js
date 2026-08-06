#!/usr/bin/env node
/**
 * Run the Cypress suite against a single store.
 *
 *   node scripts/run-store.js bestca
 *   node scripts/run-store.js aap --spec "cypress/e2e/homepage.cy.js" --browser firefox
 *
 * The store code must match a JSON file in stores/ (case-insensitive). Any extra
 * arguments are forwarded to `cypress run` untouched.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { resolveCypressBin } = require('./resolveCypressBin');

const storesDir = path.join(__dirname, '..', 'stores');

function availableStores() {
  return fs.readdirSync(storesDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

const [code, ...cypressArgs] = process.argv.slice(2);
const stores = availableStores();

if (!code || !stores.includes(code.toLowerCase())) {
  console.error(`Usage: node scripts/run-store.js <store> [cypress args]`);
  console.error(`Available stores: ${stores.join(', ')}`);
  process.exit(1);
}

const store = code.toLowerCase();
console.log(`\n▶ Running Cypress for store "${store}"  —  started ${new Date().toLocaleString()}\n`);

// Default to Chrome unless the caller already passed --browser.
if (!cypressArgs.includes('--browser')) cypressArgs.push('--browser', 'chrome');

const result = spawnSync(process.execPath, [resolveCypressBin(), 'run', ...cypressArgs], {
  stdio: 'inherit',
  env: { ...process.env, STORE: store },
});

console.log(`\n▶ Finished store "${store}"  —  ${new Date().toLocaleString()}\n`);

process.exit(result.status === null ? 1 : result.status);
