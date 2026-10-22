// Utilidades de red sin dependencias (el gateway las usa sin cargar la conexion a la BD).
// Convierte el valor de TRUST_PROXY del entorno al formato de Express ('2' -> 2, 'true' -> true, texto -> texto).
function trustProxy(valor, porDefecto) {
  if (valor === undefined || valor === '') return porDefecto;
  if (/^\d+$/.test(valor)) return Number(valor);
  if (valor === 'true') return true;
  if (valor === 'false') return false;
  return valor;
}
module.exports = { trustProxy };
