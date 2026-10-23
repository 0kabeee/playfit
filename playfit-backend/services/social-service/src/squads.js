// Squads: crear, unirse por codigo, salir (con traspaso de liderazgo), detalle, comparacion entre miembros.
const crypto = require('crypto');
const { one, select, insert, run, tx, E, clock } = require('@playfit/shared');
const H = require('./helpers');
const G = require('./gamification');

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O/1/I para evitar confusiones al dictar el codigo
const codigoAleatorio = () => Array.from({ length: 8 }, () => ALFABETO[crypto.randomInt(ALFABETO.length)]).join('');

async function crearSquad(actor, { nombre, descripcion = null } = {}) {
  await H.exigirEstudiante(actor);
  if (typeof nombre !== 'string' || nombre.trim().length < 3 || nombre.length > 60) throw E.badRequest('nombre invalido (3 a 60 caracteres)');
  if (descripcion !== null && (typeof descripcion !== 'string' || descripcion.length > 200)) throw E.badRequest('descripcion: maximo 200 caracteres');
  return tx(async (t) => {
    await H.ensurePerfil(actor.id, t);
    await H.lockPerfil(actor.id, t); // serializa operaciones del mismo estudiante
    if (await H.squadDe(actor.id, t)) throw E.conflict('Ya perteneces a un squad. Sal de el antes de crear otro', 'YA_TIENE_SQUAD');
    let codigo;
    do { codigo = codigoAleatorio(); } while (await one('SELECT 1 AS ok FROM squads WHERE codigo_invitacion=:c', { c: codigo }, t));
    const id = await insert('INSERT INTO squads (nombre,descripcion,codigo_invitacion,lider_id) VALUES (:n,:d,:c,:l)',
      { n: nombre.trim(), d: descripcion, c: codigo, l: actor.id }, t);
    await run(`INSERT INTO squad_miembros (squad_id,estudiante_id,rol) VALUES (:s,:e,'lider')`, { s: id, e: actor.id }, t);
    const ins = await H.otorgarInsignia(actor.id, 'SQUAD_FUNDADOR', t);
    if (ins) await H.notificar(actor.id, 'insignia', `Nueva insignia: ${ins.nombre}`, ins.descripcion, t);
    await H.publicarFeed(actor.id, 'union', { squad: nombre.trim(), fundador: true }, t);
    return { squad_id: id, nombre: nombre.trim(), codigo_invitacion: codigo, insignia_nueva: ins };
  });
}

async function unirseSquad(actor, codigo) {
  await H.exigirEstudiante(actor);
  const cod = String(codigo || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(cod)) throw E.badRequest('Codigo de invitacion invalido', 'CODIGO_INVALIDO');
  return tx(async (t) => {
    await H.ensurePerfil(actor.id, t);
    await H.lockPerfil(actor.id, t);
    const sq = await one('SELECT * FROM squads WHERE codigo_invitacion=:c FOR UPDATE', { c: cod }, t);
    if (!sq) throw E.notFound('No existe un squad con ese codigo', 'SQUAD_NO_ENCONTRADO');
    if (await H.squadDe(actor.id, t)) throw E.conflict('Ya perteneces a un squad', 'YA_TIENE_SQUAD');
    const n = Number((await one('SELECT COUNT(*) AS n FROM squad_miembros WHERE squad_id=:s', { s: sq.id }, t)).n);
    if (n >= sq.max_miembros) throw E.conflict(`El squad esta lleno (${sq.max_miembros} miembros)`, 'SQUAD_LLENO');
    await run(`INSERT INTO squad_miembros (squad_id,estudiante_id,rol) VALUES (:s,:e,'miembro')`, { s: sq.id, e: actor.id }, t);
    await H.publicarFeed(actor.id, 'union', { squad: sq.nombre }, t);
    await H.notificar(sq.lider_id, 'squad', 'Nuevo miembro en tu squad', `${sq.nombre} tiene un integrante mas`, t);
    return { squad_id: sq.id, nombre: sq.nombre, miembros: n + 1 };
  });
}

async function salirSquad(actor) {
  await H.exigirEstudiante(actor);
  return tx(async (t) => {
    await H.lockPerfil(actor.id, t);
    const sq = await H.squadDe(actor.id, t);
    if (!sq) throw E.badRequest('No perteneces a ningun squad', 'SIN_SQUAD');
    const otros = await select(
      `SELECT sm.estudiante_id, COALESCE(g.xp_total,0) AS xp FROM squad_miembros sm LEFT JOIN perfil_gamificacion g ON g.estudiante_id=sm.estudiante_id
       WHERE sm.squad_id=:s AND sm.estudiante_id<>:e ORDER BY xp DESC, sm.unido_at ASC`, { s: sq.squad_id, e: actor.id }, t);
    await run('UPDATE reto_participaciones SET squad_id=NULL WHERE estudiante_id=:e', { e: actor.id }, t);
    await run('DELETE FROM squad_miembros WHERE estudiante_id=:e', { e: actor.id }, t);
    if (!otros.length) {
      await run('DELETE FROM squads WHERE id=:s', { s: sq.squad_id }, t);
      return { salio: true, squad_disuelto: true, nuevo_lider_id: null };
    }
    let nuevoLider = null;
    if (sq.rol === 'lider') { // el liderazgo pasa al miembro con mas XP
      nuevoLider = otros[0].estudiante_id;
      await run('UPDATE squads SET lider_id=:l WHERE id=:s', { l: nuevoLider, s: sq.squad_id }, t);
      await run(`UPDATE squad_miembros SET rol='lider' WHERE squad_id=:s AND estudiante_id=:l`, { s: sq.squad_id, l: nuevoLider }, t);
      await H.notificar(nuevoLider, 'squad', 'Ahora eres el lider del squad', sq.nombre, t);
    }
    return { salio: true, squad_disuelto: false, nuevo_lider_id: nuevoLider };
  });
}

async function puedeVerSquad(actor, squad) {
  if (actor.rol === 'admin') return true;
  return !!(await one('SELECT 1 AS ok FROM squad_miembros WHERE squad_id=:s AND estudiante_id=:e', { s: squad.id, e: actor.id }));
}

async function detalleSquad(actor, squadId) {
  const sq = await one('SELECT * FROM squads WHERE id=:id', { id: squadId });
  if (!sq) throw E.notFound('Squad no encontrado', 'SQUAD_NO_ENCONTRADO');
  if (!(await puedeVerSquad(actor, sq))) throw E.forbidden('Solo los miembros del squad pueden verlo');
  const hoy = clock.hoy();
  const miembros = (await select(
    `SELECT u.id, u.nombre, u.apellido, u.avatar_color, sm.rol, COALESCE(g.xp_total,0) AS xp_total, COALESCE(g.nivel,1) AS nivel,
            COALESCE(g.racha_actual,0) AS racha, g.ultima_actividad
     FROM squad_miembros sm JOIN usuarios u ON u.id=sm.estudiante_id LEFT JOIN perfil_gamificacion g ON g.estudiante_id=u.id
     WHERE sm.squad_id=:s ORDER BY xp_total DESC`, { s: squadId }))
    .map((m) => ({ ...m, racha: G.rachaVigente(m.ultima_actividad, m.racha, hoy), entreno_hoy: m.ultima_actividad === hoy }));
  const feed = (await select(
    `SELECT f.id, f.tipo, f.detalle, f.created_at, u.id AS estudiante_id, u.nombre FROM actividad_feed f JOIN usuarios u ON u.id=f.estudiante_id
     WHERE f.squad_id=:s ORDER BY f.created_at DESC, f.id DESC LIMIT 20`, { s: squadId }))
    .map((f) => ({ ...f, detalle: typeof f.detalle === 'string' ? JSON.parse(f.detalle) : f.detalle }));
  // insignias por miembro y resumen del squad (racha combinada y sesiones de la semana)
  const ins = await select(
    `SELECT estudiante_id, COUNT(*) AS n FROM estudiante_insignias
     WHERE estudiante_id IN (SELECT estudiante_id FROM squad_miembros WHERE squad_id=:s) GROUP BY estudiante_id`, { s: squadId });
  for (const m of miembros) m.insignias = Number((ins.find((i) => i.estudiante_id === m.id) || { n: 0 }).n);
  const sesSemana = await one(
    `SELECT COUNT(*) AS n FROM sesiones_entrenamiento s JOIN squad_miembros sm ON sm.estudiante_id=s.estudiante_id
     WHERE sm.squad_id=:s AND s.fecha >= :l`, { s: squadId, l: clock.lunesDe(hoy) });
  const resumen = { racha_combinada: miembros.reduce((a, m) => a + m.racha, 0), sesiones_semana: Number(sesSemana.n) };
  const esMiembro = miembros.some((m) => m.id === actor.id);
  return {
    id: sq.id, nombre: sq.nombre, descripcion: sq.descripcion, lider_id: sq.lider_id, max_miembros: sq.max_miembros,
    codigo_invitacion: esMiembro ? sq.codigo_invitacion : undefined, // el codigo solo lo ven los miembros
    resumen, miembros, feed
  };
}

async function miSquad(actor) {
  await H.exigirEstudiante(actor);
  const sq = await H.squadDe(actor.id);
  return sq ? detalleSquad(actor, sq.squad_id) : null;
}

// Compara al estudiante con otro miembro de su squad en un ejercicio (alimenta la mascota: ganas/pierdes/empate).
async function compararMiembros(actor, otroId, ejercicioId) {
  await H.exigirEstudiante(actor);
  const a = await H.squadDe(actor.id), b = await H.squadDe(otroId);
  if (!a || !b || a.squad_id !== b.squad_id) throw E.forbidden('Solo puedes compararte con miembros de tu squad');
  if (otroId === actor.id) throw E.badRequest('Elige a otro miembro para comparar');
  const ej = await one('SELECT id,nombre,mide_reps FROM ejercicios WHERE id=:id', { id: ejercicioId });
  if (!ej) throw E.notFound('Ejercicio no encontrado');
  const lunes = clock.lunesDe(clock.hoy());
  const stats = async (id) => {
    const r = await one(
      `SELECT COALESCE(SUM(sr.repeticiones),0) AS reps, COALESCE(SUM(sr.duracion_seg),0) AS seg, COALESCE(MAX(sr.peso_kg),0) AS peso,
              COALESCE(SUM(CASE WHEN s.fecha >= :l THEN sr.repeticiones END),0) AS reps_semana
       FROM series_ejercicio sr JOIN sesiones_entrenamiento s ON s.id=sr.sesion_id WHERE s.estudiante_id=:e AND sr.ejercicio_id=:ej`,
      { e: id, ej: ejercicioId, l: lunes });
    const u = await one('SELECT nombre FROM usuarios WHERE id=:id', { id });
    return { estudiante_id: id, nombre: u.nombre, total: Number(ej.mide_reps ? r.reps : r.seg), mejor_peso_kg: Number(r.peso), semana_actual: Number(r.reps_semana) };
  };
  const yo = await stats(actor.id), otro = await stats(otroId);
  const resultado = yo.total > otro.total ? 'ganas' : yo.total < otro.total ? 'pierdes' : (yo.mejor_peso_kg === otro.mejor_peso_kg ? 'empate' : yo.mejor_peso_kg > otro.mejor_peso_kg ? 'ganas' : 'pierdes');
  return { ejercicio: ej.nombre, unidad: ej.mide_reps ? 'reps' : 'segundos', yo, otro, resultado, diferencia: Math.abs(yo.total - otro.total) };
}

module.exports = { crearSquad, unirseSquad, salirSquad, detalleSquad, miSquad, compararMiembros };
