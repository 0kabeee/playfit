// Carga el archivo .env de la raiz del proyecto (si existe). NUNCA pisa variables que ya estan definidas
// en el sistema (asi `set DB_PORT=3307` en la terminal siempre gana sobre el archivo).
const fs = require('fs');
const path = require('path');

function parse(texto) {
  const out = {};
  for (const linea of texto.split(/\r?\n/)) {
    const l = linea.trim();
    if (!l || l.startsWith('#')) continue;
    const i = l.indexOf('=');
    if (i < 1) continue;
    let v = l.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[l.slice(0, i).trim()] = v;
  }
  return out;
}

function load(archivo = path.join(__dirname, '..', '..', '.env')) {
  if (!fs.existsSync(archivo)) return false;
  const vars = parse(fs.readFileSync(archivo, 'utf8'));
  for (const [k, v] of Object.entries(vars)) if (process.env[k] === undefined) process.env[k] = v;
  return true;
}
module.exports = { load, parse };
