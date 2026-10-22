// Reloj de la app. "Hoy" se calcula en la zona horaria configurada (Bogota) para que las rachas
// cambien a medianoche local. En pruebas se puede fijar con clock.set('YYYY-MM-DD').
let fijo = null;
const TZ = () => process.env.APP_TZ || 'America/Bogota';

function hoy() {
  if (fijo) return fijo;
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
const set = (f) => { fijo = f; };
const reset = () => { fijo = null; };

const toUTC = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fmt = (dt) => dt.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = toUTC(s); d.setUTCDate(d.getUTCDate() + n); return fmt(d); };
const diffDays = (a, b) => Math.round((toUTC(a) - toUTC(b)) / 86400000); // a - b
const lunesDe = (s) => { const dow = (toUTC(s).getUTCDay() + 6) % 7; return addDays(s, -dow); }; // lunes=0
const esFecha = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fmt(toUTC(s)) === s;

module.exports = { hoy, set, reset, addDays, diffDays, lunesDe, esFecha };
