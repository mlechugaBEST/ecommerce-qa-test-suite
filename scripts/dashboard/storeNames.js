/**
 * Friendly display names for each store code — the single source of the names
 * that used to be duplicated in the "Run One Store.bat" menu. The dashboard
 * server uses this for GET /api/stores; codes with no entry fall back to their
 * uppercase code.
 */
module.exports = {
  bestus: 'Best Access Doors USA',
  bestca: 'Best Access Doors Canada',
  adap: 'Access Doors and Panels',
  adc: 'Access Doors Canada',
  aap: 'Acudor Access Panels',
  fse: 'Fire Safety Equipment',
  brh: 'Best Roof Hatches',
  cad: 'California Access Doors',
  pda: 'Puertas de Acceso',
};
