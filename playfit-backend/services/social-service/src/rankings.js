// Rankings (XP general y por ejercicio con tendencia semanal) y perfil/dashboard del estudiante.
const { one, select, E, rbac, clock } = require('@playfit/shared');
const H = require('./helpers');
const G = require('./gamification');
const { listarRetos } = require('./retos');

const limiteSeguro = (l) => Math.min(Math.max(parseInt(l, 10) || 20, 1), 100);

async function rankingXp(actor, { limite = 20, squadId = null } = {}) {
  rbac.requirePermiso(actor, 'ranking:ver');
  const hoy = clock.hoy();
  let filtro = '';
  const rep = { l: limiteSeguro(limite) };
  if (squadId) {
    if (actor.rol === 'estudiante') {
      const sq = await H.squadDe(actor.id);
      if (!sq || sq.squad_id !== Number(squadId)) throw E.forbidden('Solo puedes ver el ranking de tu propio squad');
    }
    filtro = 'AND u.id IN (SELECT estudiante_id FROM squad_miembros WHERE squad_id=:sq)';
    rep.sq = Number(squadId);
  }
  const filas = await select(
    `SELECT * FROM (SELECT u.id AS estudiante_id, u.nombre, u.apellido, u.avatar_color, g.xp_total, g.nivel, g.racha_actual, g.ultima_actividad,
            RANK() OVER (ORDER BY g.xp_total DESC) AS puesto
     FROM perfil_gamificacion g JOIN usuarios u ON u.id=g.estudiante_id AND u.activo=1 WHERE 1=1 ${filtro}) x ORDER BY puesto, nombre LIMIT :l`, rep);
  return filas.map((f) => ({ ...f, puesto: Number(f.puesto), racha: G.rachaVigente(f.ultima_actividad, f.racha_actual, hoy), es_yo: f.estudiante_id === actor.id }));
}

async function rankingEjercicio(actor, ejercicioId, { limite = 20 } = {}) {
  rbac.requirePermiso(actor, 'ranking:ver');
  const ej = await one('SELECT id,nombre,mide_reps FROM ejercicios WHERE id=:id AND activo=1', { id: ejercicioId });
  if (!ej) throw E.notFound('Ejercicio no encontrado');
  const lunes = clock.lunesDe(clock.hoy()), lunesPrev = clock.addDays(lunes, -7);
  const campo = ej.mide_reps ? 'sr.repeticiones' : 'sr.duracion_seg';
  const filas = await select(
    `SELECT * FROM (SELECT u.id AS estudiante_id, u.nombre, u.apellido, u.avatar_color,
       SUM(${campo}) AS total, MAX(sr.peso_kg) AS mejor_peso_kg,
       COALESCE(SUM(CASE WHEN s.fecha >= :l THEN ${campo} END),0) AS semana_actual,
       COALESCE(SUM(CASE WHEN s.fecha >= :lp AND s.fecha < :l THEN ${campo} END),0) AS semana_anterior,
       RANK() OVER (ORDER BY SUM(${campo}) DESC) AS puesto
     FROM series_ejercicio sr JOIN sesiones_entrenamiento s ON s.id=sr.sesion_id JOIN usuarios u ON u.id=s.estudiante_id AND u.activo=1
     WHERE sr.ejercicio_id=:ej GROUP BY u.id) x ORDER BY puesto, nombre LIMIT :lim`,
    { l: lunes, lp: lunesPrev, ej: ejercicioId, lim: limiteSeguro(limite) });
  return {
    ejercicio: ej.nombre, unidad: ej.mide_reps ? 'reps' : 'segundos',
    ranking: filas.map((f) => ({
      ...f, puesto: Number(f.puesto), total: Number(f.total), semana_actual: Number(f.semana_actual), semana_anterior: Number(f.semana_anterior),
      mejor_peso_kg: f.mejor_peso_kg === null ? null : Number(f.mejor_peso_kg),
      tendencia: Number(f.semana_actual) > Number(f.semana_anterior) ? 'sube' : Number(f.semana_actual) < Number(f.semana_anterior) ? 'baja' : 'igual',
      es_yo: f.estudiante_id === actor.id
    }))
  };
}

// Pantalla principal: racha, puntos de la semana, squad, reto en vivo, insignias.
async function dashboard(actor) {
  await H.exigirEstudiante(actor);
  await H.ensurePerfil(actor.id);
  const hoy = clock.hoy(), lunes = clock.lunesDe(hoy);
  const p = await one('SELECT * FROM perfil_gamificacion WHERE estudiante_id=:e', { e: actor.id });
  const puesto = await one('SELECT puesto FROM (SELECT estudiante_id, RANK() OVER (ORDER BY xp_total DESC) AS puesto FROM perfil_gamificacion) x WHERE estudiante_id=:e', { e: actor.id });
  const dias = new Set((await select('SELECT DISTINCT fecha FROM sesiones_entrenamiento WHERE estudiante_id=:e AND fecha >= :l', { e: actor.id, l: lunes })).map((d) => d.fecha));
  const semana = Array.from({ length: 7 }, (_, i) => { const f = clock.addDays(lunes, i); return { fecha: f, entreno: dias.has(f), es_hoy: f === hoy }; });
  const insignias = await select('SELECT i.codigo,i.nombre,i.descripcion,i.icono,ei.obtenida_at FROM estudiante_insignias ei JOIN insignias i ON i.id=ei.insignia_id WHERE ei.estudiante_id=:e ORDER BY ei.obtenida_at DESC', { e: actor.id });
  const sq = await H.squadDe(actor.id);
  let squad = null;
  if (sq) {
    const lider = await one('SELECT id,nombre,apellido FROM usuarios WHERE id=:id', { id: sq.lider_id });
    squad = { id: sq.squad_id, nombre: sq.nombre, lider };
  }
  const retos = await listarRetos(actor);
  const retoEnVivo = retos.activos.sort((a, b) => b.porcentaje - a.porcentaje)[0] || null;
  return {
    xp_total: p.xp_total, ...G.progresoNivel(p.xp_total), puesto: Number(puesto.puesto),
    racha_actual: G.rachaVigente(p.ultima_actividad, p.racha_actual, hoy), racha_maxima: p.racha_maxima,
    entreno_hoy: p.ultima_actividad === hoy, semana, squad, reto_en_vivo: retoEnVivo, insignias
  };
}

module.exports = { rankingXp, rankingEjercicio, dashboard };
