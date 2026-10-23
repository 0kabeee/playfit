// auth-service · panel del administrador: auditoria de accesos y metricas AGREGADAS y anonimas.
// El admin nunca ve texto clinico ni datos individuales de entrenamiento: solo conteos.
const { one, select, E, rbac } = require('@playfit/shared');

async function auditoria(actor, { limite = 100, recurso, usuarioId } = {}) {
  rbac.requirePermiso(actor, 'auditoria:ver');
  const lim = Math.min(Math.max(Number(limite) || 100, 1), 500);
  if (recurso !== undefined && (typeof recurso !== 'string' || recurso.length > 40)) throw E.badRequest('recurso invalido');
  const filtros = [], r = { lim };
  if (recurso) { filtros.push('a.recurso=:rec'); r.rec = recurso; }
  if (usuarioId) { filtros.push('a.usuario_id=:uid'); r.uid = Number(usuarioId); }
  return select(
    `SELECT a.id, a.created_at, a.accion, a.recurso, a.recurso_id, a.ip, a.usuario_id, u.email AS usuario_email
     FROM auditoria_accesos a LEFT JOIN usuarios u ON u.id=a.usuario_id
     ${filtros.length ? 'WHERE ' + filtros.join(' AND ') : ''}
     ORDER BY a.id DESC LIMIT :lim`, r);
}

async function metricas(actor) {
  rbac.requirePermiso(actor, 'metricas:ver');
  const n = async (sql) => Number((await one(sql)).n);
  const usuarios = await n(`SELECT COUNT(*) AS n FROM usuarios u JOIN roles r ON r.id=u.rol_id WHERE r.nombre='estudiante'`);
  const activos7 = await n(`SELECT COUNT(DISTINCT estudiante_id) AS n FROM sesiones_entrenamiento WHERE fecha >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)`);
  const semanas = await select(
    `SELECT YEARWEEK(fecha, 3) AS semana, MIN(fecha) AS desde, COUNT(*) AS sesiones, COUNT(DISTINCT estudiante_id) AS usuarios
     FROM sesiones_entrenamiento WHERE fecha >= DATE_SUB(CURDATE(), INTERVAL 28 DAY)
     GROUP BY YEARWEEK(fecha, 3) ORDER BY semana`);
  // retencion: de quienes se registraron hace 7+ dias, cuantos entrenaron en los ultimos 7 dias
  const base = await n(`SELECT COUNT(*) AS n FROM usuarios u JOIN roles r ON r.id=u.rol_id WHERE r.nombre='estudiante' AND u.created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)`);
  const vuelven = await n(
    `SELECT COUNT(DISTINCT s.estudiante_id) AS n FROM sesiones_entrenamiento s JOIN usuarios u ON u.id=s.estudiante_id
     WHERE s.fecha >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) AND u.created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)`);
  return {
    usuarios_total: usuarios,
    usuarios_nuevos_7d: await n(`SELECT COUNT(*) AS n FROM usuarios u JOIN roles r ON r.id=u.rol_id WHERE r.nombre='estudiante' AND u.created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)`),
    usuarios_activos_7d: activos7,
    sesiones_total: await n('SELECT COUNT(*) AS n FROM sesiones_entrenamiento'),
    sesiones_por_semana: semanas.map((s) => ({ semana: Number(s.semana), desde: s.desde, sesiones: Number(s.sesiones), usuarios: Number(s.usuarios) })),
    retencion_7d: base ? Math.round((vuelven / base) * 100) : null,
    squads: await n('SELECT COUNT(*) AS n FROM squads'),
    retos_activos: await n('SELECT COUNT(*) AS n FROM retos WHERE activo=1 AND fecha_fin >= CURDATE()'),
    usuarios_con_2fa: await n('SELECT COUNT(*) AS n FROM usuarios WHERE totp_activo=1')
  };
}
module.exports = { auditoria, metricas };
