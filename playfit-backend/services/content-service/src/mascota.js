// Mascota: elige mensaje y pose segun datos reales. Reglas de condicion en la tabla mascota_mensajes.
// Principio: la mascota NO aparece en pantallas clinicas ni en vistas de admin.
const { select } = require('@playfit/shared');

const PANTALLAS_SIN_MASCOTA = ['historial_clinico', 'mediciones', 'flags', 'admin'];
const mascotaPermitida = (pantalla, rol) => rol === 'estudiante' && !PANTALLAS_SIN_MASCOTA.includes(pantalla);

// Evalua condiciones tipo 'racha>=7', 'puesto=1', 'puesto>3' o palabras como 'completado' / 'ganas'.
// Devuelve null si NO se cumple, o un puntaje de especificidad (mayor = mas especifico).
function evaluarCondicion(cond, datos) {
  if (cond === null || cond === undefined || cond === '') return -1; // sin condicion = mensaje de respaldo
  const m = /^([a-z_]+)(>=|<=|=|>|<)(-?\d+(?:\.\d+)?)$/.exec(cond);
  if (m) {
    const [, campo, op, valorTxt] = m;
    const v = Number(valorTxt), x = Number(datos[campo]);
    if (datos[campo] === undefined || Number.isNaN(x)) return null;
    const ok = { '>=': x >= v, '<=': x <= v, '=': x === v, '>': x > v, '<': x < v }[op];
    if (!ok) return null;
    return op === '=' ? 1000 : (op === '>=' || op === '>') ? v : 500 - v; // '>=7' es mas especifico que '>=3'
  }
  return datos.estado === cond ? 1000 : null; // palabra suelta: debe coincidir con datos.estado
}

async function elegirMensaje(contexto, datos = {}, { pantalla = 'inicio', rol = 'estudiante' } = {}) {
  if (!mascotaPermitida(pantalla, rol)) return null;
  const filas = await select('SELECT id,contexto,condicion,pose,mensaje FROM mascota_mensajes WHERE contexto=:c', { c: contexto });
  let mejor = null, mejorPuntaje = -Infinity;
  for (const f of filas) {
    const p = evaluarCondicion(f.condicion, datos);
    if (p !== null && p > mejorPuntaje) { mejor = f; mejorPuntaje = p; }
  }
  return mejor ? { pose: mejor.pose, mensaje: mejor.mensaje, contexto } : null;
}

module.exports = { elegirMensaje, evaluarCondicion, mascotaPermitida, PANTALLAS_SIN_MASCOTA };
