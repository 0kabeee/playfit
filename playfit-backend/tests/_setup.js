// Preparacion comun: usa la BD playfit_test (nunca toca playfit_dev), recrea esquema+seed y fija el reloj al dia de la BD.
process.env.DB_NAME = 'playfit_test';
process.env.JWT_SECRET = 'secreto-de-pruebas-1234567890';
process.env.CLINICAL_KEY = '11'.repeat(32);
process.env.IA_LIMITE_DIARIO = '3';
process.env.LOG_HTTP = '0';
process.env.ADMIN_2FA_OBLIGATORIO = '0'; // las pruebas generales entran como admin sin 2FA; fase11.test.js lo activa donde corresponde
require('@playfit/shared/src/env').load(); // toma DB_PORT / DB_PASS del .env si existe (lo ya definido arriba NO se pisa)
const { dbReset, clock, one, sequelize } = require('@playfit/shared');

async function preparar() {
  await dbReset.resetDb({ nombre: 'playfit_test' });
  const r = await one('SELECT CURDATE() AS hoy');
  clock.set(r.hoy); // el seed usa CURDATE() de la BD
  return r.hoy;
}
const cerrar = () => sequelize.close();

// Actores del seed: 1 admin, 3 Ana, 4 Luis, 5 Camila, 6 Andres, 7 Valentina, 8 Sebastian
const actor = (id, rol) => ({ id, rol });
const ANA = actor(3, 'estudiante'), LUIS = actor(4, 'estudiante'), CAMILA = actor(5, 'estudiante'),
  ANDRES = actor(6, 'estudiante'), VALE = actor(7, 'estudiante'), SEBAS = actor(8, 'estudiante'),
  ADMIN = actor(1, 'admin');

module.exports = { preparar, cerrar, ANA, LUIS, CAMILA, ANDRES, VALE, SEBAS, ADMIN, actor };
