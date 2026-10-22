// Contenido estatico: detalle de ejercicio, tips de tecnica, nutricion.
const { one, select, E } = require('@playfit/shared');

async function listarEjercicios({ grupo = null } = {}) {
  const gr = ['piernas', 'pecho', 'espalda', 'hombros', 'brazos', 'core', 'cardio'];
  if (grupo && !gr.includes(grupo)) throw E.badRequest('grupo_muscular invalido');
  return select(
    `SELECT id,slug,nombre,grupo_muscular,nivel,descripcion,mide_reps,soporta_camara FROM ejercicios WHERE activo=1 ${grupo ? 'AND grupo_muscular=:g' : ''} ORDER BY id`, { g: grupo });
}
async function detalleEjercicio(id) {
  const ej = await one('SELECT * FROM ejercicios WHERE id=:id AND activo=1', { id });
  if (!ej) throw E.notFound('Ejercicio no encontrado');
  const tips = await select('SELECT tipo,texto FROM tips_tecnica WHERE ejercicio_id=:id ORDER BY id', { id });
  const contra = (await select('SELECT flag_codigo FROM ejercicio_contraindicaciones WHERE ejercicio_id=:id', { id })).map((c) => c.flag_codigo);
  return { ...ej, pasos: ej.pasos_tecnica ? ej.pasos_tecnica.split(/\s*(?=\d\.\s)/).map((s) => s.trim()).filter(Boolean) : [], tips, contraindicado_con: contra };
}
// Tip que sale en el modal despues de una serie (rota entre los errores comunes y consejos).
async function tipPostSerie(ejercicioId) {
  const tips = await select('SELECT tipo,texto FROM tips_tecnica WHERE ejercicio_id=:id', { id: ejercicioId });
  return tips.length ? tips[Math.floor(Math.random() * tips.length)] : null;
}
async function listarNutricion({ categoria = null } = {}) {
  const cats = ['hidratacion', 'proteina', 'pre_entreno', 'post_entreno', 'general'];
  if (categoria && !cats.includes(categoria)) throw E.badRequest('categoria invalida');
  return select(`SELECT id,categoria,titulo,cuerpo FROM contenido_nutricion WHERE activo=1 ${categoria ? 'AND categoria=:c' : ''} ORDER BY id`, { c: categoria });
}

module.exports = { listarEjercicios, detalleEjercicio, tipPostSerie, listarNutricion };
