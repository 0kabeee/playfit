// Fase 14: PlayFit Premium y pagos con Wompi (sandbox). Wompi se reemplaza por un cliente falso: nunca se llama a la red.
const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const S = require('./_setup');
const H = require('./_http');
const soc = require('@playfit/social-service');
const auth = require('@playfit/auth-service');
const adminSvc = require('@playfit/auth-service/src/admin');
const { ia } = require('@playfit/content-service');
const { one, select, sequelize, wompi, premium } = require('@playfit/shared');
const { sentencias } = require('@playfit/shared/src/migrate');

const pagos = soc.pagos;
const SECRETO = 'test_events_secreto_de_pruebas';
const MONTO = 9900 * 100;

// Cliente de Wompi falso: guarda lo que se le pide y responde lo que diga la prueba
function wompiFalso({ falla = false, transaccion = null } = {}) {
  const f = {
    enlaces: [], consultas: [],
    async crearEnlace(x) {
      f.enlaces.push(x);
      if (falla) throw new Error('Wompi respondio 422');
      return { id: `LNK${f.enlaces.length}`, url: `https://checkout.wompi.co/l/LNK${f.enlaces.length}` };
    },
    async consultarTransaccion(id) {
      f.consultas.push(id);
      if (!transaccion) throw new Error('no existe');
      return { ...transaccion, id };
    }
  };
  return f;
}
function evento(trx, { secreto = SECRETO, ts = 1730000000, env = 'test', tipo = 'transaction.updated' } = {}) {
  const ev = {
    event: tipo, data: { transaction: trx }, environment: env,
    signature: { properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'] },
    timestamp: ts, sent_at: new Date(ts * 1000).toISOString()
  };
  ev.signature.checksum = wompi.checksumEvento(ev, secreto).toUpperCase(); // Wompi lo manda en mayusculas
  return ev;
}
const trx = (linkId, status = 'APPROVED', extra = {}) => ({
  id: `TX-${linkId}-${status}`, status, amount_in_cents: MONTO, currency: 'COP', payment_link_id: linkId, payment_method_type: 'CARD', reference: 'r1', ...extra
});

beforeEach(async () => {
  await S.preparar();
  process.env.WOMPI_PRIVATE_KEY = 'prv_test_pruebas';
  process.env.WOMPI_EVENTS_SECRET = SECRETO;
  delete process.env.WOMPI_ENV;
  delete process.env.N8N_WEBHOOK_URL;
  pagos.usarClienteWompi(wompiFalso());
});
after(S.cerrar);
const rechaza = (p, code) => assert.rejects(p, (e) => { assert.equal(e.code, code, `esperaba ${code}, llego ${e.code}: ${e.message}`); return true; });
const contar = async (sql, r = {}) => Number((await one(sql, r)).n);
const notifs = (id, tipo = 'pago') => contar('SELECT COUNT(*) AS n FROM notificaciones WHERE usuario_id=:u AND tipo=:t', { u: id, t: tipo });
const darConsentimientoIA = (id) => sequelize.query("INSERT INTO consentimientos (usuario_id,tipo,aceptado) VALUES (:id,'ia_chatbot',1)", { replacements: { id } });

// Ana pide el Premium en Soporte -> la conversacion pasa al admin
async function conversacionDePago(actor = S.ANA) {
  const r = await soc.enviarMensajeUsuario(actor, 'Hola, quiero pagar el Premium');
  assert.equal(r.transferida, true);
  return r.conversacion.id;
}

// ---------------------------------------------------------------- migracion y firma
test('migracion 07: se parsea, deja tablas/columnas nuevas y es idempotente', async () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'database', '07_fase14.sql'), 'utf8');
  assert.ok(sentencias(sql).length >= 5);
  for (const t of ['pagos', 'premium_movimientos', 'wompi_eventos']) {
    assert.equal(await contar('SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=:t', { t }), 1, `falta ${t}`);
  }
  const col = async (tabla, c) => contar('SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=:t AND column_name=:c', { t: tabla, c });
  assert.equal(await col('usuarios', 'premium_hasta'), 1);
  assert.equal(await col('soporte_mensajes', 'pago_id'), 1);
  for (const s of sentencias(sql)) await sequelize.query(s);
});

test('wompi: la firma se calcula como dice la documentacion y se rechaza cualquier cambio', () => {
  // ejemplo de la documentacion de Wompi: propiedades en orden + timestamp + secreto
  const ev = {
    data: { transaction: { id: '1234-1610641025-49201', status: 'APPROVED', amount_in_cents: 4490000 } },
    signature: { properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'] }, timestamp: 1530291411
  };
  const esperado = crypto.createHash('sha256').update('1234-1610641025-49201APPROVED44900001530291411' + 'mi_secreto').digest('hex');
  assert.equal(wompi.checksumEvento(ev, 'mi_secreto'), esperado);

  const bueno = evento(trx('L1'));
  assert.equal(wompi.firmaValida(bueno, SECRETO), true);
  assert.equal(wompi.firmaValida(bueno, 'otro_secreto'), false);
  const cambiado = JSON.parse(JSON.stringify(bueno)); cambiado.data.transaction.status = 'APPROVED'; cambiado.data.transaction.amount_in_cents = 100;
  assert.equal(wompi.firmaValida(cambiado, SECRETO), false, 'cambiar el monto invalida la firma');
  const otroTs = { ...bueno, timestamp: bueno.timestamp + 1 };
  assert.equal(wompi.firmaValida(otroTs, SECRETO), false);
  for (const malo of [null, {}, { ...bueno, signature: null }, { ...bueno, signature: { ...bueno.signature, checksum: 'abc' } }]) {
    assert.equal(wompi.firmaValida(malo, SECRETO), false);
  }
  assert.equal(wompi.urlCheckout('3Z0Cfi'), 'https://checkout.wompi.co/l/3Z0Cfi');
});

// ---------------------------------------------------------------- flujo completo
test('flujo: el admin envia el enlace desde Soporte, Wompi confirma por webhook y se activa el Premium 30 dias', async () => {
  const falso = wompiFalso(); pagos.usarClienteWompi(falso);
  const convId = await conversacionDePago();
  assert.equal((await premium.estado(3)).premium, false);

  const p = await pagos.enviarEnlacePago(S.ADMIN, convId);
  assert.equal(p.estado, 'pendiente'); assert.equal(p.monto_cop, 9900); assert.equal(p.dias, 30);
  assert.equal(falso.enlaces.length, 1);
  assert.equal(falso.enlaces[0].montoCentavos, MONTO, 'el monto lo fija el servidor');
  assert.equal(await notifs(3), 1);

  // el usuario ve la tarjeta con el boton de pago en su chat
  const vista = await soc.miSoporte(S.ANA);
  const conEnlace = vista.conversacion.mensajes.find((m) => m.pago);
  assert.equal(conEnlace.autor, 'admin');
  assert.equal(conEnlace.pago.checkout_url, 'https://checkout.wompi.co/l/LNK1');
  assert.match(conEnlace.contenido, /PRUEBA \(sandbox\)/);

  // reenviar no crea otro cobro: se reutiliza el enlace vigente
  const p2 = await pagos.enviarEnlacePago(S.ADMIN, convId);
  assert.equal(p2.id, p.id); assert.equal(falso.enlaces.length, 1);

  // webhook aprobado
  const ev = evento(trx('LNK1'));
  const r = await pagos.recibirEvento(ev);
  assert.equal(r.status, 200); assert.equal(r.body.resultado, 'aprobado');
  const est = await premium.estado(3);
  assert.equal(est.premium, true);
  assert.ok(est.dias_restantes >= 29 && est.dias_restantes <= 30, `dias: ${est.dias_restantes}`);
  const pago = await one('SELECT * FROM pagos WHERE id=:id', { id: p.id });
  assert.equal(pago.estado, 'aprobado'); assert.equal(pago.metodo, 'CARD'); assert.ok(pago.pagado_at);
  assert.equal(await notifs(1), 1, 'los admins reciben el aviso (respaldo sin n8n)');
  assert.ok((await soc.miSoporte(S.ANA)).conversacion.mensajes.some((m) => m.autor === 'bot' && /Pago aprobado/.test(m.contenido)));
  assert.equal((await soc.miSoporte(S.ANA)).conversacion.mensajes.find((m) => m.pago).pago.checkout_url, null, 'pagado: ya no se muestra el enlace');

  // el mismo evento repetido y un reintento con otro timestamp no extienden dos veces
  assert.equal((await pagos.recibirEvento(ev)).body.resultado, 'repetido');
  assert.equal((await pagos.recibirEvento(evento(trx('LNK1'), { ts: 1730000999 }))).body.resultado, 'ya_aplicado');
  assert.equal(await contar("SELECT COUNT(*) AS n FROM premium_movimientos WHERE usuario_id=3 AND motivo='pago'"), 1);
  assert.equal((await premium.estado(3)).dias_restantes, est.dias_restantes);

  // la app lo ve en el perfil y en la pantalla Premium
  const yo = await auth.perfil(S.ANA);
  assert.equal(yo.premium, true); assert.ok(yo.premium_hasta);
  const mio = await pagos.miPremium(S.ANA);
  assert.equal(mio.premium, true); assert.equal(mio.precio_cop, 9900); assert.equal(mio.pagos[0].estado, 'aprobado');
  assert.equal((await adminSvc.metricas(S.ADMIN)).premium_activos, 1);
});

test('webhook: firma invalida (401), otro ambiente, monto distinto y rechazo seguido de aprobacion', async () => {
  const convId = await conversacionDePago();
  await pagos.enviarEnlacePago(S.ADMIN, convId);

  const falsa = evento(trx('LNK1'), { secreto: 'secreto_de_un_atacante' });
  assert.equal((await pagos.recibirEvento(falsa)).status, 401);
  assert.equal((await premium.estado(3)).premium, false);
  assert.equal(await contar('SELECT COUNT(*) AS n FROM wompi_eventos'), 0, 'un evento falso ni se registra');

  assert.equal((await pagos.recibirEvento(evento(trx('LNK1'), { env: 'prod' }))).body.resultado, 'otro_ambiente');
  assert.equal((await premium.estado(3)).premium, false);

  // rechazado: se avisa y se puede reintentar con el mismo enlace
  assert.equal((await pagos.recibirEvento(evento(trx('LNK1', 'DECLINED')))).body.resultado, 'rechazado');
  assert.equal((await one("SELECT estado FROM pagos WHERE link_id='LNK1'")).estado, 'rechazado');
  assert.equal(await notifs(3), 2); // enlace listo + no aprobado
  assert.equal((await pagos.recibirEvento(evento(trx('LNK1', 'APPROVED'), { ts: 1730000500 }))).body.resultado, 'aprobado');
  assert.equal((await premium.estado(3)).premium, true);

  // otro usuario paga un monto distinto al del enlace: no se activa nada
  const conv2 = await conversacionDePago(S.LUIS);
  await pagos.enviarEnlacePago(S.ADMIN, conv2);
  const r = await pagos.recibirEvento(evento(trx('LNK2', 'APPROVED', { amount_in_cents: 100 })));
  assert.equal(r.body.resultado, 'monto_no_coincide');
  assert.equal((await premium.estado(4)).premium, false);
  assert.equal((await one("SELECT estado FROM pagos WHERE link_id='LNK2'")).estado, 'error');

  // una transaccion que no es de PlayFit se ignora sin error
  assert.equal((await pagos.recibirEvento(evento(trx('NO-ES-NUESTRO')))).body.resultado, 'desconocido');
  // eventos de otro tipo se registran pero no se aplican
  assert.equal((await pagos.recibirEvento(evento(trx('LNK2'), { tipo: 'nequi_token.updated', ts: 1 }))).body.resultado, 'ignorado');
  // sin secreto configurado el webhook no acepta nada
  delete process.env.WOMPI_EVENTS_SECRET;
  assert.equal((await pagos.recibirEvento(evento(trx('LNK2')))).status, 503);
});

test('retorno del checkout: consulta la transaccion a Wompi y aplica el mismo proceso', async () => {
  const convId = await conversacionDePago();
  await pagos.enviarEnlacePago(S.ADMIN, convId);
  const falso = wompiFalso({ transaccion: trx('LNK1') });
  pagos.usarClienteWompi(falso);
  const r = await pagos.retornoCheckout('11111-1730000000-12345');
  assert.equal(r.resultado, 'aprobado');
  assert.deepEqual(falso.consultas, ['11111-1730000000-12345']);
  assert.equal((await premium.estado(3)).premium, true);
  assert.match(pagos.paginaRetorno(r.resultado), /Pago aprobado/);
  assert.equal((await pagos.retornoCheckout('<script>')).resultado, 'sin_transaccion');
  assert.equal(falso.consultas.length, 1, 'un id raro ni se consulta');
  pagos.usarClienteWompi(wompiFalso()); // consultar falla
  assert.equal((await pagos.retornoCheckout('99999-1-1')).resultado, 'no_verificado');
});

test('enlace: sin claves de Wompi o si Wompi falla se avisa claro; solo el admin lo envia', async () => {
  const convId = await conversacionDePago();
  await rechaza(pagos.enviarEnlacePago(S.ANA, convId), 'PROHIBIDO');
  await rechaza(pagos.enviarEnlacePago(S.ADMIN, 99999), 'NO_ENCONTRADO');

  delete process.env.WOMPI_PRIVATE_KEY;
  await rechaza(pagos.enviarEnlacePago(S.ADMIN, convId), 'PAGOS_NO_CONFIGURADOS');
  process.env.WOMPI_PRIVATE_KEY = 'prv_test_pruebas';

  pagos.usarClienteWompi(wompiFalso({ falla: true }));
  await rechaza(pagos.enviarEnlacePago(S.ADMIN, convId), 'WOMPI_ERROR');
  assert.equal((await one('SELECT estado FROM pagos ORDER BY id DESC LIMIT 1')).estado, 'error');
  assert.equal(await contar('SELECT COUNT(*) AS n FROM soporte_mensajes WHERE pago_id IS NOT NULL'), 0, 'no se manda un enlace roto');

  // una conversacion cerrada no admite enlaces
  pagos.usarClienteWompi(wompiFalso());
  await soc.cerrarAdmin(S.ADMIN, convId);
  await rechaza(pagos.enviarEnlacePago(S.ADMIN, convId), 'CONVERSACION_CERRADA');
  await rechaza(pagos.listarPagosAdmin(S.ANA), 'PROHIBIDO');
  const lista = await pagos.listarPagosAdmin(S.ADMIN);
  assert.equal(lista.configurado, true); assert.equal(lista.ambiente, 'sandbox');
});

test('admin: Premium de cortesia (suma dias) y revocar; queda en el historial y la auditoria', async () => {
  await rechaza(pagos.darCortesia(S.ANA, 4, { dias: 10 }), 'PROHIBIDO');
  for (const dias of [0, 91, 2.5, 'x']) await rechaza(pagos.darCortesia(S.ADMIN, 4, { dias }), 'DATOS_INVALIDOS');
  await rechaza(pagos.darCortesia(S.ADMIN, 1, { dias: 10 }), 'NO_ENCONTRADO'); // a un admin no

  await pagos.darCortesia(S.ADMIN, 4, { dias: 10, nota: 'piloto USB' });
  const d1 = (await premium.estado(4)).dias_restantes;
  await pagos.darCortesia(S.ADMIN, 4, { dias: 5 });
  assert.equal((await premium.estado(4)).dias_restantes, d1 + 5, 'se suma desde el vencimiento');
  assert.equal(await notifs(4), 2);
  assert.equal(await contar("SELECT COUNT(*) AS n FROM premium_movimientos WHERE usuario_id=4 AND motivo='cortesia'"), 2);
  assert.ok(await contar("SELECT COUNT(*) AS n FROM auditoria_accesos WHERE recurso='premium' AND recurso_id=4") >= 2);

  await pagos.revocarPremium(S.ADMIN, 4, { nota: 'prueba' });
  assert.equal((await premium.estado(4)).premium, false);
  assert.equal((await auth.perfil(S.LUIS)).premium, false);
  const usuarios = await auth.listarUsuarios(S.ADMIN);
  assert.equal(Number(usuarios.find((u) => u.id === 4).premium), 0);
});

// ---------------------------------------------------------------- lo que cambia con Premium en el asistente
test('asistente: memoria y funciones iguales con o sin Premium; Premium solo suma cupo diario', async () => {
  process.env.IA_LIMITE_PREMIUM = '6';
  await darConsentimientoIA(8);
  await sequelize.query("INSERT INTO ia_memoria (estudiante_id,clave,valor) VALUES (8,'objetivo','fuerza')");
  const recibido = [];
  const llm = {
    async generate(x) {
      recibido.push(x);
      x.ultimo = await x.ejecutarFuncion('guardar_preferencia', { clave: 'horario', valor: 'noche' });
      return 'Te ayudo con tu rutina.';
    }
  };
  // plan gratis: el asistente recuerda y puede guardar preferencias (Premium no le quita nada al gratis)
  const r1 = await ia.chat(S.SEBAS, { mensaje: 'armame una rutina' }, { llm });
  assert.equal(r1.premium, false);
  assert.ok(recibido[0].tools.some((f) => f.name === 'guardar_preferencia'));
  assert.match(recibido[0].system, /Objetivo: fuerza/);
  assert.equal(recibido[0].ultimo.ok, true);
  assert.deepEqual(r1.memoria_actualizada.map((m) => m.clave), ['horario']);

  // con Premium: lo mismo, y mas mensajes al dia
  await pagos.darCortesia(S.ADMIN, 8, { dias: 30 });
  const r2 = await ia.chat(S.SEBAS, { conversacionId: r1.conversacion_id, mensaje: 'y para manana?' }, { llm });
  assert.equal(r2.premium, true);
  assert.deepEqual(recibido[1].tools.map((f) => f.name), recibido[0].tools.map((f) => f.name));
  assert.equal(r2.restantes_hoy, r1.restantes_hoy - 1 + 3, 'el cupo Premium (6) es mayor que el gratis (3)');
  delete process.env.IA_LIMITE_PREMIUM;
});

// ---------------------------------------------------------------- HTTP
test('HTTP: el webhook entra sin token por el gateway (con firma), el retorno muestra una pagina y /premium exige sesion', async () => {
  const srv = await H.levantar();
  try {
    const gw = H.api(srv.base);
    const login = await gw('POST', '/api/auth/login', { body: { email: 'ana@playfit.test', password: 'PlayFit123!' } });
    const token = login.body.accessToken;
    assert.equal(login.body.usuario.premium, false);

    assert.equal((await gw('GET', '/api/social/premium')).status, 401);
    const mio = await gw('GET', '/api/social/premium', { token });
    assert.equal(mio.status, 200); assert.equal(mio.body.premium, false); assert.equal(mio.body.beneficios.length, 3);

    const conv = await gw('POST', '/api/social/support/messages', { token, body: { mensaje: 'quiero el premium' } });
    const admin = (await gw('POST', '/api/auth/login', { body: { email: 'admin@playfit.test', password: 'PlayFit123!' } })).body.accessToken;
    assert.equal((await gw('POST', `/api/social/admin/support/${conv.body.conversacion.id}/payment-link`, { token })).status, 403);
    const env = await gw('POST', `/api/social/admin/support/${conv.body.conversacion.id}/payment-link`, { token: admin });
    assert.equal(env.status, 201, env.text);

    assert.equal((await gw('POST', '/api/social/payments/wompi/events', { body: evento(trx('LNK1'), { secreto: 'malo' }) })).status, 401);
    const ok = await gw('POST', '/api/social/payments/wompi/events', { body: evento(trx('LNK1')) });
    assert.equal(ok.status, 200); assert.equal(ok.body.resultado, 'aprobado');
    assert.equal((await gw('GET', '/api/auth/me', { token })).body.premium, true);

    const pagina = await gw('GET', '/api/social/payments/wompi/return?id=<x>');
    assert.equal(pagina.status, 200);
    assert.match(pagina.headers.get('content-type'), /text\/html/);
    assert.match(pagina.text, /PlayFit/);
    const lista = await gw('GET', '/api/social/admin/payments', { token: admin });
    assert.equal(lista.status, 200); assert.equal(lista.body.pagos[0].estado, 'aprobado');
    assert.equal((await gw('GET', '/api/social/admin/payments', { token })).status, 403);
  } finally {
    await srv.cerrar();
  }
});
