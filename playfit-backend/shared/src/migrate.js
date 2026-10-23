// Aplica las migraciones idempotentes (03_fase7, 04_fase11, 05_fase12 y 06_fase13) sobre una base ya existente.
const fs = require('fs');
const path = require('path');

const ARCHIVOS = ['03_fase7.sql', '04_fase11.sql', '05_fase12.sql', '06_fase13.sql'];

// Parte un archivo .sql en sentencias (los archivos de migracion no tienen ';' dentro de textos).
function sentencias(texto) {
  return texto.split(/\r?\n/).filter((l) => !l.trim().startsWith('--')).join('\n')
    .split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);
}
async function aplicar() {
  for (const a of ARCHIVOS) {
    const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'database', a), 'utf8');
    for (const s of sentencias(sql)) await require('./db').sequelize.query(s);
  }
}
module.exports = { aplicar, sentencias, ARCHIVOS };
