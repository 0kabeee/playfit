// Retos: creacion, listado, union y evaluacion de progreso (se recalcula desde los datos reales, es idempotente).
const { one, select, insert, run, tx, E, rbac, clock } = require('@playfit/shared');
const H = require('./helpers');

const TIPOS = ['individual', 'squad'];
const METRICAS = ['reps', 'sesiones', 'dias_activos', 'peso_maximo'];
const CON_EJERCICIO = ['reps', 'peso_maximo']; // metricas que se miden sobre un ejercicio concreto

async function validarEjercicio(d) {
  const id = Number(d.ejercicio_id);
  if (!Number.isInteger(id) || id < 1) throw E.badRequest(`Para la metrica ${d.metrica} debes indicar un ejercicio_id valido`);
  const ej = await one('SELECT id, mide_reps FROM ejercicios WHERE id=:id AND activo=1', { id });
  if (!ej) throw E.badRequest(`Para la metrica ${d.metrica} debes indicar un ejercicio_id valido`);
  if (!ej.mide_reps) throw E.badRequest('Ese ejercicio se mide por tiempo: elige uno de repeticiones', 'EJERCICIO_INVALIDO');
  return id;
}

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
  if (d.metrica === 'peso_maximo' && d.tipo === 'squad') throw E.badRequest('El peso maximo no se suma entre miembros: usa un reto individual', 'METRICA_INVALIDA');
  const ejercicioId = CON_EJERCICIO.includes(d.metrica) ? await validarEjercicio(d) : null;
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

// Mide una metrica con los datos REALES del estudiante entre dos fechas (la usan retos y duelos).
async function medir(metrica, ejercicioId, estudianteId, ini, fin, t) {
  const r = { e: estudianteId, i: ini, f: fin, ej: ejercicioId };
  if (metrica === 'sesiones')
    return Number((await one('SELECT COUNT(*) AS n FROM sesiones_entrenamiento WHERE estudiante_id=:e AND fecha BETWEEN :i AND :f', r, t)).n);
  if (metrica === 'dias_activos')
    return Number((await one('SELECT COUNT(DISTINCT fecha) AS n FROM sesiones_entrenamiento WHERE estudiante_id=:e AND fecha BETWEEN :i AND :f', r, t)).n);
  if (metrica === 'peso_maximo')
    return Number((await one(
      `SELECT COALESCE(FLOOR(MAX(sr.peso_kg)),0) AS n FROM series_ejercicio sr JOIN sesiones_entrenamiento s ON s.id=sr.sesion_id
       WHERE s.estudiante_id=:e AND sr.ejercicio_id=:ej AND s.fecha BETWEEN :i AND :f`, r, t)).n);
  return Number((await one(
    `SELECT COALESCE(SUM(sr.repeticiones),0) AS n FROM series_ejercicio sr JOIN sesiones_entrenamiento s ON s.id=sr.sesion_id
     WHERE s.estudiante_id=:e AND sr.ejercicio_id=:ej AND s.fecha BETWEEN :i AND :f`, r, t)).n);
}

// Progreso real del estudiante dentro de la ventana del reto.
const progresoReto = (reto, estudianteId, t) => medir(reto.metrica, reto.ejercicio_id, estudianteId, reto.fecha_inicio, reto.fecha_fin, t);

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
    const sq = await H.squadDe(actor.id, t);
    if (reto.squad_id && (!sq || sq.squad_id !== reto.squad_id)) throw E.notFound('Reto no encontrado');
    if (reto.tipo === 'squad') {
      if (!sq) throw E.badRequest('Este reto es de squad: primero unete o crea un squad', 'REQUIERE_SQUAD');
      squadId = sq.squad_id;
    } else if (reto.squad_id) squadId = sq.squad_id;
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
  // retos oficiales (squad_id NULL) + los creados dentro de MI squad; los de otros squads no se ven
  const filas = await select(
    `SELECT r.*, e.nombre AS ejercicio, rp.progreso, rp.completado_at, (rp.estudiante_id IS NOT NULL) AS participa,
            u.nombre AS creador
     FROM retos r LEFT JOIN ejercicios e ON e.id=r.ejercicio_id
     LEFT JOIN reto_participaciones rp ON rp.reto_id=r.id AND rp.estudiante_id=:e
     LEFT JOIN usuarios u ON u.id=r.creado_por
     WHERE r.activo=1 AND (r.squad_id IS NULL OR r.squad_id=:s) ORDER BY r.fecha_fin ASC`, { e: actor.id, s: sq ? sq.squad_id : 0 });
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
      puede_unirse: !(r.tipo === 'squad' && !sq),
      de_squad: !!r.squad_id, creador: r.squad_id ? r.creador : null,
      puede_cancelar: !!r.squad_id && !!sq && (r.creado_por === actor.id || sq.lider_id === actor.id)
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
            r.fecha_inicio, r.fecha_fin, r.activo, r.squad_id, s.nombre AS squad,
            (SELECT COUNT(*) FROM reto_participaciones p WHERE p.reto_id=r.id) AS participantes,
            (SELECT COUNT(*) FROM reto_participaciones p WHERE p.reto_id=r.id AND p.completado_at IS NOT NULL) AS completados
     FROM retos r LEFT JOIN ejercicios e ON e.id=r.ejercicio_id LEFT JOIN squads s ON s.id=r.squad_id
     ORDER BY r.activo DESC, r.fecha_fin DESC, r.id DESC LIMIT 200`);
}
async function cambiarEstadoReto(actor, retoId, activo) {
  rbac.requirePermiso(actor, 'reto:crear');
  if (typeof activo !== 'boolean') throw E.badRequest('"activo" debe ser true o false');
  if (!(await one('SELECT id FROM retos WHERE id=:id', { id: retoId }))) throw E.notFound('Reto no encontrado');
  await run('UPDATE retos SET activo=:a WHERE id=:id', { a: activo ? 1 : 0, id: retoId });
}

// ---- retos creados por los miembros dentro de su squad ----
// Anti-abuso: maximo 3 retos vigentes por squad, duracion de 1 a 30 dias, la XP la fija el servidor
// y el progreso siempre se calcula con las sesiones reales.
const RETO_SQUAD = { MAX_VIGENTES: 3, MAX_DIAS: 30, MAX_INICIO_DIAS: 7 };
const LIMITES_META = { reps: [10, 5000], sesiones: [1, 60], dias_activos: [1, 30], peso_maximo: [1, 300] };
const xpRetoSquad = (dias) => Math.min(300, 50 + 10 * dias);

async function crearRetoSquad(actor, d = {}) {
  rbac.requirePermiso(actor, 'squad:gestionar_propio');
  const hoy = clock.hoy();
  const titulo = typeof d.titulo === 'string' ? d.titulo.trim() : '';
  if (titulo.length < 3 || titulo.length > 100) throw E.badRequest('titulo invalido (3 a 100 caracteres)');
  if (d.descripcion !== undefined && d.descripcion !== null && (typeof d.descripcion !== 'string' || d.descripcion.length > 255)) throw E.badRequest('descripcion: maximo 255 caracteres');
  const tipo = d.tipo || 'squad';
  if (!TIPOS.includes(tipo)) throw E.badRequest('tipo debe ser "squad" (meta entre todos) o "individual" (cada uno)');
  if (!METRICAS.includes(d.metrica)) throw E.badRequest(`metrica debe ser: ${METRICAS.join(', ')}`);
  if (d.metrica === 'peso_maximo' && tipo === 'squad') throw E.badRequest('El peso maximo no se suma entre miembros: usa "individual" (cada uno debe levantarlo)', 'METRICA_INVALIDA');
  const ini = d.fecha_inicio || hoy;
  const dias = Number(d.dias);
  if (!clock.esFecha(ini)) throw E.badRequest('fecha_inicio invalida (YYYY-MM-DD)');
  if (ini < hoy || clock.diffDays(ini, hoy) > RETO_SQUAD.MAX_INICIO_DIAS) throw E.badRequest(`El reto debe empezar entre hoy y los proximos ${RETO_SQUAD.MAX_INICIO_DIAS} dias`);
  if (!Number.isInteger(dias) || dias < 1 || dias > RETO_SQUAD.MAX_DIAS) throw E.badRequest(`dias debe ser un entero entre 1 y ${RETO_SQUAD.MAX_DIAS}`);
  const meta = Number(d.meta);
  const [min, max] = LIMITES_META[d.metrica];
  const tope = d.metrica === 'dias_activos' ? Math.min(max, dias) : max;
  if (!Number.isInteger(meta) || meta < min || meta > tope) throw E.badRequest(`meta debe ser un entero entre ${min} y ${tope} para esta metrica`);
  const ejercicioId = CON_EJERCICIO.includes(d.metrica) ? await validarEjercicio(d) : null;
  const fin = clock.addDays(ini, dias - 1);
  const xp = xpRetoSquad(dias);
  const descripcion = (typeof d.descripcion === 'string' && d.descripcion.trim().length >= 3) ? d.descripcion.trim() : `Reto del squad: ${titulo}`;

  return tx(async (t) => {
    await H.lockPerfil(actor.id, t); // serializa acciones del mismo estudiante
    const sq = await H.squadDe(actor.id, t);
    if (!sq) throw E.badRequest('Primero unete o crea un squad', 'REQUIERE_SQUAD');
    await one('SELECT id FROM squads WHERE id=:s FOR UPDATE', { s: sq.squad_id }, t); // serializa el conteo de retos vigentes del squad
    const vigentes = Number((await one('SELECT COUNT(*) AS n FROM retos WHERE squad_id=:s AND activo=1 AND fecha_fin >= :h', { s: sq.squad_id, h: hoy }, t)).n);
    if (vigentes >= RETO_SQUAD.MAX_VIGENTES) throw E.conflict(`Tu squad ya tiene ${RETO_SQUAD.MAX_VIGENTES} retos vigentes. Espera a que termine alguno.`, 'LIMITE_RETOS_SQUAD');
    const id = await insert(
      `INSERT INTO retos (titulo,descripcion,tipo,squad_id,metrica,ejercicio_id,meta,xp_recompensa,fecha_inicio,fecha_fin,creado_por)
       VALUES (:t,:d,:ti,:s,:m,:ej,:meta,:xp,:i,:f,:c)`,
      { t: titulo, d: descripcion, ti: tipo, s: sq.squad_id, m: d.metrica, ej: ejercicioId, meta, xp, i: ini, f: fin, c: actor.id }, t);
    // el creador queda inscrito; a los demas se les avisa
    await insert('INSERT INTO reto_participaciones (reto_id,estudiante_id,squad_id,progreso) VALUES (:r,:e,:s,0)', { r: id, e: actor.id, s: sq.squad_id }, t);
    const reto = await one('SELECT * FROM retos WHERE id=:id', { id }, t);
    if (ini <= hoy) await evaluarParticipacion(reto, actor.id, t);
    const otros = await select('SELECT estudiante_id FROM squad_miembros WHERE squad_id=:s AND estudiante_id<>:e', { s: sq.squad_id, e: actor.id }, t);
    for (const o of otros) await H.notificar(o.estudiante_id, 'reto', `Nuevo reto en ${sq.nombre}`, `${titulo} (${dias} dias, +${xp} XP). Unete desde Retos.`, t);
    await H.publicarFeed(actor.id, 'reto_creado', { reto_id: id, titulo }, t);
    return { ...reto, de_squad: true };
  });
}

// El creador o el lider pueden cancelar un reto de su squad (queda inactivo; no se borra el historial).
async function cancelarRetoSquad(actor, retoId) {
  rbac.requirePermiso(actor, 'squad:gestionar_propio');
  return tx(async (t) => {
    const reto = await one('SELECT * FROM retos WHERE id=:id AND activo=1 FOR UPDATE', { id: retoId }, t);
    const sq = await H.squadDe(actor.id, t);
    if (!reto || !reto.squad_id || !sq || sq.squad_id !== reto.squad_id) throw E.notFound('Reto no encontrado');
    if (reto.creado_por !== actor.id && sq.lider_id !== actor.id) throw E.forbidden('Solo quien creo el reto o el lider del squad pueden cancelarlo');
    await run('UPDATE retos SET activo=0 WHERE id=:id', { id: retoId }, t);
    const part = await select('SELECT estudiante_id FROM reto_participaciones WHERE reto_id=:r AND estudiante_id<>:e AND completado_at IS NULL', { r: retoId, e: actor.id }, t);
    for (const p of part) await H.notificar(p.estudiante_id, 'reto', 'Reto cancelado', reto.titulo, t);
  });
}

module.exports = {
  listarRetosAdmin, cambiarEstadoReto, crearReto, unirseReto, listarRetos, actualizarRetosDelEstudiante, evaluarParticipacion,
  progresoReto, medir, crearRetoSquad, cancelarRetoSquad, RETO_SQUAD, xpRetoSquad
};
