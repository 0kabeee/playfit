// PlayFit Premium (Fase 14). Lo que se paga es la PERSONALIZACION del agente de IA:
//  - memoria del agente (recuerda objetivo, nivel, horario, equipo...) entre conversaciones
//  - mas mensajes al asistente por dia
//  - voz del asistente (dictar y escuchar las respuestas)
// Todo lo demas (rachas, XP, squads, retos, duelos, ranking, camara, tecnica) sigue siendo gratis.
//
// El estado vive en usuarios.premium_hasta (UTC). Cada cambio queda en premium_movimientos (auditoria).
const { one, insert, run } = require('./db');

const PREMIUM = {
  PRECIO_COP: Number(process.env.PREMIUM_PRECIO_COP || 9900),
  DIAS: 30,
  MAX_CORTESIA_DIAS: 90
};
const BENEFICIOS = [
  'El asistente recuerda tu objetivo, nivel, horario y equipo',
  'Mas mensajes al asistente cada dia',
  'Habla con el asistente y escucha sus respuestas (voz)'
];

// 'YYYY-MM-DD HH:MM:SS' (UTC, asi llegan las fechas de la BD) -> Date
const aFecha = (s) => (s ? new Date(`${String(s).replace(' ', 'T')}Z`) : null);
const activo = (hasta, ahora = Date.now()) => { const d = aFecha(hasta); return !!d && d.getTime() > ahora; };
const iso = (hasta) => (hasta ? aFecha(hasta).toISOString() : null);
function diasRestantes(hasta, ahora = Date.now()) {
  const d = aFecha(hasta);
  return d && d.getTime() > ahora ? Math.ceil((d.getTime() - ahora) / 86400000) : 0;
}

async function estado(usuarioId, t) {
  const u = await one('SELECT premium_hasta FROM usuarios WHERE id=:id', { id: usuarioId }, t);
  const hasta = u ? u.premium_hasta : null;
  return { premium: activo(hasta), premium_hasta: activo(hasta) ? iso(hasta) : null, dias_restantes: diasRestantes(hasta) };
}
const esPremium = async (usuarioId, t) => (await estado(usuarioId, t)).premium;

// Suma dias: si ya es Premium se extiende desde su fecha de vencimiento; si no, desde ahora.
async function extender(usuarioId, dias, motivo, { pagoId = null, adminId = null, nota = null } = {}, t) {
  await run(
    `UPDATE usuarios SET premium_hasta = DATE_ADD(GREATEST(COALESCE(premium_hasta, UTC_TIMESTAMP()), UTC_TIMESTAMP()), INTERVAL :d DAY)
     WHERE id=:u`, { d: dias, u: usuarioId }, t);
  const u = await one('SELECT premium_hasta FROM usuarios WHERE id=:u', { u: usuarioId }, t);
  await insert('INSERT INTO premium_movimientos (usuario_id,motivo,dias,hasta,pago_id,admin_id,nota) VALUES (:u,:m,:d,:h,:p,:a,:n)',
    { u: usuarioId, m: motivo, d: dias, h: u.premium_hasta, p: pagoId, a: adminId, n: nota }, t);
  return iso(u.premium_hasta);
}

async function revocar(usuarioId, adminId, nota, t) {
  await run('UPDATE usuarios SET premium_hasta=NULL WHERE id=:u', { u: usuarioId }, t);
  await insert("INSERT INTO premium_movimientos (usuario_id,motivo,dias,admin_id,nota) VALUES (:u,'revocado',0,:a,:n)",
    { u: usuarioId, a: adminId, n: nota || null }, t);
}

module.exports = { PREMIUM, BENEFICIOS, activo, iso, diasRestantes, estado, esPremium, extender, revocar };
