// Recrea el esquema y carga los datos semilla (usado por las pruebas y por "npm run db:reset").
const fs = require('fs');
const path = require('path');
const { Sequelize } = require('sequelize');

async function resetDb({ nombre = process.env.DB_NAME || 'playfit_dev', seed = true } = {}) {
  const sql = new Sequelize(nombre, process.env.DB_USER || 'playfit_app', process.env.DB_PASS || 'playfit_dev_pass', {
    host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 3306),
    dialect: 'mysql', logging: false, dialectOptions: { multipleStatements: true }
  });
  const dir = path.join(__dirname, '..', '..', 'database');
  await sql.query(fs.readFileSync(path.join(dir, '01_schema.sql'), 'utf8'));
  if (seed) await sql.query(fs.readFileSync(path.join(dir, '02_seed.sql'), 'utf8'));
  for (const a of require('./migrate').ARCHIVOS) await sql.query(fs.readFileSync(path.join(dir, a), 'utf8'));
  await sql.close();
}
module.exports = { resetDb };

if (require.main === module) {
  require('./env').load();
  resetDb().then(() => console.log('Base de datos recreada con datos semilla.'))
    .catch((e) => { console.error('Error:', e.message); process.exit(1); });
}
