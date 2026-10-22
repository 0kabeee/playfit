// Aplica los cambios de esquema idempotentes de la Fase 7 (tabla intentos_login) sobre una base ya existente.
const fs = require('fs');
const path = require('path');
const db = require('./db');

async function aplicar() {
  const archivo = path.join(__dirname, '..', '..', 'database', '03_fase7.sql');
  const sql = fs.readFileSync(archivo, 'utf8').split(/\r?\n/).filter((l) => !l.trim().startsWith('--')).join('\n').trim();
  await db.sequelize.query(sql);
}
module.exports = { aplicar };
