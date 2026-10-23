// Retos: creacion, listado, union y evaluacion de progreso (se recalcula desde los datos reales, es idempotente).
const { one, select, insert, run, tx, E, rbac, clock } = require('@playfit/shared');
const H = require('./helpers');

const TIPOS = ['individual', 'squad'];
const METRICAS = ['reps', 'sesiones', 'dias_activos'];

async function crearReto(actor, d = {}) {
  rbac.requirePermiso(actor, 'reto:crear');
  const hoy = clock.hoy();
  if (typeof d.titulo !== 'string' || d.titulo.trim().length < 3 || d.titulo.length > 100) throw E.badRequest('titulo invalido (3 a 100 caracteres)');
  if (typeof d.descripcion !== 'string' || d.descripcion.trim().length < 3 || d.descripcion.length > 255) throw E.badRequest('descripcion invalida (3 a 255 caracteres)');
  if (!TIPOS.includes(d.tipo)) throw E.badRequest(`tipo debe ser: ${TIPOS.join(', ')}`);
  if (!METRICAS.includes(d.metrica)) throw E.badRequest(`metrica debe ser: ${METRICAS.join(', ')}`);
  const meta = Number(d.meta), xp = Number(d.xp_recompensa ?? 100);
  if (!Number.isInteger(meta) || meta < 1 || meta > 100000) throw E.badRequest('meta debe ser un entero entre 1 y 100000');
  if (!Number.isInteger(xp) || xp < 10 || xp > 1000) throw E.badRequest('xp_recompensa debe estar entre 10 y 1000');
  let ejercicioId = null;
  if (d.metrica === 'reps') {
    ejercicioId = Number(d.ejercicio_id);
    if (!Number.isInteger(ejercicioId) || ejercicioId < 1 || !(await one('SELECT id FROM ejercicios WHERE id=:id AND activo=1', { id: ejercicioId }))) throw E.badRequest('Para metrica reps debes indicar un ejercicio_id valido');
  }
  const ini = d.fecha_inicio || hoy, fin = d.fecha_fin;
  if (!clock.esFecha(ini) || !clock.esFecha(fin)) throw E.badRequest('fecha_inicio / fecha_fin invalidas (YYYY-MM-DD)');
  if (ini < hoy) throw E.badRequest('fecha_inicio no puede estar en el pasado');
  if (fin < ini) throw E.badRequest('fecha_fin debe ser posterior a fecha_inicio');
  if (clock.diffDays(fin, ini) > 90) throw E.badRequest('Un reto no puede durar mas de 90 dias');
  const id = await insert(
    `INSERT INTO retos (titulo,descripcion,tipo,metrica,ejercicio_id,meta,xp_recompensa,fecha_inicio,fecha_fin,creado_por)
     VALUES (:t,:d,:ti,:m,:ej,:meta,:xp,:i,:f,:c)`,
    { t: d.titulo.trim(), d: d.descripcion.trim(), ti: d.tipo, m: d.metrica, ej: ejercicioId, meta, xp, i: ini, f: fin, c: actor.id });
  return one('SELECT * FROM retos WHERE id=:id', { id });
}

// Progreso real del estudiante dentro de la ventana del reto.
async function progresoReto(reto, estudianteId, t) {
  const r = { e: estudianteId, i: reto.fecha_inicio, f: reto.fecha_fin };
  if (reto.metrica === 'sesiones')
    return Number((await one('SELECT COUNT(*) AS n FROM sesiones_entrenamiento WHERE estudiante_id=:e AND fecha BETWEEN :i AND :f', r, t)).n);
  if (reto.metrica === 'dias_activos')
    return Number((await one('SELECT COUNT(DISTINCT fecha) AS n FROM sesiones_entrenamiento WHERE estudiante_id=:e AND fecha BETWEEN :i AND :f', r, t)).n);
  const row = await one(
    `SELECT COALESCE(SUM(sr.repeticiones),0) AS n FROM series_ejercicio sr JOIN sesiones_entrenamiento s ON s.id=sr.sesion_id
     WHERE s.estudiante_id=:e AND sr.ejercicio_id=:ej AND s.fecha BETWEEN :i AND :f`, { ...r, ej: reto.ejercicio_id }, t);
  return Number(row.n);
}

async function completarParticipacion(reto, estudianteId, t) {
  await run('UPDATE reto_participaciones SET completado_at = UTC_TIMESTAMP() WHERE reto_id=:r AND estudiante_id=:e AND completado_at IS NULL', { r: reto.id, e: estudianteId }, t);
  await H.otorgarXp(estudianteId, reto.xp_recompensa, 'reto_completado', 'reto', reto.id, t);
  await H.otorgarInsignia(estudianteId, 'RETO_COMPLETADO', t);
  await H.notificar(estudianteId, 'reto', 'Reto completado', `${reto.titulo}: +${reto.xp_recompensa} XP`, t);
  await H.publicarFeed(estudianteId, 'reto_completado', { reto_id: reto.id, titulo: reto.titulo }, t);
}

// Recalcula la participacion y, si se cumple la meta, completa el reto (para todo el squad en retos de squad).
async function evaluarParticipacion(reto, estudianteId, t) {
  const prog = await progresoReto(reto, estudianteId, t);
  const esSquad = reto.tipo === 'squad';
  await run('UPDATE reto_participaciones SET progreso=:p WHERE reto_id=:r AND estudiante_id=:e AND completado_at IS NULL',
    { p: esSquad ? prog : Math.min(prog, reto.meta), r: reto.id, e: estudianteId }, t);
  const completados = [];
  if (!esSquad) {
    if (prog >= reto.meta) { await completarParticipacion(reto, estudianteId, t); completados.push({ estudiante_id: estudianteId, reto_id: reto.id, titulo: reto.titulo, xp: reto.xp_recompensa }); }
    return completados;
  }
  const sq = await H.squadDe(estudianteId, t);
  if (!sq) return completados;
  const equipo = await select(
    `SELECT rp.estudiante_id, rp.progreso, rp.completado_at FROM reto_participaciones rp
     WHERE rp.reto_id=:r AND rp.squad_id=:s`, { r: reto.id, s: sq.squad_id }, t);
  const total = equipo.reduce((a, m) => a + Number(m.progreso), 0);
  if (total >= reto.meta) {
    for (const m of equipo.filter((x) => !x.completado_at)) {
      await completarParticipacion(reto, m.estudiante_id, t);
      completados.push({ estudiante_id: m.estudiante_id, reto_id: reto.id, titulo: reto.titulo, xp: reto.xp_recompensa });
    }
  }
  return completados;
}

// Llamado tras registrar una sesion: reevalua todos los retos vigentes de ese estudiante.
async function actualizarRetosDelEstudiante(estudianteId, fecha, t) {
  const retos = await select(
    `SELECT r.* FROM reto_participaciones rp JOIN retos r ON r.id=rp.reto_id
     WHERE rp.estudiante_id=:e AND rp.completado_at IS NULL AND r.activo=1 AND :f BETWEEN r.fecha_inicio AND r.fecha_fin`,
    { e: estudianteId, f: fecha }, t);
  const out = [];
  for (const r of retos) out.push(...(await evaluarParticipacion(r, estudianteId, t)));
  return out;
}

async function unirseReto(actor, retoId) {
  await H.exigirEstudiante(actor);
  const hoy = clock.hoy();
  return tx(async (t) => {
    const reto = await one('SELECT * FROM retos WHERE id=:id AND activo=1 FOR UPDATE', { id: retoId }, t);
    if (!reto) throw E.notFound('Reto no encontrado');
    if (reto.fecha_fin < hoy) throw E.badRequest('Ese reto ya termino', 'RETO_FINALIZADO');
    if (await one('SELECT 1 AS ok FROM reto_participaciones WHERE reto_id=:r AND estudiante_id=:e', { r: retoId, e: actor.id }, t)) throw E.conflict('Ya participas en este reto', 'YA_PARTICIPA');
    let squadId = null;
    if (reto.tipo === 'squad') {
      const sq = await H.squadDe(actor.id, t);
      if (!sq) throw E.badRequest('Este reto es de squad: primero unete o crea un squad', 'REQUIERE_SQUAD');
      squadId = sq.squad_id;
    }
    await insert('INSERT INTO reto_participaciones (reto_id,estudiante_id,squad_id,progreso) VALUES (:r,:e,:s,0)', { r: retoId, e: actor.id, s: squadId }, t);
    const completados = await evaluarParticipacion(reto, actor.id, t);
    const p = await one('SELECT progreso, completado_at FROM reto_participaciones WHERE reto_id=:r AND estudiante_id=:e', { r: retoId, e: actor.id }, t);
    return { reto_id: retoId, progreso: Number(p.progreso), meta: reto.meta, completado: !!p.completado_at, retos_completados: completados };
  });
}

async function listarRetos(actor) {
  await H.exigirEstudiante(actor);
  const hoy = clock.hoy();
  const sq = await H.squadDe(actor.id);
  const filas = await select(
    `SELECT r.*, e.nombre AS ejercicio, rp.progreso, rp.completado_at, (rp.estudiante_id IS NOT NULL) AS participa
     FROM retos r LEFT JOIN ejercicios e ON e.id=r.ejercicio_id
     LEFT JOIN reto_participaciones rp ON rp.reto_id=r.id AND rp.estudiante_id=:e
     WHERE r.activo=1 ORDER BY r.fecha_fin ASC`, { e: actor.id });
  const vista = async (r) => {
    let progreso = Number(r.progreso || 0);
    if (r.tipo === 'squad' && sq) {
      const t = await one('SELECT COALESCE(SUM(progreso),0) AS n FROM reto_participaciones WHERE reto_id=:r AND squad_id=:s', { r: r.id, s: sq.squad_id });
      progreso = Number(t.n);
    }
    return {
      id: r.id, titulo: r.titulo, descripcion: r.descripcion, tipo: r.tipo, metrica: r.metrica, ejercicio: r.ejercicio,
      meta: r.meta, xp_recompensa: r.xp_recompensa, fecha_inicio: r.fecha_inicio, fecha_fin: r.fecha_fin,
      progreso, porcentaje: Math.min(100, Math.round((progreso / r.meta) * 100)),
      dias_restantes: Math.max(0, clock.diffDays(r.fecha_fin, hoy)),
      puede_unirse: !(r.tipo === 'squad' && !sq)
    };
  };
  const activos = [], disponibles = [], completados = [];
  for (const r of filas) {
    if (r.participa && r.completado_at) completados.push({ ...(await vista(r)), completado_at: r.completado_at });
    else if (r.participa && r.fecha_fin >= hoy) activos.push(await vista(r));
    else if (!r.participa && r.fecha_fin >= hoy) disponibles.push(await vista(r));
  }
  return { activos, disponibles, completados };
}

// ---- administracion de retos oficiales (solo admin) ----
async function listarRetosAdmin(actor) {
  rbac.requirePermiso(actor, 'reto:crear');
  return select(
    `SELECT r.id, r.titulo, r.descripcion, r.tipo, r.metrica, e.nombre AS ejercicio, r.meta, r.xp_recompensa,
            r.fecha_inicio, r.fecha_fin, r.activo,
            (SELECT COUNT(*) FROM reto_participaciones p WHERE p.reto_id=r.id) AS participantes,
            (SELECT COUNT(*) FROM reto_participaciones p WHERE p.reto_id=r.id AND p.completado_at IS NOT NULL) AS completados
     FROM retos r LEFT JOIN ejercicios e ON e.id=r.ejercicio_id ORDER BY r.activo DESC, r.fecha_fin DESC, r.id DESC LIMIT 200`);
}
async function cambiarEstadoReto(actor, retoId, activo) {
  rbac.requirePermiso(actor, 'reto:crear');
  if (typeof activo !== 'boolean') throw E.badRequest('"activo" debe ser true o false');
  if (!(await one('SELECT id FROM retos WHERE id=:id', { id: retoId }))) throw E.notFound('Reto no encontrado');
  await run('UPDATE retos SET activo=:a WHERE id=:id', { a: activo ? 1 : 0, id: retoId });
}

module.exports = { listarRetosAdmin, cambiarEstadoReto, crearReto, unirseReto, listarRetos, actualizarRetosDelEstudiante, evaluarParticipacion, progresoReto };
