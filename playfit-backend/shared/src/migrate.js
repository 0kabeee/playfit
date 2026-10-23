// Aplica las migraciones idempotentes (03_fase7 y 04_fase11) sobre una base ya existente.
const fs = require('fs');
const path = require('path');
const db = require('./db');

const ARCHIVOS = ['03_fase7.sql', '04_fase11.sql'];

// Parte un archivo .sql en sentencias (los archivos de migracion no tienen ';' dentro de textos).
function sentencias(texto) {
  return texto.split(/\r?\n/).filter((l) => !l.trim().startsWith('--')).join('\n')
    .split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);
}
async function aplicar() {
  for (const a of ARCHIVOS) {
    const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'database', a), 'utf8');
    for (const s of sentencias(sql)) await db.sequelize.query(s);
  }
}
module.exports = { aplicar, sentencias, ARCHIVOS };
