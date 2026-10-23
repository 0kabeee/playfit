// Chat de soporte usuario <-> admin.
// Usuario: escribe en Soporte; mientras la conversacion esta con el bot recibe respuestas automaticas.
//   Si menciona pagos/Premium (o pide una persona) -> "Un momento, ya te transfiero a un asistente humano" y pasa a la bandeja.
// Admin: ve la bandeja (pendientes primero), responde, y cierra. Cada vez que un admin abre una conversacion queda en la auditoria.
const { one, select, run, tx, E, rbac, audit, soporte: S } = require('@playfit/shared');
const H = require('./helpers');

const MAX_MENSAJE = 1000, MAX_POR_HORA = 30;

function validarTexto(m) {
  if (typeof m !== 'string' || !m.trim()) throw E.badRequest('Escribe un mensaje');
  if (m.length > MAX_MENSAJE) throw E.badRequest(`El mensaje no puede superar ${MAX_MENSAJE} caracteres`);
  return m.trim();
}

const mensajesDe = (convId) =>
  select('SELECT id, autor, contenido, created_at FROM soporte_mensajes WHERE conversacion_id=:c ORDER BY id', { c: convId });

const vistaUsuario = async (c) => (c ? {
  id: c.id, estado: c.estado, motivo: c.motivo, con_humano: ['pendiente', 'atendiendo'].includes(c.estado),
  created_at: c.created_at, mensajes: await mensajesDe(c.id)
} : null);

// ---------------- lado del usuario ----------------
async function miSoporte(actor) {
  rbac.requirePermiso(actor, 'soporte:usar');
  const c = await one("SELECT * FROM soporte_conversaciones WHERE usuario_id=:u AND estado<>'cerrada' ORDER BY id DESC LIMIT 1", { u: actor.id });
  if (c && c.no_leidos_usuario) await run('UPDATE soporte_conversaciones SET no_leidos_usuario=0 WHERE id=:id', { id: c.id });
  return { conversacion: await vistaUsuario(c) };
}

async function enviarMensajeUsuario(actor, mensaje) {
  rbac.requirePermiso(actor, 'soporte:usar');
  const texto = validarTexto(mensaje);
  const n = await one(
    `SELECT COUNT(*) AS n FROM soporte_mensajes m JOIN soporte_conversaciones c ON c.id=m.conversacion_id
     WHERE c.usuario_id=:u AND m.autor='usuario' AND m.created_at >= (UTC_TIMESTAMP() - INTERVAL 1 HOUR)`, { u: actor.id });
  if (Number(n.n) >= MAX_POR_HORA) throw E.tooMany('Enviaste muchos mensajes seguidos. Espera un rato y vuelve a escribir.', 'LIMITE_SOPORTE');
  const res = await tx(async (t) => {
    const c = await S.obtenerOAbrir(actor.id, t);
    await S.agregarMensaje(c.id, 'usuario', actor.id, texto, t);
    let transferida = false;
    if (c.estado === 'bot') {
      const pago = S.detectarPago(texto);
      if (pago || S.detectarHumano(texto)) {
        await S.agregarMensaje(c.id, 'bot', null, S.MSG_TRANSFERENCIA, t);
        await S.marcarTransferida(c.id, pago ? 'pago' : 'general', t);
        transferida = true;
      } else await S.agregarMensaje(c.id, 'bot', null, S.respuestaBot(texto), t);
    }
    return { id: c.id, transferida };
  });
  const c = await one('SELECT * FROM soporte_conversaciones WHERE id=:id', { id: res.id });
  await run('UPDATE soporte_conversaciones SET no_leidos_usuario=0 WHERE id=:id', { id: c.id });
  return { transferida: res.transferida, conversacion: await vistaUsuario(c) };
}

async function cerrarMiSoporte(actor) {
  rbac.requirePermiso(actor, 'soporte:usar');
  const c = await one("SELECT id FROM soporte_conversaciones WHERE usuario_id=:u AND estado<>'cerrada' ORDER BY id DESC LIMIT 1", { u: actor.id });
  if (!c) throw E.notFound('No tienes una conversacion abierta');
  await run("UPDATE soporte_conversaciones SET estado='cerrada', cerrada_at=UTC_TIMESTAMP() WHERE id=:id", { id: c.id });
}

// ---------------- lado del admin ----------------
const ESTADOS_BANDEJA = ['pendiente', 'atendiendo', 'cerrada', 'abiertas'];

async function bandeja(actor, { estado = 'abiertas' } = {}) {
  rbac.requirePermiso(actor, 'soporte:atender');
  if (!ESTADOS_BANDEJA.includes(estado)) throw E.badRequest(`estado debe ser: ${ESTADOS_BANDEJA.join(', ')}`);
  // "abiertas" = transferidas a humano (pendientes y en atencion). Las que siguen con el bot no le llegan al admin.
  const filtro = estado === 'abiertas' ? "c.estado IN ('pendiente','atendiendo')" : 'c.estado=:e';
  const filas = await select(
    `SELECT c.id, c.estado, c.motivo, c.no_leidos_admin, c.transferida_at, c.ultimo_mensaje_at, c.created_at,
            u.id AS usuario_id, u.nombre, u.apellido, u.email, a.nombre AS asignado,
            (SELECT m.contenido FROM soporte_mensajes m WHERE m.conversacion_id=c.id ORDER BY m.id DESC LIMIT 1) AS ultimo_mensaje
     FROM soporte_conversaciones c JOIN usuarios u ON u.id=c.usuario_id LEFT JOIN usuarios a ON a.id=c.asignado_a
     WHERE ${filtro} AND c.transferida_at IS NOT NULL
     ORDER BY FIELD(c.estado,'pendiente') DESC, c.ultimo_mensaje_at DESC LIMIT 100`, { e: estado });
  const pend = await one("SELECT COUNT(*) AS n FROM soporte_conversaciones WHERE estado='pendiente'");
  return { pendientes: Number(pend.n), conversaciones: filas.map((f) => ({ ...f, no_leidos_admin: Number(f.no_leidos_admin) })) };
}

async function convParaAdmin(id, t) {
  const c = await one('SELECT * FROM soporte_conversaciones WHERE id=:id', { id }, t);
  if (!c || !c.transferida_at) throw E.notFound('Conversacion no encontrada'); // las que nunca se transfirieron son privadas del usuario
  return c;
}

async function verConversacionAdmin(actor, id, { ip } = {}) {
  rbac.requirePermiso(actor, 'soporte:atender');
  const c = await convParaAdmin(id);
  await run('UPDATE soporte_conversaciones SET no_leidos_admin=0 WHERE id=:id', { id });
  await audit.registrar(actor, 'leer', 'soporte_conversacion', id, { ip });
  const u = await one('SELECT id, nombre, apellido, email FROM usuarios WHERE id=:id', { id: c.usuario_id });
  return { id: c.id, estado: c.estado, motivo: c.motivo, usuario: u, asignado_a: c.asignado_a, mensajes: await mensajesDe(id) };
}

async function responderAdmin(actor, id, mensaje, { ip } = {}) {
  rbac.requirePermiso(actor, 'soporte:atender');
  const texto = validarTexto(mensaje);
  await tx(async (t) => {
    const c = await convParaAdmin(id, t);
    if (c.estado === 'cerrada') throw E.conflict('La conversacion esta cerrada', 'CONVERSACION_CERRADA');
    await S.agregarMensaje(id, 'admin', actor.id, texto, t);
    await run("UPDATE soporte_conversaciones SET estado='atendiendo', asignado_a=COALESCE(asignado_a,:a), no_leidos_admin=0 WHERE id=:id", { a: actor.id, id }, t);
    await H.notificar(c.usuario_id, 'soporte', 'Soporte te respondio', texto.slice(0, 120), t);
    await audit.registrar(actor, 'actualizar', 'soporte_conversacion', id, { ip, t });
  });
  return verConversacionAdmin(actor, id, { ip });
}

async function cerrarAdmin(actor, id, { ip } = {}) {
  rbac.requirePermiso(actor, 'soporte:atender');
  await tx(async (t) => {
    const c = await convParaAdmin(id, t);
    if (c.estado === 'cerrada') return;
    await S.agregarMensaje(id, 'bot', null, 'La conversacion fue cerrada por soporte. Si necesitas algo mas, escribe de nuevo.', t);
    await run("UPDATE soporte_conversaciones SET estado='cerrada', cerrada_at=UTC_TIMESTAMP() WHERE id=:id", { id }, t);
    await audit.registrar(actor, 'actualizar', 'soporte_conversacion', id, { ip, t });
  });
}

module.exports = { miSoporte, enviarMensajeUsuario, cerrarMiSoporte, bandeja, verConversacionAdmin, responderAdmin, cerrarAdmin };
