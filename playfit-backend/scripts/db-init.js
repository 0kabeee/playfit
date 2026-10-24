// Prepara la base de datos de un despliegue (Docker Compose / Kubernetes) SIN BORRAR NADA que ya exista:
//  - Espera a que MariaDB acepte conexiones (en un contenedor recien creado tarda unos segundos).
//  - Si la base esta vacia: crea el esquema y carga el catalogo + datos de ejemplo (02_seed.sql).
//    Si DEMO_PASSWORD esta definido, TODAS las cuentas del seed quedan con esa contrasena (en la nube nunca se
//    deja la contrasena publica del README).
//  - Siempre aplica las migraciones idempotentes (03_fase7.sql, 04_fase11.sql, 05_fase12.sql, 06_fase13.sql y 07_fase14.sql).
// Usa un candado de MariaDB (GET_LOCK) para que dos copias corriendo a la vez no se pisen.
// Uso:  node scripts/db-init.js        (lee la configuracion del entorno o del .env)
const fs = require('fs');
const path = require('path');

require('@playfit/shared/src/env').load();
const { Sequelize, QueryTypes } = require('sequelize');

const DIR_SQL = path.join(__dirname, '..', 'database');
const { ARCHIVOS: MIGRACIONES } = require('@playfit/shared/src/migrate');
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

function conexion() {
  return new Sequelize(process.env.DB_NAME || 'playfit_dev', process.env.DB_USER || 'playfit_app', process.env.DB_PASS || 'playfit_dev_pass', {
    host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 3306),
    dialect: 'mysql', logging: false, dialectOptions: { multipleStatements: true }, pool: { max: 1 }
  });
}

async function esperarBd(sql, { intentos = 30, pausaMs = 2000, log = console.log } = {}) {
  for (let i = 1; ; i++) {
    try { await sql.query('SELECT 1'); return; }
    catch (e) {
      if (i >= intentos) throw new Error(`MariaDB no respondio tras ${intentos} intentos: ${e.message}`);
      log(`[db-init] esperando a MariaDB (${i}/${intentos})...`);
      await espera(pausaMs);
    }
  }
}

async function baseVacia(sql) {
  const [r] = await sql.query(
    "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'usuarios'",
    { type: QueryTypes.SELECT });
  return Number(r.n) === 0;
}

async function inicializar({ sql = conexion(), demoPassword = process.env.DEMO_PASSWORD, log = console.log, esperar = {} } = {}) {
  await esperarBd(sql, { ...esperar, log });
  const [lock] = await sql.query("SELECT GET_LOCK('playfit_db_init', 120) AS ok", { type: QueryTypes.SELECT });
  if (Number(lock.ok) !== 1) throw new Error('No pude obtener el candado playfit_db_init (otra copia sigue inicializando).');
  try {
    let creada = false;
    if (await baseVacia(sql)) {
      log('[db-init] base vacia: creando esquema y cargando datos iniciales...');
      await sql.query(fs.readFileSync(path.join(DIR_SQL, '01_schema.sql'), 'utf8'));
      await sql.query(fs.readFileSync(path.join(DIR_SQL, '02_seed.sql'), 'utf8'));
      creada = true;
      if (demoPassword) {
        if (Buffer.byteLength(demoPassword, 'utf8') < 10) throw new Error('DEMO_PASSWORD debe tener al menos 10 caracteres.');
        const bcrypt = require('bcryptjs');
        await sql.query('UPDATE usuarios SET password_hash = :h', { replacements: { h: await bcrypt.hash(demoPassword, 10) } });
        log('[db-init] cuentas de ejemplo protegidas con DEMO_PASSWORD.');
      } else {
        log('[db-init] AVISO: sin DEMO_PASSWORD las cuentas de ejemplo usan la contrasena del README (solo para desarrollo).');
      }
    } else {
      log('[db-init] la base ya tiene datos: no se toca el esquema.');
    }
    for (const a of MIGRACIONES) await sql.query(fs.readFileSync(path.join(DIR_SQL, a), 'utf8')); // idempotentes
    log('[db-init] listo.');
    return { creada };
  } finally {
    await sql.query("SELECT RELEASE_LOCK('playfit_db_init')").catch(() => {});
  }
}
module.exports = { inicializar, baseVacia, esperarBd };

if (require.main === module) {
  const sql = conexion();
  inicializar({ sql })
    .then(() => sql.close())
    .catch(async (e) => { console.error(`[db-init] ERROR: ${e.message}`); await sql.close().catch(() => {}); process.exit(1); });
}
