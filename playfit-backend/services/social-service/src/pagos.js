// PlayFit Premium y pagos con Wompi (Fase 14, SANDBOX).
//
// 1) El admin, desde una conversacion de Soporte, envia el ENLACE DE PAGO: el backend lo crea en Wompi
//    (monto fijo que decide el servidor, un solo uso) y lo deja en el chat como una tarjeta con el boton "Pagar".
// 2) El usuario paga en el checkout de Wompi. PlayFit nunca ve datos de tarjeta, Nequi ni PSE.
// 3) Wompi avisa por WEBHOOK firmado (/api/social/payments/wompi/events). Se verifica la firma, el evento se
//    registra una sola vez (los reintentos no duplican nada) y, si el monto coincide, se activa el Premium 30 dias.
// 4) Respaldo: al volver del checkout, Wompi redirige a /api/social/payments/wompi/return?id=<transaccion>; el
//    backend consulta esa transaccion DIRECTAMENTE a Wompi y aplica el mismo proceso (sirve cuando el webhook
//    no llega, p. ej. en el PC sin una URL publica).
const { one, select, insert, run, tx, E, AppError, rbac, audit, eventos, premium: P, wompi: W, soporte: S } = require('@playfit/shared');
const H = require('./helpers');

const HORAS_VIGENCIA_ENLACE = 48;
const ESTADO_WOMPI = { APPROVED: 'aprobado', DECLINED: 'rechazado', VOIDED: 'anulado', ERROR: 'error', PENDING: 'pendiente' };
const montoCentavos = () => P.PREMIUM.PRECIO_COP * 100;
const formatoCop = (centavos) => `$${Math.round(centavos / 100).toLocaleString('es-CO')}`;

let cliente = null; // se puede reemplazar en las pruebas
const wompi = () => cliente || W.crearCliente();
const usarClienteWompi = (c) => { cliente = c; };

// Lo que ve la app de un pago (el usuario solo ve el enlace mientras esta pendiente)
function pagoPublico(p, { admin = false } = {}) {
  if (!p) return null;
  return {
    id: p.id, estado: p.estado, monto_cop: Math.round(p.monto_centavos / 100), dias: p.dias, ambiente: p.ambiente,
    checkout_url: p.estado === 'pendiente' ? p.checkout_url : null,
    created_at: p.created_at, pagado_at: p.pagado_at, metodo: p.metodo,
    ...(admin ? { transaccion_id: p.transaccion_id, nota: p.nota, usuario_id: p.usuario_id } : {})
  };
}

// ---------------------------------------------------------------- usuario
async function miPremium(actor) {
  rbac.requirePermiso(actor, 'soporte:usar');
  const est = await P.estado(actor.id);
  const pagos = await select('SELECT * FROM pagos WHERE usuario_id=:u ORDER BY id DESC LIMIT 5', { u: actor.id });
  return {
    ...est, precio_cop: P.PREMIUM.PRECIO_COP, dias_por_pago: P.PREMIUM.DIAS, beneficios: P.BENEFICIOS,
    ambiente: W.ambiente(), pagos: pagos.map((p) => pagoPublico(p))
  };
}

// ---------------------------------------------------------------- admin: enlace desde Soporte
async function enviarEnlacePago(actor, conversacionId, { ip } = {}) {
  rbac.requirePermiso(actor, 'soporte:atender');
  rbac.requirePermiso(actor, 'pagos:gestionar');
  const c = await one('SELECT * FROM soporte_conversaciones WHERE id=:id', { id: conversacionId });
  if (!c || !c.transferida_at) throw E.notFound('Conversacion no encontrada');
  if (c.estado === 'cerrada') throw E.conflict('La conversacion esta cerrada', 'CONVERSACION_CERRADA');
  const u = await one("SELECT u.id FROM usuarios u JOIN roles r ON r.id=u.rol_id WHERE u.id=:id AND r.nombre='estudiante' AND u.activo=1", { id: c.usuario_id });
  if (!u) throw E.badRequest('Este usuario no puede comprar el Premium', 'USUARIO_NO_VALIDO');

  // Si ya tiene un enlace vigente sin pagar, se reenvia el mismo (no se crean cobros duplicados).
  let pago = await one(
    `SELECT * FROM pagos WHERE usuario_id=:u AND estado='pendiente' AND link_id IS NOT NULL AND expira_at > UTC_TIMESTAMP()
     ORDER BY id DESC LIMIT 1`, { u: u.id });
  if (!pago) {
    if (!W.configurado()) throw new AppError(503, 'PAGOS_NO_CONFIGURADOS', 'Los pagos no estan configurados en el servidor (faltan las claves de Wompi).');
    const pagoId = await insert(
      `INSERT INTO pagos (usuario_id,ambiente,dias,monto_centavos,conversacion_id,creado_por,expira_at)
       VALUES (:u,:amb,:d,:m,:c,:a,DATE_ADD(UTC_TIMESTAMP(), INTERVAL :h HOUR))`,
      { u: u.id, amb: W.ambiente(), d: P.PREMIUM.DIAS, m: montoCentavos(), c: c.id, a: actor.id, h: HORAS_VIGENCIA_ENLACE });
    let enlace;
    try {
      enlace = await wompi().crearEnlace({
        nombre: 'PlayFit Premium (30 dias)',
        descripcion: `Suscripcion PlayFit Premium por ${P.PREMIUM.DIAS} dias. Pago de prueba en sandbox.`,
        montoCentavos: montoCentavos(), redirectUrl: process.env.WOMPI_REDIRECT_URL || null, sku: `PF-${pagoId}`
      });
    } catch (e) {
      await run("UPDATE pagos SET estado='error', nota=:n, actualizado_at=UTC_TIMESTAMP() WHERE id=:id", { n: String(e.message).slice(0, 255), id: pagoId });
      console.error(`[pagos] no pude crear el enlace en Wompi: ${e.message}`);
      throw new AppError(502, 'WOMPI_ERROR', 'No se pudo crear el enlace de pago en Wompi. Intenta de nuevo en un momento.');
    }
    await run('UPDATE pagos SET link_id=:l, checkout_url=:url WHERE id=:id', { l: enlace.id, url: enlace.url, id: pagoId });
    pago = await one('SELECT * FROM pagos WHERE id=:id', { id: pagoId });
  }

  await tx(async (t) => {
    const texto = `Te envie el enlace para pagar PlayFit Premium: ${formatoCop(pago.monto_centavos)} COP por ${pago.dias} dias. `
      + 'Pagas en Wompi (tarjeta, Nequi o PSE); PlayFit nunca ve los datos de tu pago. '
      + (pago.ambiente === 'sandbox' ? 'Es un pago de PRUEBA (sandbox): no se cobra dinero real.' : '');
    await insert('INSERT INTO soporte_mensajes (conversacion_id,autor,autor_id,contenido,pago_id) VALUES (:c,\'admin\',:a,:m,:p)',
      { c: c.id, a: actor.id, m: texto.trim(), p: pago.id }, t);
    await run(`UPDATE soporte_conversaciones SET estado='atendiendo', asignado_a=COALESCE(asignado_a,:a), no_leidos_admin=0,
               ultimo_mensaje_at=UTC_TIMESTAMP(), no_leidos_usuario=LEAST(no_leidos_usuario+1,999) WHERE id=:id`, { a: actor.id, id: c.id }, t);
    await H.notificar(c.usuario_id, 'pago', 'Tu enlace de pago esta listo', 'Abre Ayuda y soporte para pagar el Premium.', t);
    await audit.registrar(actor, 'crear', 'pago', pago.id, { ip, t });
  });
  return pagoPublico(pago, { admin: true });
}

// ---------------------------------------------------------------- aplicar una transaccion de Wompi
// Comun al webhook y al retorno del checkout. Idempotente: un pago aprobado no se vuelve a aplicar.
async function aplicarTransaccion(trx, origen) {
  if (!trx || typeof trx !== 'object' || !trx.id) return { resultado: 'sin_transaccion' };
  const linkId = trx.payment_link_id ? String(trx.payment_link_id) : null;
  const base = linkId
    ? await one('SELECT id FROM pagos WHERE link_id=:l', { l: linkId })
    : await one('SELECT id FROM pagos WHERE transaccion_id=:t', { t: String(trx.id) });
  if (!base) {
    console.warn(`[pagos] transaccion ${trx.id} (${origen}) no corresponde a ningun enlace de PlayFit; se ignora`);
    return { resultado: 'desconocido' };
  }
  const nuevo = ESTADO_WOMPI[trx.status] || 'pendiente';
  const r = await tx(async (t) => {
    const p = await one('SELECT * FROM pagos WHERE id=:id FOR UPDATE', { id: base.id }, t);
    if (p.estado === 'aprobado') return { resultado: 'ya_aplicado', pago: p };
    if (nuevo === 'aprobado' && (Number(trx.amount_in_cents) !== Number(p.monto_centavos) || (trx.currency || 'COP') !== p.moneda)) {
      await run("UPDATE pagos SET estado='error', transaccion_id=:tx, nota='El monto pagado no coincide con el del enlace', actualizado_at=UTC_TIMESTAMP() WHERE id=:id",
        { tx: String(trx.id), id: p.id }, t);
      return { resultado: 'monto_no_coincide', pago: p };
    }
    // (Sequelize no reemplaza parametros dentro de IF(:x...): la fecha de pago se elige aqui, con texto fijo)
    await run(`UPDATE pagos SET estado=:e, transaccion_id=:tx, metodo=:m, actualizado_at=UTC_TIMESTAMP(),
               pagado_at=${nuevo === 'aprobado' ? 'UTC_TIMESTAMP()' : 'pagado_at'} WHERE id=:id`,
      { e: nuevo, tx: String(trx.id), m: trx.payment_method_type ? String(trx.payment_method_type).slice(0, 30) : null, id: p.id }, t);
    if (nuevo === 'aprobado') {
      const hasta = await P.extender(p.usuario_id, p.dias, 'pago', { pagoId: p.id }, t);
      const fecha = hasta.slice(0, 10);
      await H.notificar(p.usuario_id, 'pago', 'Ya eres PlayFit Premium', `Tu pago fue aprobado. Premium activo hasta el ${fecha}.`, t);
      if (p.conversacion_id) await S.agregarMensaje(p.conversacion_id, 'bot', null, `Pago aprobado. Tu Premium esta activo hasta el ${fecha}. ¡Gracias!`, t);
    } else if (nuevo === 'rechazado' || nuevo === 'error') {
      await H.notificar(p.usuario_id, 'pago', 'Tu pago no fue aprobado', 'Puedes intentarlo otra vez con el mismo enlace o escribirle a Soporte.', t);
      if (p.conversacion_id) await S.agregarMensaje(p.conversacion_id, 'bot', null, 'El pago no fue aprobado. Puedes intentarlo de nuevo con el mismo enlace.', t);
    }
    return { resultado: nuevo, pago: p };
  });
  if (r.resultado === 'aprobado') await eventos.pagoAprobado(r.pago.id, r.pago.usuario_id); // aviso a admins (n8n o respaldo)
  if (r.resultado === 'monto_no_coincide') {
    await eventos.notificarAdmins('Pago con monto distinto', `El pago #${r.pago.id} llego con un monto que no coincide; revisalo en Wompi.`, 'pago');
  }
  return { resultado: r.resultado, pago_id: r.pago.id };
}

// ---------------------------------------------------------------- webhook de Wompi
// Responde 200 a todo evento con firma valida (aunque no aplique) para que Wompi no lo reintente.
async function recibirEvento(evento) {
  if (!process.env.WOMPI_EVENTS_SECRET) return { status: 503, body: { error: { code: 'PAGOS_NO_CONFIGURADOS', message: 'Falta WOMPI_EVENTS_SECRET' } } };
  if (!W.firmaValida(evento)) {
    console.warn('[pagos] evento de Wompi con firma invalida: ignorado');
    return { status: 401, body: { error: { code: 'FIRMA_INVALIDA', message: 'Firma invalida' } } };
  }
  if (evento.environment && evento.environment !== W.ambienteEvento()) return { status: 200, body: { ok: true, resultado: 'otro_ambiente' } };
  const trx = evento.data && evento.data.transaction;
  const checksum = String(evento.signature.checksum).toLowerCase();
  try {
    await insert('INSERT INTO wompi_eventos (checksum,evento,transaccion_id,estado) VALUES (:c,:e,:t,:s)',
      { c: checksum, e: String(evento.event || '').slice(0, 40), t: trx && trx.id ? String(trx.id).slice(0, 60) : null, s: trx && trx.status ? String(trx.status).slice(0, 20) : null });
  } catch (e) {
    const code = e && ((e.parent && e.parent.code) || e.code);
    if (code === 'ER_DUP_ENTRY') return { status: 200, body: { ok: true, resultado: 'repetido' } };
    throw e;
  }
  if (evento.event !== 'transaction.updated') return { status: 200, body: { ok: true, resultado: 'ignorado' } };
  const r = await aplicarTransaccion(trx, 'webhook');
  await run('UPDATE wompi_eventos SET resultado=:r WHERE checksum=:c', { r: r.resultado, c: checksum });
  return { status: 200, body: { ok: true, resultado: r.resultado } };
}

// ---------------------------------------------------------------- retorno del checkout
async function retornoCheckout(transaccionId) {
  if (typeof transaccionId !== 'string' || !/^[\w-]{4,60}$/.test(transaccionId)) return { resultado: 'sin_transaccion' };
  let trx;
  try { trx = await wompi().consultarTransaccion(transaccionId); }
  catch (e) {
    console.error(`[pagos] no pude consultar la transaccion ${transaccionId}: ${e.message}`);
    return { resultado: 'no_verificado' };
  }
  return aplicarTransaccion(trx, 'retorno');
}

const MENSAJES_RETORNO = {
  aprobado: ['¡Pago aprobado!', 'Ya eres PlayFit Premium. Vuelve a la app para disfrutarlo.'],
  ya_aplicado: ['¡Pago aprobado!', 'Tu Premium ya esta activo. Vuelve a la app.'],
  pendiente: ['Pago en proceso', 'Wompi todavia esta confirmando tu pago. Te avisaremos en la app cuando quede listo.'],
  rechazado: ['Pago no aprobado', 'Puedes intentarlo otra vez con el mismo enlace desde Ayuda y soporte.'],
  anulado: ['Pago anulado', 'Si fue un error, escribe a Soporte desde la app.'],
  error: ['No pudimos confirmar el pago', 'Escribe a Soporte desde la app y lo revisamos.'],
  monto_no_coincide: ['No pudimos confirmar el pago', 'Escribe a Soporte desde la app y lo revisamos.']
};
function paginaRetorno(resultado) {
  const [titulo, texto] = MENSAJES_RETORNO[resultado] || ['Gracias', 'Si ya pagaste, en unos minutos veras el Premium activo en la app.'];
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>PlayFit · ${titulo}</title></head>
<body style="font-family:system-ui,sans-serif;background:#FBF7EE;color:#1F1B16;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px">
<main style="max-width:420px;text-align:center;background:#fff;border:1px solid #E7DFD0;border-radius:18px;padding:28px">
<h1 style="font-size:22px;margin:0 0 10px">${titulo}</h1><p style="font-size:15px;line-height:1.5;margin:0 0 14px">${texto}</p>
<p style="font-size:12px;color:#7A7166;margin:0">Ya puedes cerrar esta pagina.</p></main></body></html>`;
}

// ---------------------------------------------------------------- admin: pagos y Premium de cortesia
async function listarPagosAdmin(actor) {
  rbac.requirePermiso(actor, 'pagos:gestionar');
  const filas = await select(
    `SELECT p.*, u.nombre, u.apellido, u.email FROM pagos p JOIN usuarios u ON u.id=p.usuario_id ORDER BY p.id DESC LIMIT 100`);
  const premium = await one('SELECT COUNT(*) AS n FROM usuarios WHERE premium_hasta > UTC_TIMESTAMP()');
  return {
    premium_activos: Number(premium.n), ambiente: W.ambiente(), configurado: W.configurado(),
    pagos: filas.map((f) => ({ ...pagoPublico(f, { admin: true }), usuario: { id: f.usuario_id, nombre: f.nombre, apellido: f.apellido, email: f.email } }))
  };
}

async function usuarioEstudiante(id, t) {
  const u = await one("SELECT u.id FROM usuarios u JOIN roles r ON r.id=u.rol_id WHERE u.id=:id AND r.nombre='estudiante'", { id }, t);
  if (!u) throw E.notFound('Usuario no encontrado');
  return u;
}

async function darCortesia(actor, usuarioId, { dias, nota } = {}, { ip } = {}) {
  rbac.requirePermiso(actor, 'pagos:gestionar');
  const d = Number(dias);
  if (!Number.isInteger(d) || d < 1 || d > P.PREMIUM.MAX_CORTESIA_DIAS) throw E.badRequest(`dias debe ser un entero entre 1 y ${P.PREMIUM.MAX_CORTESIA_DIAS}`);
  if (nota !== undefined && nota !== null && (typeof nota !== 'string' || nota.length > 255)) throw E.badRequest('nota: maximo 255 caracteres');
  return tx(async (t) => {
    await usuarioEstudiante(usuarioId, t);
    const hasta = await P.extender(usuarioId, d, 'cortesia', { adminId: actor.id, nota: nota ? nota.trim() : null }, t);
    await H.notificar(usuarioId, 'pago', 'Te regalaron PlayFit Premium', `Tienes Premium hasta el ${hasta.slice(0, 10)}.`, t);
    await audit.registrar(actor, 'actualizar', 'premium', usuarioId, { ip, t });
    return { usuario_id: usuarioId, premium: true, premium_hasta: hasta };
  });
}

async function revocarPremium(actor, usuarioId, { nota } = {}, { ip } = {}) {
  rbac.requirePermiso(actor, 'pagos:gestionar');
  await tx(async (t) => {
    await usuarioEstudiante(usuarioId, t);
    await P.revocar(usuarioId, actor.id, typeof nota === 'string' ? nota.slice(0, 255) : null, t);
    await audit.registrar(actor, 'eliminar', 'premium', usuarioId, { ip, t });
  });
}

module.exports = {
  miPremium, enviarEnlacePago, aplicarTransaccion, recibirEvento, retornoCheckout, paginaRetorno,
  listarPagosAdmin, darCortesia, revocarPremium, pagoPublico, usarClienteWompi, HORAS_VIGENCIA_ENLACE
};
