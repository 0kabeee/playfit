// Utilidades compartidas del social-service (siempre dentro de la transaccion `t` que las llama).
const { one, select, insert, run, E } = require('@playfit/shared');
const { XP } = require('./gamification');

// Lectura SIN bloqueo; solo inserta si falta (INSERT IGNORE sobre una fila existente toma un candado compartido
// y dos transacciones simultaneas del mismo estudiante terminaban en deadlock).
async function ensurePerfil(estudianteId, t) {
  const ya = await one('SELECT 1 AS ok FROM perfil_gamificacion WHERE estudiante_id=:e', { e: estudianteId }, t);
  if (!ya) await run('INSERT IGNORE INTO perfil_gamificacion (estudiante_id) VALUES (:e)', { e: estudianteId }, t);
}
async function lockPerfil(estudianteId, t) {
  let p = await one('SELECT * FROM perfil_gamificacion WHERE estudiante_id=:e FOR UPDATE', { e: estudianteId }, t);
  if (!p) {
    await run('INSERT IGNORE INTO perfil_gamificacion (estudiante_id) VALUES (:e)', { e: estudianteId }, t);
    p = await one('SELECT * FROM perfil_gamificacion WHERE estudiante_id=:e FOR UPDATE', { e: estudianteId }, t);
  }
  return p;
}

async function otorgarXp(estudianteId, puntos, motivo, refTipo, refId, t) {
  if (puntos <= 0) return;
  await insert(
    'INSERT INTO xp_movimientos (estudiante_id,puntos,motivo,referencia_tipo,referencia_id) VALUES (:e,:p,:m,:rt,:rid)',
    { e: estudianteId, p: puntos, m: motivo, rt: refTipo || null, rid: refId || null }, t);
  // MariaDB evalua las asignaciones de izquierda a derecha: nivel usa el xp_total ya actualizado.
  await run('UPDATE perfil_gamificacion SET xp_total = xp_total + :p, nivel = FLOOR(xp_total / :n) + 1 WHERE estudiante_id=:e',
    { p: puntos, n: XP.POR_NIVEL, e: estudianteId }, t);
}

// Devuelve la insignia si es NUEVA, o null si ya la tenia.
async function otorgarInsignia(estudianteId, codigo, t) {
  const ins = await one('SELECT id,codigo,nombre,descripcion,icono FROM insignias WHERE codigo=:c', { c: codigo }, t);
  if (!ins) return null;
  const ya = await one('SELECT 1 AS ok FROM estudiante_insignias WHERE estudiante_id=:e AND insignia_id=:i', { e: estudianteId, i: ins.id }, t);
  if (ya) return null;
  await run('INSERT INTO estudiante_insignias (estudiante_id,insignia_id) VALUES (:e,:i)', { e: estudianteId, i: ins.id }, t);
  return ins;
}

const squadDe = async (estudianteId, t) =>
  one('SELECT sm.squad_id, sm.rol, s.nombre, s.lider_id, s.max_miembros, s.codigo_invitacion FROM squad_miembros sm JOIN squads s ON s.id=sm.squad_id WHERE sm.estudiante_id=:e', { e: estudianteId }, t);

async function publicarFeed(estudianteId, tipo, detalle, t) {
  const sm = await one('SELECT squad_id FROM squad_miembros WHERE estudiante_id=:e', { e: estudianteId }, t);
  if (!sm) return;
  await insert('INSERT INTO actividad_feed (squad_id,estudiante_id,tipo,detalle) VALUES (:s,:e,:t,:d)',
    { s: sm.squad_id, e: estudianteId, t: tipo, d: JSON.stringify(detalle || {}) }, t);
}

const notificar = (usuarioId, tipo, titulo, cuerpo, t) =>
  insert('INSERT INTO notificaciones (usuario_id,tipo,titulo,cuerpo) VALUES (:u,:t,:ti,:c)', { u: usuarioId, t: tipo, ti: titulo, c: cuerpo || null }, t);

async function exigirEstudiante(actor) {
  if (!actor || actor.rol !== 'estudiante') throw E.forbidden('Esta accion es solo para estudiantes');
}

module.exports = { ensurePerfil, lockPerfil, otorgarXp, otorgarInsignia, squadDe, publicarFeed, notificar, exigirEstudiante, select };
