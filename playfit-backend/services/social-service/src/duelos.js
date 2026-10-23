// Duelos 1 vs 1 entre miembros del mismo squad (RF-13).
// Flujo: el retador propone (metrica, ejercicio, dias) -> el retado acepta o rechaza -> corre la ventana de dias
// -> al vencer se resuelve con los datos REALES de las sesiones y el ganador recibe XP.
// Anti-abuso: solo dentro del squad, maximo 3 duelos abiertos por persona, 1 entre la misma pareja, la XP la fija el
// servidor y sin entrenar (progreso 0) no se gana nada.
const { one, select, insert, run, tx, E, rbac, clock } = require('@playfit/shared');
const H = require('./helpers');
const { medir } = require('./retos');

const DUELO = { MAX_ABIERTOS: 3, MAX_DIAS: 7, DIAS_PARA_RESPONDER: 3, XP_GANADOR: 60, XP_EMPATE: 25 };
const METRICAS = ['reps', 'sesiones', 'peso_maximo'];
const ABIERTOS = "('pendiente','activo')";

const nombreMetrica = (d) => (d.metrica === 'sesiones' ? 'sesiones' : d.metrica === 'peso_maximo' ? `peso maximo en ${d.ejercicio}` : `repeticiones de ${d.ejercicio}`);

async function crearDuelo(actor, d = {}) {
  rbac.requirePermiso(actor, 'squad:gestionar_propio');
  const rivalId = Number(d.rival_id);
  if (!Number.isInteger(rivalId) || rivalId < 1) throw E.badRequest('Indica rival_id (el companero al que retas)');
  if (rivalId === actor.id) throw E.badRequest('No puedes retarte a ti mismo');
  if (!METRICAS.includes(d.metrica)) throw E.badRequest(`metrica debe ser: ${METRICAS.join(', ')}`);
  const dias = Number(d.dias);
  if (!Number.isInteger(dias) || dias < 1 || dias > DUELO.MAX_DIAS) throw E.badRequest(`dias debe ser un entero entre 1 y ${DUELO.MAX_DIAS}`);
  let ejercicioId = null;
  if (d.metrica !== 'sesiones') {
    ejercicioId = Number(d.ejercicio_id);
    const ej = Number.isInteger(ejercicioId) && ejercicioId > 0 ? await one('SELECT id, mide_reps FROM ejercicios WHERE id=:id AND activo=1', { id: ejercicioId }) : null;
    if (!ej) throw E.badRequest('Indica un ejercicio_id valido para el duelo');
    if (!ej.mide_reps) throw E.badRequest('Ese ejercicio se mide por tiempo: elige uno de repeticiones', 'EJERCICIO_INVALIDO');
  }
  return tx(async (t) => {
    await H.lockPerfil(actor.id, t);
    const a = await H.squadDe(actor.id, t), b = await H.squadDe(rivalId, t);
    if (!a) throw E.badRequest('Primero unete o crea un squad', 'REQUIERE_SQUAD');
    if (!b || a.squad_id !== b.squad_id) throw E.forbidden('Solo puedes retar a miembros de tu squad');
    await expirarPendientes(t);
    const pareja = await one(
      `SELECT id FROM duelos WHERE estado IN ${ABIERTOS} AND ((retador_id=:a AND retado_id=:b) OR (retador_id=:b AND retado_id=:a))`,
      { a: actor.id, b: rivalId }, t);
    if (pareja) throw E.conflict('Ya tienes un duelo abierto con esa persona', 'DUELO_YA_EXISTE');
    for (const [id, quien] of [[actor.id, 'Tienes'], [rivalId, 'Tu rival tiene']]) {
      const n = Number((await one(`SELECT COUNT(*) AS n FROM duelos WHERE estado IN ${ABIERTOS} AND (retador_id=:e OR retado_id=:e)`, { e: id }, t)).n);
      if (n >= DUELO.MAX_ABIERTOS) throw E.conflict(`${quien} el maximo de ${DUELO.MAX_ABIERTOS} duelos abiertos`, 'LIMITE_DUELOS');
    }
    const id = await insert(
      'INSERT INTO duelos (squad_id,retador_id,retado_id,metrica,ejercicio_id,dias) VALUES (:s,:a,:b,:m,:ej,:d)',
      { s: a.squad_id, a: actor.id, b: rivalId, m: d.metrica, ej: ejercicioId, d: dias }, t);
    const yo = await one('SELECT nombre FROM usuarios WHERE id=:id', { id: actor.id }, t);
    await H.notificar(rivalId, 'duelo', `${yo.nombre} te reto a un duelo`, `${dias} dia(s). Aceptalo o rechazalo en Retos > Duelos.`, t);
    return vistaDuelo(await filaDuelo(id, t), actor.id, t);
  });
}

async function responderDuelo(actor, dueloId, aceptar) {
  rbac.requirePermiso(actor, 'squad:gestionar_propio');
  if (typeof aceptar !== 'boolean') throw E.badRequest('"aceptar" debe ser true o false');
  return tx(async (t) => {
    await expirarPendientes(t);
    const d = await one('SELECT * FROM duelos WHERE id=:id FOR UPDATE', { id: dueloId }, t);
    if (!d || (d.retado_id !== actor.id && d.retador_id !== actor.id)) throw E.notFound('Duelo no encontrado');
    if (d.retado_id !== actor.id) throw E.forbidden('Solo la persona retada puede responder');
    if (d.estado !== 'pendiente') throw E.conflict('Este duelo ya no esta pendiente', 'DUELO_NO_PENDIENTE');
    const yo = await one('SELECT nombre FROM usuarios WHERE id=:id', { id: actor.id }, t);
    if (!aceptar) {
      await run("UPDATE duelos SET estado='rechazado', resuelto_at=UTC_TIMESTAMP() WHERE id=:id", { id: dueloId }, t);
      await H.notificar(d.retador_id, 'duelo', `${yo.nombre} rechazo tu duelo`, null, t);
    } else {
      const a = await H.squadDe(d.retador_id, t), b = await H.squadDe(actor.id, t);
      if (!a || !b || a.squad_id !== b.squad_id) {
        await run("UPDATE duelos SET estado='cancelado', resuelto_at=UTC_TIMESTAMP() WHERE id=:id", { id: dueloId }, t);
        throw E.conflict('Ya no estan en el mismo squad: el duelo se cancelo', 'DUELO_CANCELADO');
      }
      const hoy = clock.hoy();
      await run("UPDATE duelos SET estado='activo', fecha_inicio=:i, fecha_fin=:f WHERE id=:id",
        { i: hoy, f: clock.addDays(hoy, d.dias - 1), id: dueloId }, t);
      await H.notificar(d.retador_id, 'duelo', `${yo.nombre} acepto tu duelo`, `Empieza hoy y dura ${d.dias} dia(s).`, t);
    }
    return vistaDuelo(await filaDuelo(dueloId, t), actor.id, t);
  });
}

async function cancelarDuelo(actor, dueloId) {
  rbac.requirePermiso(actor, 'squad:gestionar_propio');
  return tx(async (t) => {
    const d = await one('SELECT * FROM duelos WHERE id=:id FOR UPDATE', { id: dueloId }, t);
    if (!d || (d.retado_id !== actor.id && d.retador_id !== actor.id)) throw E.notFound('Duelo no encontrado');
    if (d.retador_id !== actor.id || d.estado !== 'pendiente') throw E.conflict('Solo puedes cancelar un duelo que propusiste y que aun no fue aceptado', 'DUELO_NO_CANCELABLE');
    await run("UPDATE duelos SET estado='cancelado', resuelto_at=UTC_TIMESTAMP() WHERE id=:id", { id: dueloId }, t);
  });
}

// Los pendientes que nadie respondio en 3 dias vencen solos.
const expirarPendientes = (t) => run(
  `UPDATE duelos SET estado='expirado', resuelto_at=UTC_TIMESTAMP() WHERE estado='pendiente' AND created_at < (NOW() - INTERVAL ${DUELO.DIAS_PARA_RESPONDER} DAY)`, {}, t);

// Resuelve los duelos activos cuya ventana ya termino (idempotente: el FOR UPDATE + estado='activo' evita pagar dos veces).
async function resolverVencidos({ estudianteId = null } = {}) {
  const hoy = clock.hoy();
  const filtro = estudianteId ? 'AND (retador_id=:e OR retado_id=:e)' : '';
  const ids = await select(`SELECT id FROM duelos WHERE estado='activo' AND fecha_fin < :h ${filtro}`, { h: hoy, e: estudianteId });
  const resueltos = [];
  for (const { id } of ids) {
    const r = await tx(async (t) => {
      const d = await one("SELECT * FROM duelos WHERE id=:id AND estado='activo' FOR UPDATE", { id }, t);
      if (!d || d.fecha_fin >= hoy) return null;
      const pa = await medir(d.metrica, d.ejercicio_id, d.retador_id, d.fecha_inicio, d.fecha_fin, t);
      const pb = await medir(d.metrica, d.ejercicio_id, d.retado_id, d.fecha_inicio, d.fecha_fin, t);
      const ganador = pa > pb ? d.retador_id : pb > pa ? d.retado_id : null;
      await run(`UPDATE duelos SET estado='finalizado', progreso_retador=:pa, progreso_retado=:pb, ganador_id=:g, resuelto_at=UTC_TIMESTAMP() WHERE id=:id`,
        { pa, pb, g: ganador, id }, t);
      const ej = d.ejercicio_id ? await one('SELECT nombre FROM ejercicios WHERE id=:id', { id: d.ejercicio_id }, t) : null;
      const desc = nombreMetrica({ metrica: d.metrica, ejercicio: ej ? ej.nombre : '' });
      if (ganador) {
        const perdedor = ganador === d.retador_id ? d.retado_id : d.retador_id;
        await H.ensurePerfil(ganador, t);
        await H.otorgarXp(ganador, DUELO.XP_GANADOR, 'duelo', 'duelo', id, t);
        await H.notificar(ganador, 'duelo', 'Ganaste el duelo', `${Math.max(pa, pb)} vs ${Math.min(pa, pb)} en ${desc}. +${DUELO.XP_GANADOR} XP`, t);
        await H.notificar(perdedor, 'duelo', 'Perdiste el duelo', `${Math.min(pa, pb)} vs ${Math.max(pa, pb)} en ${desc}. La revancha te espera.`, t);
        await H.publicarFeed(ganador, 'duelo', { duelo_id: id, resultado: 'gano', metrica: d.metrica }, t);
      } else {
        for (const e of [d.retador_id, d.retado_id]) {
          if (pa > 0) { await H.ensurePerfil(e, t); await H.otorgarXp(e, DUELO.XP_EMPATE, 'duelo', 'duelo', id, t); } // empate entrenando: XP de consolacion
          await H.notificar(e, 'duelo', 'Duelo empatado', pa > 0 ? `${pa} vs ${pb} en ${desc}. +${DUELO.XP_EMPATE} XP` : 'Ninguno entreno: sin XP.', t);
        }
      }
      return { id, ganador_id: ganador, progreso_retador: pa, progreso_retado: pb };
    });
    if (r) resueltos.push(r);
  }
  return resueltos;
}

const filaDuelo = (id, t) => one(
  `SELECT d.*, ua.nombre AS retador_nombre, ua.apellido AS retador_apellido, ua.avatar_color AS retador_color,
          ub.nombre AS retado_nombre, ub.apellido AS retado_apellido, ub.avatar_color AS retado_color, e.nombre AS ejercicio
   FROM duelos d JOIN usuarios ua ON ua.id=d.retador_id JOIN usuarios ub ON ub.id=d.retado_id
   LEFT JOIN ejercicios e ON e.id=d.ejercicio_id WHERE d.id=:id`, { id }, t);

// Vista desde el punto de vista de quien consulta: "yo" y "rival", con progreso en vivo si esta activo.
async function vistaDuelo(d, yoId, t) {
  const soyRetador = d.retador_id === yoId;
  const persona = (pre) => ({ id: d[`${pre}_id`], nombre: d[`${pre}_nombre`], apellido: d[`${pre}_apellido`], avatar_color: d[`${pre}_color`] });
  let pa = d.progreso_retador, pb = d.progreso_retado;
  if (d.estado === 'activo') {
    pa = await medir(d.metrica, d.ejercicio_id, d.retador_id, d.fecha_inicio, d.fecha_fin, t);
    pb = await medir(d.metrica, d.ejercicio_id, d.retado_id, d.fecha_inicio, d.fecha_fin, t);
  }
  const hoy = clock.hoy();
  const yo = soyRetador ? persona('retador') : persona('retado'), rival = soyRetador ? persona('retado') : persona('retador');
  const miP = soyRetador ? pa : pb, suP = soyRetador ? pb : pa;
  return {
    id: d.id, estado: d.estado, metrica: d.metrica, ejercicio: d.ejercicio, ejercicio_id: d.ejercicio_id, dias: d.dias,
    descripcion: nombreMetrica(d), fecha_inicio: d.fecha_inicio, fecha_fin: d.fecha_fin,
    dias_restantes: d.estado === 'activo' ? Math.max(0, clock.diffDays(d.fecha_fin, hoy)) : null,
    soy_retador: soyRetador, yo, rival,
    mi_progreso: miP === null || miP === undefined ? null : Number(miP),
    su_progreso: suP === null || suP === undefined ? null : Number(suP),
    resultado: d.estado !== 'finalizado' ? null : d.ganador_id === null ? 'empate' : d.ganador_id === yoId ? 'gane' : 'perdi',
    puede_responder: d.estado === 'pendiente' && !soyRetador,
    puede_cancelar: d.estado === 'pendiente' && soyRetador,
    xp_ganador: DUELO.XP_GANADOR
  };
}

async function listarDuelos(actor) {
  rbac.requirePermiso(actor, 'squad:gestionar_propio');
  await expirarPendientes();
  await resolverVencidos({ estudianteId: actor.id });
  const filas = await select(
    `SELECT d.id FROM duelos d WHERE (d.retador_id=:e OR d.retado_id=:e)
     AND (d.estado IN ${ABIERTOS} OR d.resuelto_at >= (UTC_TIMESTAMP() - INTERVAL 30 DAY))
     ORDER BY FIELD(d.estado,'pendiente','activo') DESC, d.id DESC LIMIT 30`, { e: actor.id });
  const vistas = [];
  for (const f of filas) vistas.push(await vistaDuelo(await filaDuelo(f.id), actor.id));
  return {
    recibidos: vistas.filter((v) => v.estado === 'pendiente' && !v.soy_retador),
    enviados: vistas.filter((v) => v.estado === 'pendiente' && v.soy_retador),
    activos: vistas.filter((v) => v.estado === 'activo'),
    historial: vistas.filter((v) => !['pendiente', 'activo'].includes(v.estado)),
    reglas: { max_abiertos: DUELO.MAX_ABIERTOS, max_dias: DUELO.MAX_DIAS, xp_ganador: DUELO.XP_GANADOR, xp_empate: DUELO.XP_EMPATE, metricas: METRICAS }
  };
}

module.exports = { crearDuelo, responderDuelo, cancelarDuelo, listarDuelos, resolverVencidos, DUELO };
