// Extras que consume la app movil: notificaciones, catalogo de insignias, marcas personales y detalle de reto.
const { one, select, run, E, clock } = require('@playfit/shared');
const H = require('./helpers');

// ---------- notificaciones ----------
async function listarNotificaciones(actor) {
  await H.exigirEstudiante(actor);
  const items = await select(
    'SELECT id,tipo,titulo,cuerpo,leida,created_at FROM notificaciones WHERE usuario_id=:u ORDER BY id DESC LIMIT 30', { u: actor.id });
  const n = await one('SELECT COUNT(*) AS n FROM notificaciones WHERE usuario_id=:u AND leida=0', { u: actor.id });
  return { no_leidas: Number(n.n), items: items.map((i) => ({ ...i, leida: !!i.leida })) };
}
async function marcarNotificacionesLeidas(actor) {
  await H.exigirEstudiante(actor);
  await run('UPDATE notificaciones SET leida=1 WHERE usuario_id=:u AND leida=0', { u: actor.id });
}

// ---------- insignias (catalogo completo; las no obtenidas salen con obtenida=false) ----------
async function catalogoInsignias(actor) {
  await H.exigirEstudiante(actor);
  const filas = await select(
    `SELECT i.id,i.codigo,i.nombre,i.descripcion,i.icono, ei.obtenida_at
     FROM insignias i LEFT JOIN estudiante_insignias ei ON ei.insignia_id=i.id AND ei.estudiante_id=:e ORDER BY i.id`, { e: actor.id });
  return filas.map((f) => ({ ...f, obtenida: !!f.obtenida_at }));
}

// ---------- marcas personales (PR) ----------
// Solo uno mismo o un companero del mismo squad. Son estadisticas de entrenamiento; nunca datos clinicos.
async function marcasPersonales(actor, estudianteId) {
  await H.exigirEstudiante(actor);
  if (estudianteId !== actor.id) {
    const a = await H.squadDe(actor.id), b = await H.squadDe(estudianteId);
    if (!a || !b || a.squad_id !== b.squad_id) throw E.forbidden('Solo puedes ver las marcas de tus companeros de squad');
  }
  const filas = await select(
    `SELECT e.id AS ejercicio_id, e.slug, e.nombre, e.mide_reps,
            MAX(sr.peso_kg) AS mejor_peso_kg, MAX(sr.repeticiones) AS mejores_reps, MAX(sr.duracion_seg) AS mejor_duracion_seg
     FROM series_ejercicio sr JOIN sesiones_entrenamiento s ON s.id=sr.sesion_id JOIN ejercicios e ON e.id=sr.ejercicio_id
     WHERE s.estudiante_id=:e GROUP BY e.id
     ORDER BY (MAX(sr.peso_kg) IS NULL), MAX(sr.peso_kg) DESC, MAX(sr.repeticiones) DESC`, { e: estudianteId });
  const num = (v) => (v === null || v === undefined ? null : Number(v));
  return filas.map((f) => ({
    ejercicio_id: f.ejercicio_id, slug: f.slug, nombre: f.nombre, mide_reps: !!f.mide_reps,
    mejor_peso_kg: num(f.mejor_peso_kg), mejores_reps: num(f.mejores_reps), mejor_duracion_seg: num(f.mejor_duracion_seg)
  }));
}

// ---------- detalle de reto ----------
async function detalleReto(actor, retoId) {
  await H.exigirEstudiante(actor);
  const hoy = clock.hoy();
  const r = await one('SELECT r.*, e.nombre AS ejercicio FROM retos r LEFT JOIN ejercicios e ON e.id=r.ejercicio_id WHERE r.id=:id AND r.activo=1', { id: retoId });
  if (!r) throw E.notFound('Reto no encontrado');
  const mio = await one('SELECT progreso, completado_at FROM reto_participaciones WHERE reto_id=:r AND estudiante_id=:e', { r: retoId, e: actor.id });
  const sq = await H.squadDe(actor.id);
  const total = Number((await one('SELECT COUNT(*) AS n FROM reto_participaciones WHERE reto_id=:r', { r: retoId })).n);
  let participantes = [], progreso = mio ? Number(mio.progreso) : 0;
  if (r.tipo === 'squad' && sq) { // en retos de squad solo se muestran los companeros del propio squad
    const filas = await select(
      `SELECT u.id, u.nombre, u.apellido, rp.progreso, rp.completado_at FROM reto_participaciones rp JOIN usuarios u ON u.id=rp.estudiante_id
       WHERE rp.reto_id=:r AND rp.squad_id=:s ORDER BY rp.progreso DESC, u.nombre`, { r: retoId, s: sq.squad_id });
    participantes = filas.map((f) => ({ id: f.id, nombre: f.nombre, apellido: f.apellido, progreso: Number(f.progreso), completado: !!f.completado_at, es_yo: f.id === actor.id }));
    progreso = participantes.reduce((a, p) => a + p.progreso, 0);
  }
  return {
    id: r.id, titulo: r.titulo, descripcion: r.descripcion, tipo: r.tipo, metrica: r.metrica, ejercicio: r.ejercicio,
    meta: r.meta, xp_recompensa: r.xp_recompensa, fecha_inicio: r.fecha_inicio, fecha_fin: r.fecha_fin,
    dias_restantes: Math.max(0, clock.diffDays(r.fecha_fin, hoy)), finalizado: r.fecha_fin < hoy,
    participa: !!mio, completado: !!(mio && mio.completado_at), mi_progreso: mio ? Number(mio.progreso) : 0,
    progreso, porcentaje: Math.min(100, Math.round((progreso / r.meta) * 100)),
    puede_unirse: !mio && r.fecha_fin >= hoy && !(r.tipo === 'squad' && !sq),
    participantes_total: total, participantes
  };
}

module.exports = { listarNotificaciones, marcarNotificacionesLeidas, catalogoInsignias, marcasPersonales, detalleReto };
