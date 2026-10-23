// Eventos del backend hacia n8n (automatizaciones). El backend avisa "paso X" a un webhook de n8n y el flujo
// decide que hacer (notificar a los admins, mandar un correo, etc.). n8n vuelve a llamar al backend por la API
// interna (/internal, ver social-service/src/internal.js), nunca toca la base de datos directamente.
//
// - Sin N8N_WEBHOOK_URL el evento no sale y se usa el `respaldo` (para que la app funcione igual sin n8n).
// - Se envia SIEMPRE despues del commit y sin bloquear al usuario: si n8n esta caido, se registra y se usa el respaldo.
// - Solo viajan ids y codigos (nunca nombres, correos ni texto de mensajes).
const { insert, select } = require('./db');

const EVENTOS = ['soporte-transferida', 'pago-aprobado'];

async function emitir(evento, datos = {}, { respaldo = null, fetchFn = fetch } = {}) {
  if (!EVENTOS.includes(evento)) throw new Error(`evento desconocido: ${evento}`);
  const base = (process.env.N8N_WEBHOOK_URL || '').replace(/\/+$/, '');
  if (base) {
    try {
      const res = await fetchFn(`${base}/${evento}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-playfit-token': process.env.N8N_TOKEN || '' },
        body: JSON.stringify({ evento, ...datos, enviado_at: new Date().toISOString() }),
        signal: AbortSignal.timeout(3000)
      });
      if (res.ok) return 'n8n';
      console.error(`[eventos] n8n respondio ${res.status} al evento ${evento}; uso el respaldo`);
    } catch (e) {
      console.error(`[eventos] no pude avisar a n8n (${evento}): ${e.message}; uso el respaldo`);
    }
  }
  if (respaldo) await respaldo();
  return 'respaldo';
}

// Notificacion para todos los admins activos (respaldo de los avisos de soporte cuando n8n no esta).
async function notificarAdmins(titulo, cuerpo, tipo = 'soporte') {
  const admins = await select("SELECT u.id FROM usuarios u JOIN roles r ON r.id=u.rol_id WHERE r.nombre='admin' AND u.activo=1");
  for (const a of admins) await insert('INSERT INTO notificaciones (usuario_id,tipo,titulo,cuerpo) VALUES (:u,:t,:ti,:c)', { u: a.id, t: tipo, ti: titulo, c: cuerpo || null });
  return admins.length;
}

const MOTIVOS = { pago: 'pagos o Premium', general: 'pidio hablar con una persona' };
// Se llama cuando una conversacion pasa del bot/IA a la bandeja de los admins.
const soporteTransferida = (conversacionId, motivo, opciones = {}) =>
  emitir('soporte-transferida', { conversacion_id: conversacionId, motivo }, {
    ...opciones,
    respaldo: () => notificarAdmins('Nueva conversacion en Soporte', `Un usuario fue transferido a un humano (${MOTIVOS[motivo] || motivo}).`)
  });

module.exports = { emitir, notificarAdmins, soporteTransferida, EVENTOS };
