// Nucleo del chat de soporte (lo usan el social-service y el asistente de IA del content-service).
// Regla pedida por el tutor: si el usuario habla de PAGOS, el asistente no responde por su cuenta:
// "Un momento, ya te transfiero a un asistente humano" y la conversacion pasa a la bandeja del admin.
const { one, insert, run } = require('./db');

const normalizar = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const PAGO = /\b(pago|pagos|pagar|pague|pagado|pagando|premium|suscripcion|suscribirme|suscribir|membresia|cobro|cobros|cobraron|cobrar|cobran|tarjeta|factura|reembolso|reembolsar|devolucion de (mi )?dinero|wompi|nequi|daviplata|pse|precio|cuanto cuesta|cuanto vale|plan pago)\b/;
const HUMANO = /\b(hablar con (un |una )?(humano|persona|asesor|asesora|agente|administrador|admin)|asesor humano|atencion humana|quiero un humano|persona real)\b/;
const detectarPago = (texto) => PAGO.test(normalizar(texto));
const detectarHumano = (texto) => HUMANO.test(normalizar(texto));

const MSG_TRANSFERENCIA = 'Un momento, ya te transfiero a un asistente humano. Te respondera por este chat de Soporte.';
const MSG_EN_COLA = 'Tu mensaje quedo en la conversacion. Un asistente humano te respondera pronto.';

// Respuestas automaticas simples mientras la conversacion esta con el bot (sin IA: no gasta cuota ni envia datos a terceros).
const FAQ = [
  [/contrasena|clave|olvide/, 'Para cambiar tu contrasena ve a Perfil > Cuenta. Si la olvidaste, en la pantalla de inicio toca "¿Olvidaste tu contrasena?" y te llegara un codigo al correo.'],
  [/dos pasos|2fa|autenticador|codigo de verificacion/, 'La verificacion en dos pasos se activa en Perfil > Cuenta > Verificacion en dos pasos. Si perdiste el celular, usa uno de tus codigos de respaldo.'],
  [/racha/, 'La racha sube cuando entrenas dias seguidos. Si un dia no registras sesion, se reinicia. A los 7 y 14 dias ganas XP extra e insignias.'],
  [/squad|equipo|codigo de invitacion/, 'Puedes crear un squad o unirte con el codigo de invitacion de 8 caracteres en la pestana Squad. Solo puedes estar en un squad a la vez.'],
  [/reto|duelo/, 'En Retos ves los retos oficiales y los de tu squad. Desde tu squad puedes crear retos (max. 3 vigentes) y retar a un companero a un duelo de hasta 7 dias.'],
  [/eliminar (mi )?cuenta|borrar (mi )?cuenta/, 'Puedes eliminar tu cuenta en Perfil > Cuenta > Eliminar mi cuenta. Se borran tus datos de forma permanente.'],
  [/xp|nivel|puntos/, 'Ganas XP al registrar sesiones (max. 2 al dia), por records personales, rachas, retos y duelos. Cada 300 XP subes de nivel.']
];
function respuestaBot(texto) {
  const t = normalizar(texto);
  for (const [re, r] of FAQ) if (re.test(t)) return `${r}\n\nSi necesitas a una persona, escribe "hablar con un asesor".`;
  return 'Soy el asistente automatico de soporte. Puedo ayudarte con tu cuenta, rachas, squads, retos y duelos. Para pagos o el Premium te paso con una persona. Si quieres hablar con alguien del equipo, escribe "hablar con un asesor".';
}

// Conversacion abierta (no cerrada) del usuario, si existe.
const abiertaDe = (usuarioId, t) =>
  one("SELECT * FROM soporte_conversaciones WHERE usuario_id=:u AND estado<>'cerrada' ORDER BY id DESC LIMIT 1 FOR UPDATE", { u: usuarioId }, t);

async function obtenerOAbrir(usuarioId, t) {
  const c = await abiertaDe(usuarioId, t);
  if (c) return c;
  const id = await insert('INSERT INTO soporte_conversaciones (usuario_id) VALUES (:u)', { u: usuarioId }, t);
  return one('SELECT * FROM soporte_conversaciones WHERE id=:id', { id }, t);
}

// Guarda un mensaje y lleva los contadores de "no leidos" de cada lado.
async function agregarMensaje(convId, autor, autorId, contenido, t) {
  await insert('INSERT INTO soporte_mensajes (conversacion_id,autor,autor_id,contenido) VALUES (:c,:a,:ai,:m)',
    { c: convId, a: autor, ai: autorId || null, m: String(contenido).slice(0, 1000) }, t);
  const campo = autor === 'usuario' ? 'no_leidos_admin' : 'no_leidos_usuario';
  await run(`UPDATE soporte_conversaciones SET ultimo_mensaje_at=UTC_TIMESTAMP(), ${campo}=LEAST(${campo}+1,999) WHERE id=:c`, { c: convId }, t);
}

// Pasa la conversacion a la bandeja de los admins (estado pendiente).
async function marcarTransferida(convId, motivo, t) {
  await run(`UPDATE soporte_conversaciones SET estado='pendiente', motivo=:m, transferida_at=UTC_TIMESTAMP() WHERE id=:c AND estado='bot'`,
    { m: motivo, c: convId }, t);
}

// Usado por el asistente de IA: el mensaje del usuario y el aviso de transferencia quedan en Soporte.
async function transferirDesdeIa(usuarioId, mensaje, motivo, t) {
  const conv = await obtenerOAbrir(usuarioId, t);
  await agregarMensaje(conv.id, 'usuario', usuarioId, mensaje, t);
  if (conv.estado === 'bot') {
    await agregarMensaje(conv.id, 'bot', null, MSG_TRANSFERENCIA, t);
    await marcarTransferida(conv.id, motivo, t);
  }
  return conv.id;
}

module.exports = {
  normalizar, detectarPago, detectarHumano, respuestaBot, abiertaDe, obtenerOAbrir, agregarMensaje, marcarTransferida,
  transferirDesdeIa, MSG_TRANSFERENCIA, MSG_EN_COLA
};
