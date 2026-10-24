// Fase 13: agente de IA con funciones y memoria, notificaciones push (FCM) y API interna / eventos para n8n.
const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const S = require('./_setup');
const H = require('./_http');
const soc = require('@playfit/social-service');
const auth = require('@playfit/auth-service');
const { ia } = require('@playfit/content-service');
const agente = require('@playfit/content-service/src/agente');
const internal = require('@playfit/social-service/src/internal');
const { one, select, sequelize, push, eventos } = require('@playfit/shared');
const { sentencias } = require('@playfit/shared/src/migrate');

beforeEach(async () => { await S.preparar(); delete process.env.N8N_WEBHOOK_URL; delete process.env.N8N_TOKEN; });
after(S.cerrar);
const rechaza = (p, code) => assert.rejects(p, (e) => { assert.equal(e.code, code, `esperaba ${code}, llego ${e.code}: ${e.message}`); return true; });
const darConsentimientoIA = (id) => sequelize.query("INSERT INTO consentimientos (usuario_id,tipo,aceptado) VALUES (:id,'ia_chatbot',1)", { replacements: { id } });
const contar = async (sql, r = {}) => Number((await one(sql, r)).n);
const notifs = (id, tipo) => contar('SELECT COUNT(*) AS n FROM notificaciones WHERE usuario_id=:u AND tipo=:t', { u: id, t: tipo });

// Modelo falso que, antes de responder, llama las funciones indicadas (como lo haria Gemini)
function llmQueLlama(...llamadas) {
  const resultados = [], recibido = [];
  return {
    resultados, recibido,
    async generate(x) {
      recibido.push(x);
      for (const [nombre, args] of llamadas) resultados.push(await x.ejecutarFuncion(nombre, args));
      return 'Listo, revisa la tarjeta y confirma.';
    }
  };
}

// ---------------------------------------------------------------- migracion
test('migracion 06: se parsea y deja las tablas y columnas nuevas', async () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'database', '06_fase13.sql'), 'utf8');
  assert.ok(sentencias(sql).length >= 7);
  for (const tabla of ['dispositivos_push', 'ia_memoria', 'ia_acciones']) {
    assert.equal(await contar('SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=:t', { t: tabla }), 1, `falta ${tabla}`);
  }
  const cols = (await select("SELECT column_name AS c FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='notificaciones'")).map((c) => c.c);
  assert.ok(cols.includes('push_estado') && cols.includes('push_lote'));
  // idempotente: aplicarla otra vez no falla
  for (const s of sentencias(sql)) await sequelize.query(s);
});

// ---------------------------------------------------------------- agente: registrar sesion
test('agente: registrar_sesion solo PROPONE; al confirmar los datos sirven tal cual para el endpoint normal', async () => {
  await darConsentimientoIA(7);
  const antes = await contar('SELECT COUNT(*) AS n FROM sesiones_entrenamiento WHERE estudiante_id=7');
  const llm = llmQueLlama(['registrar_sesion', { ejercicios: [
    { ejercicio: 'sentadilla', series: [{ repeticiones: 12, peso_kg: 40 }, { repeticiones: 10, peso_kg: 40 }] },
    { ejercicio: 'Plancha abdominal', series: [{ duracion_seg: 45 }] }
  ] }]);
  const r = await ia.chat(S.VALE, { mensaje: 'Hoy hice 2 series de sentadilla con 40 kg (12 y 10) y una plancha de 45 s' }, { llm });
  assert.equal(llm.resultados[0].ok, true);
  assert.equal(llm.resultados[0].pendiente_de_confirmacion, true);
  assert.equal(r.accion.tipo, 'registrar_sesion');
  assert.equal(r.accion.estado, 'propuesta');
  assert.match(r.accion.resumen, /Sentadilla: 12 x 40 kg, 10 x 40 kg; Plancha abdominal: 45 s/);
  assert.equal(await contar('SELECT COUNT(*) AS n FROM sesiones_entrenamiento WHERE estudiante_id=7'), antes, 'no debe registrar nada sin confirmar');

  // la app ejecuta el endpoint normal con los datos propuestos y luego informa el resultado
  const ses = await soc.registrarSesion(S.VALE, r.accion.datos);
  assert.ok(ses.sesion_id);
  const res = await ia.resolverAccion(S.VALE, r.accion.id, { estado: 'confirmada', resultado_id: ses.sesion_id });
  assert.equal(res.estado, 'confirmada'); assert.equal(res.resultado_id, ses.sesion_id);
  await rechaza(ia.resolverAccion(S.VALE, r.accion.id, { estado: 'cancelada' }), 'ACCION_YA_RESUELTA');

  // al reabrir la conversacion, la tarjeta vuelve con su estado
  const c = await ia.verConversacion(S.VALE, r.conversacion_id);
  const conAccion = c.mensajes.find((m) => m.accion);
  assert.equal(conAccion.rol, 'modelo'); assert.equal(conAccion.accion.estado, 'confirmada');
});

test('agente: datos invalidos vuelven al modelo como error y no queda propuesta; solo una propuesta por mensaje', async () => {
  await darConsentimientoIA(8);
  const llm = llmQueLlama(
    ['registrar_sesion', { ejercicios: [{ ejercicio: 'yoga-aereo', series: [{ repeticiones: 10 }] }] }],
    ['registrar_sesion', { ejercicios: [{ ejercicio: 'sentadilla', series: [{}] }] }],
    ['registrar_sesion', { fecha: '2001-01-01', ejercicios: [{ ejercicio: 'sentadilla', series: [{ repeticiones: 10 }] }] }],
    ['registrar_sesion', { ejercicios: [{ ejercicio: 'plancha', series: [{ repeticiones: 10 }] }] }],
    ['registrar_sesion', { ejercicios: [{ ejercicio: 'flexiones', series: [{ repeticiones: 15 }] }] }],
    ['crear_reto_squad', { titulo: 'Otro', metrica: 'sesiones', meta: 3, dias: 7 }]
  );
  const r = await ia.chat(S.SEBAS, { mensaje: 'registra mi entreno' }, { llm });
  assert.match(llm.resultados[0].error, /no existe el ejercicio/);
  assert.match(llm.resultados[1].error, /repeticiones/);
  assert.match(llm.resultados[2].error, /ultimos 7 dias/);
  assert.match(llm.resultados[3].error, /se mide por tiempo/);
  assert.equal(llm.resultados[4].ok, true);
  assert.match(llm.resultados[5].error, /ya hay una propuesta/);
  assert.equal(r.accion.tipo, 'registrar_sesion');
  assert.equal(await contar('SELECT COUNT(*) AS n FROM ia_acciones WHERE estudiante_id=8'), 1);
});

test('agente: las propuestas son privadas y solo admiten confirmada/cancelada', async () => {
  await darConsentimientoIA(7);
  const r = await ia.chat(S.VALE, { mensaje: 'hice flexiones' }, { llm: llmQueLlama(['registrar_sesion', { ejercicios: [{ ejercicio: 'flexiones', series: [{ repeticiones: 20 }] }] }]) });
  await rechaza(ia.resolverAccion(S.SEBAS, r.accion.id, { estado: 'cancelada' }), 'NO_ENCONTRADO');
  await rechaza(ia.resolverAccion(S.VALE, r.accion.id, { estado: 'hecha' }), 'DATOS_INVALIDOS');
  await rechaza(ia.resolverAccion(S.VALE, r.accion.id, { estado: 'confirmada', resultado_id: -3 }), 'DATOS_INVALIDOS');
  const c = await ia.resolverAccion(S.VALE, r.accion.id, { estado: 'cancelada', resultado_id: 99 });
  assert.equal(c.estado, 'cancelada'); assert.equal(c.resultado_id, null);
});

// ---------------------------------------------------------------- agente: retos de squad
test('agente: crear_reto_squad propone un reto valido para el endpoint del squad; sin squad responde error', async () => {
  await darConsentimientoIA(4);
  const llm = llmQueLlama(['crear_reto_squad', { titulo: 'Semana de sentadillas', metrica: 'reps', meta: 300, dias: 7, ejercicio: 'sentadilla' }]);
  const r = await ia.chat(S.LUIS, { mensaje: 'armemos un reto de sentadillas para el squad' }, { llm });
  assert.equal(r.accion.tipo, 'crear_reto_squad');
  assert.match(r.accion.resumen, /Los Titanes.*300 repeticiones de Sentadilla entre todos en 7 dias/);
  assert.equal(await contar('SELECT COUNT(*) AS n FROM retos WHERE squad_id=1'), 0, 'no se crea sin confirmar');
  const reto = await soc.crearRetoSquad(S.LUIS, r.accion.datos);
  assert.equal(reto.squad_id, 1); assert.equal(reto.meta, 300);

  // peso maximo siempre es "cada uno" y la plancha no se mide con peso
  const p = agente.prepararReto({ titulo: 'Max', metrica: 'peso_maximo', meta: 60, dias: 5, ejercicio: 'sentadilla', modalidad: 'squad' }, await agente.catalogoPara(4), { nombre: 'X' });
  assert.equal(p.datos.tipo, 'individual');
  assert.match(agente.prepararReto({ titulo: 'Max', metrica: 'peso_maximo', meta: 60, dias: 5, ejercicio: 'plancha' }, await agente.catalogoPara(4), { nombre: 'X' }).error, /no se mide con peso/);
  assert.match(agente.prepararReto({ titulo: 'Dias', metrica: 'dias_activos', meta: 9, dias: 5 }, [], { nombre: 'X' }).error, /entre 1 y 5/);

  // usuario sin squad
  await sequelize.query("DELETE FROM squad_miembros WHERE estudiante_id=8");
  await darConsentimientoIA(8);
  const sin = llmQueLlama(['crear_reto_squad', { titulo: 'Reto', metrica: 'sesiones', meta: 3, dias: 7 }]);
  const r2 = await ia.chat(S.SEBAS, { mensaje: 'crea un reto' }, { llm: sin });
  assert.match(sin.resultados[0].error, /no tiene squad/);
  assert.equal(r2.accion, null);
});

// ---------------------------------------------------------------- memoria
test('memoria: guarda solo preferencias estructuradas, entra al prompt, el usuario la ve y la borra', async () => {
  await darConsentimientoIA(7);
  // desde la Fase 14 la memoria del agente es Premium
  await sequelize.query('UPDATE usuarios SET premium_hasta = UTC_TIMESTAMP() + INTERVAL 10 DAY WHERE id=7');
  const llm = llmQueLlama(
    ['guardar_preferencia', { clave: 'objetivo', valor: 'Fuerza' }],
    ['guardar_preferencia', { clave: 'dias_semana', valor: '4' }],
    ['guardar_preferencia', { clave: 'lesion', valor: 'rodilla izquierda operada' }],
    ['guardar_preferencia', { clave: 'dias_semana', valor: '9' }],
    ['guardar_preferencia', { clave: 'objetivo', valor: 'ser el mas fuerte del mundo' }]
  );
  const r = await ia.chat(S.VALE, { mensaje: 'quiero ganar fuerza, entreno 4 dias' }, { llm });
  assert.deepEqual(r.memoria_actualizada.map((m) => [m.clave, m.valor]), [['objetivo', 'fuerza'], ['dias_semana', '4']]);
  assert.match(llm.resultados[2].error, /clave desconocida/);
  assert.match(llm.resultados[3].error, /entre 1 y 7/);
  assert.match(llm.resultados[4].error, /valor invalido/);
  assert.deepEqual((await ia.verMemoria(S.VALE)).map((m) => m.clave), ['dias_semana', 'objetivo']);

  // en el siguiente mensaje el modelo recibe lo que recuerda
  const llm2 = llmQueLlama();
  await ia.chat(S.VALE, { conversacionId: r.conversacion_id, mensaje: 'armame una rutina' }, { llm: llm2 });
  assert.match(llm2.recibido[0].system, /Objetivo: fuerza/);
  assert.match(llm2.recibido[0].system, /Dias por semana: 4/);

  await ia.borrarMemoria(S.VALE, 'objetivo');
  assert.deepEqual((await ia.verMemoria(S.VALE)).map((m) => m.clave), ['dias_semana']);
  await rechaza(ia.borrarMemoria(S.VALE, 'no_existe'), 'NO_ENCONTRADO');
  // retirar el permiso del asistente borra la memoria
  await auth.registrarConsentimiento(S.VALE, 'ia_chatbot', false);
  assert.equal(await contar('SELECT COUNT(*) AS n FROM ia_memoria WHERE estudiante_id=7'), 0);
});

test('agente: el prompt marca los ejercicios contraindicados y consultar_progreso no expone nombres de personas', async () => {
  await sequelize.query("INSERT INTO estudiante_flags (estudiante_id,flag_codigo,origen) VALUES (4,'LESION_HOMBRO','sistema')").catch(async () => {
    await sequelize.query("INSERT INTO estudiante_flags (estudiante_id,flag_codigo) VALUES (4,'LESION_HOMBRO')");
  });
  const system = await ia.construirSystemPrompt(4);
  assert.match(system, /press-militar: Press militar, hombros, repeticiones - EVITAR \(LESION_HOMBRO\)/);
  assert.match(system, /plancha: Plancha abdominal, core, tiempo\n/);
  const p = await agente.progreso(4, (await one('SELECT CURDATE() AS h')).h);
  assert.equal(p.squad.nombre, 'Los Titanes');
  const texto = JSON.stringify(p);
  for (const nombre of ['Luis', 'Ana', 'Camila', 'Andres', '@playfit']) assert.ok(!texto.includes(nombre), `se filtro ${nombre}`);
});

// ---------------------------------------------------------------- transferencia a humano y eventos n8n
test('agente: transferir_a_humano pasa la conversacion a Soporte y avisa a los admins (respaldo sin n8n)', async () => {
  await darConsentimientoIA(5);
  const r = await ia.chat(S.CAMILA, { mensaje: 'no me deja cambiar mi correo, quiero hablar con alguien' }, { llm: llmQueLlama(['transferir_a_humano', { motivo: 'general' }]) });
  assert.equal(r.transferido_a_soporte, true);
  assert.equal(r._aviso, undefined, 'el campo interno no sale en la respuesta');
  const c = await one('SELECT estado, motivo FROM soporte_conversaciones WHERE id=:id', { id: r.soporte_conversacion_id });
  assert.deepEqual([c.estado, c.motivo], ['pendiente', 'general']);
  assert.equal(await notifs(1, 'soporte'), 1);
  // un segundo mensaje sobre pagos en la misma conversacion de soporte no vuelve a avisar
  await ia.chat(S.CAMILA, { mensaje: 'y tambien quiero pagar el premium' }, { llm: llmQueLlama() });
  assert.equal(await notifs(1, 'soporte'), 1);
});

test('eventos: con n8n configurado se envia el webhook (con token) y no se usa el respaldo; si n8n falla, si', async () => {
  process.env.N8N_WEBHOOK_URL = 'http://n8n.test/webhook/';
  process.env.N8N_TOKEN = 't'.repeat(32);
  let capturado;
  const ok = async (url, opts) => { capturado = { url, opts }; return { ok: true, status: 200 }; };
  assert.equal(await eventos.soporteTransferida(77, 'pago', { fetchFn: ok }), 'n8n');
  assert.equal(capturado.url, 'http://n8n.test/webhook/soporte-transferida');
  assert.equal(capturado.opts.headers['x-playfit-token'], 't'.repeat(32));
  assert.deepEqual(Object.keys(JSON.parse(capturado.opts.body)).sort(), ['conversacion_id', 'enviado_at', 'evento', 'motivo']);
  assert.equal(await notifs(1, 'soporte'), 0);
  const caido = async () => { throw new Error('ECONNREFUSED'); };
  assert.equal(await eventos.soporteTransferida(77, 'pago', { fetchFn: caido }), 'respaldo');
  assert.equal(await notifs(1, 'soporte'), 1);
  await assert.rejects(eventos.emitir('borrar-todo', {}), /evento desconocido/);
});

test('soporte: la transferencia desde el chat de Soporte tambien avisa a los admins', async () => {
  await soc.enviarMensajeUsuario(S.ANA, 'hola');
  assert.equal(await notifs(1, 'soporte'), 0);
  await soc.enviarMensajeUsuario(S.ANA, 'quiero hablar con un asesor');
  assert.equal(await notifs(1, 'soporte'), 1);
});

// ---------------------------------------------------------------- cliente Gemini con funciones
test('cliente Gemini: ciclo de function calling reenvia las partes del modelo y devuelve los resultados', async () => {
  const pedidos = [];
  const respuestas = [
    { candidates: [{ content: { parts: [{ functionCall: { name: 'consultar_progreso', args: {} }, thoughtSignature: 'FIRMA' }] } }] },
    { candidates: [{ content: { parts: [{ text: 'Llevas ' }, { text: '5 dias de racha' }] } }] }
  ];
  const fetchFn = async (url, opts) => { pedidos.push(JSON.parse(opts.body)); return { ok: true, status: 200, json: async () => respuestas.shift() }; };
  const cli = ia.crearClienteGemini({ apiKey: 'k', fetchFn });
  const llamadas = [];
  const out = await cli.generate({
    system: 'S', history: [], userMessage: 'como voy?', tools: agente.FUNCIONES,
    ejecutarFuncion: async (n, a) => { llamadas.push([n, a]); return { ok: true, racha_actual: 5 }; }
  });
  assert.equal(out, 'Llevas 5 dias de racha');
  assert.deepEqual(llamadas, [['consultar_progreso', {}]]);
  assert.equal(pedidos[0].tools[0].functionDeclarations.length, agente.FUNCIONES.length);
  const segundo = pedidos[1].contents;
  assert.deepEqual(segundo.map((c) => c.role), ['user', 'model', 'user']);
  assert.equal(segundo[1].parts[0].thoughtSignature, 'FIRMA');
  assert.deepEqual(segundo[2].parts[0].functionResponse, { name: 'consultar_progreso', response: { ok: true, racha_actual: 5 } });
});

test('cliente Gemini: si el modelo insiste en llamar funciones, la ultima vuelta se pide sin funciones', async () => {
  const pedidos = [];
  const fetchFn = async (url, opts) => {
    const body = JSON.parse(opts.body); pedidos.push(body);
    const parts = body.toolConfig ? [{ text: 'fin' }] : [{ functionCall: { name: 'consultar_progreso', args: {} } }];
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts } }] }) };
  };
  const out = await ia.crearClienteGemini({ apiKey: 'k', fetchFn }).generate({
    system: 'S', history: [], userMessage: 'x', tools: agente.FUNCIONES, ejecutarFuncion: async () => { throw new Error('boom'); }
  });
  assert.equal(out, 'fin');
  assert.equal(pedidos.length, 4);
  assert.deepEqual(pedidos[3].toolConfig, { functionCallingConfig: { mode: 'NONE' } });
  assert.equal(pedidos[1].contents.at(-1).parts[0].functionResponse.response.ok, false);
});

// ---------------------------------------------------------------- push (FCM)
const TOKEN_A = 'fcm-token-celular-A-1234567890', TOKEN_B = 'fcm-token-celular-B-1234567890';

test('push: registrar celulares (validacion, cambio de dueno y maximo por usuario)', async () => {
  await rechaza(push.registrarDispositivo(3, 'corto'), 'DATOS_INVALIDOS');
  await rechaza(push.registrarDispositivo(3, "x' OR 1=1 --aaaaaaaaaaaaaa"), 'DATOS_INVALIDOS');
  await push.registrarDispositivo(3, TOKEN_A);
  await push.registrarDispositivo(3, TOKEN_A); // repetido: no duplica
  assert.equal(await push.contarDispositivos(3), 1);
  await push.registrarDispositivo(4, TOKEN_A); // otra cuenta en el mismo celular
  assert.equal(await push.contarDispositivos(3), 0);
  assert.equal(await push.contarDispositivos(4), 1);
  for (let i = 0; i < 7; i++) await push.registrarDispositivo(5, `token-numero-${i}-abcdefghijklmn`);
  assert.equal(await push.contarDispositivos(5), push.MAX_DISPOSITIVOS);
  await push.quitarDispositivo(4, TOKEN_A);
  assert.equal(await push.contarDispositivos(4), 0);
});

test('push: la bandeja de salida envia, borra tokens invalidos, marca sin dispositivo y omite lo viejo', async () => {
  await sequelize.query("UPDATE notificaciones SET push_estado='omitida'");
  await push.registrarDispositivo(3, TOKEN_A);
  await push.registrarDispositivo(3, TOKEN_B);
  await sequelize.query("INSERT INTO notificaciones (usuario_id,tipo,titulo,cuerpo) VALUES (3,'reto','Nuevo reto','Unete'),(4,'reto','Sin celular',NULL)");
  await sequelize.query("INSERT INTO notificaciones (usuario_id,tipo,titulo,created_at) VALUES (3,'reto','Vieja',UTC_TIMESTAMP() - INTERVAL 2 DAY)");
  const enviados = [];
  const cliente = { async enviar(token, msg) { enviados.push([token, msg]); return token === TOKEN_B ? 'token_invalido' : 'ok'; } };
  const r = await push.procesarPendientes(cliente);
  assert.deepEqual(r, { enviadas: 1, procesadas: 2 });
  assert.deepEqual(enviados.map((e) => e[1].titulo), ['Nuevo reto', 'Nuevo reto']);
  assert.equal(enviados[0][1].datos.tipo, 'reto');
  const estados = await select("SELECT titulo, push_estado FROM notificaciones WHERE titulo IN ('Nuevo reto','Sin celular','Vieja') ORDER BY id");
  assert.deepEqual(estados.map((e) => e.push_estado), ['enviada', 'sin_dispositivo', 'omitida']);
  assert.equal(await push.contarDispositivos(3), 1, 'el token invalido se borra');
  assert.deepEqual(await push.procesarPendientes(cliente), { enviadas: 0, procesadas: 0 }, 'nada se envia dos veces');
  assert.deepEqual(await push.procesarPendientes(null), { enviadas: 0 });
});

test('push: cliente FCM firma un JWT RS256 con la cuenta de servicio, cachea el token y detecta tokens invalidos', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const cuentaJson = JSON.stringify({ project_id: 'playfit-test', client_email: 'push@playfit-test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  const cuenta = push.leerCuentaServicio(Buffer.from(cuentaJson).toString('base64'));
  assert.equal(cuenta.projectId, 'playfit-test');
  assert.throws(() => push.leerCuentaServicio('{"a":1}'), /project_id/);
  assert.equal(push.leerCuentaServicio(''), null);

  const pedidos = [];
  const fetchFn = async (url, opts) => {
    pedidos.push({ url, opts });
    if (url.includes('oauth2')) return { ok: true, status: 200, json: async () => ({ access_token: 'ACCESO', expires_in: 3600 }) };
    const token = JSON.parse(opts.body).message.token;
    if (token === 'malo') return { ok: false, status: 404, text: async () => '' };
    if (token === 'malo400') return { ok: false, status: 400, text: async () => '{"error":{"details":[{"errorCode":"UNREGISTERED"}]}}' };
    return { ok: true, status: 200 };
  };
  const cli = push.crearClienteFcm({ cuenta, fetchFn });
  assert.equal(await cli.enviar('bueno', { titulo: 'Hola', cuerpo: 'Mundo', datos: { notificacion_id: 5 } }), 'ok');
  assert.equal(await cli.enviar('malo', { titulo: 'x' }), 'token_invalido');
  assert.equal(await cli.enviar('malo400', { titulo: 'x' }), 'token_invalido');
  assert.equal(pedidos.filter((p) => p.url.includes('oauth2')).length, 1, 'el token de acceso se reutiliza');
  const assertion = new URLSearchParams(pedidos[0].opts.body).get('assertion');
  const claims = jwt.verify(assertion, publicKey.export({ type: 'spki', format: 'pem' }), { algorithms: ['RS256'] });
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/firebase.messaging');
  const msg = JSON.parse(pedidos[1].opts.body).message;
  assert.equal(pedidos[1].url, 'https://fcm.googleapis.com/v1/projects/playfit-test/messages:send');
  assert.equal(pedidos[1].opts.headers.Authorization, 'Bearer ACCESO');
  assert.deepEqual(msg.data, { notificacion_id: '5' });
  assert.equal(push.crearClienteFcm({ cuenta: null }), null);
});

// ---------------------------------------------------------------- API interna para n8n
test('n8n: rachas en riesgo y resumen semanal solo entregan ids y numeros', async () => {
  const hoy = (await one('SELECT CURDATE() AS h')).h;
  await sequelize.query('UPDATE perfil_gamificacion SET ultima_actividad=DATE_SUB(CURDATE(), INTERVAL 1 DAY) WHERE estudiante_id IN (3,8)');
  const r = await internal.rachasEnRiesgo();
  assert.equal(r.fecha, hoy);
  assert.deepEqual(r.usuario_ids, [3]); // Sebastian tiene racha 1: no esta "en riesgo"
  await internal.crearNotificaciones({ usuario_ids: [3], tipo: 'racha_riesgo', titulo: 'Tu racha esta en riesgo' });
  assert.deepEqual((await internal.rachasEnRiesgo()).usuario_ids, [], 'no se avisa dos veces el mismo dia');

  const s = await internal.resumenSemanal();
  const titanes = s.squads.find((x) => x.squad_id === 1);
  assert.deepEqual(titanes.usuario_ids.sort(), [3, 4, 5, 6]);
  assert.ok(titanes.sesiones >= 1);
  assert.ok(!JSON.stringify(s).includes('@'));
});

test('n8n: crear notificaciones valida tipo, textos y destinatarios', async () => {
  await rechaza(internal.crearNotificaciones({ usuario_ids: [3], tipo: 'phishing', titulo: 'Hola' }), 'DATOS_INVALIDOS');
  await rechaza(internal.crearNotificaciones({ usuario_ids: [3], tipo: 'sistema', titulo: 'x' }), 'DATOS_INVALIDOS');
  await rechaza(internal.crearNotificaciones({ usuario_ids: ['3'], tipo: 'sistema', titulo: 'Hola' }), 'DATOS_INVALIDOS');
  await rechaza(internal.crearNotificaciones({ usuario_ids: [3], tipo: 'sistema', titulo: 'Hola', cuerpo: 'x'.repeat(256) }), 'DATOS_INVALIDOS');
  assert.deepEqual(await internal.crearNotificaciones({ usuario_ids: [3, 3, 4, 99999], tipo: 'resumen_semanal', titulo: 'Tu semana' }), { creadas: 2 });
  assert.deepEqual(await internal.crearNotificaciones({ destino: 'admins', tipo: 'soporte', titulo: 'Nueva conversacion' }), { creadas: 1 });
});

test('HTTP: API interna exige el token de n8n y el gateway no la expone; la app registra su celular', async () => {
  const srv = await H.levantar();
  try {
    const social = H.api(srv.targets.social), gw = H.api(srv.base);
    assert.equal((await social('GET', '/internal/rachas-en-riesgo')).status, 404, 'sin N8N_TOKEN la API no existe');
    process.env.N8N_TOKEN = 'k'.repeat(40);
    assert.equal((await social('GET', '/internal/rachas-en-riesgo')).status, 401);
    assert.equal((await social('GET', '/internal/rachas-en-riesgo', { headers: { 'x-playfit-token': 'k'.repeat(39) } })).status, 401);
    const ok = await social('POST', '/internal/notificaciones', { headers: { 'x-playfit-token': 'k'.repeat(40) }, body: { destino: 'admins', tipo: 'sistema', titulo: 'Prueba n8n' } });
    assert.equal(ok.status, 201); assert.equal(ok.body.creadas, 1);
    assert.equal((await gw('GET', '/internal/rachas-en-riesgo', { headers: { 'x-playfit-token': 'k'.repeat(40) } })).status, 404);

    const login = await gw('POST', '/api/auth/login', { body: { email: 'ana@playfit.test', password: 'PlayFit123!' } });
    const token = login.body.accessToken;
    assert.equal((await gw('POST', '/api/social/devices', { token, body: { token: TOKEN_A } })).status, 204);
    assert.equal(await push.contarDispositivos(3), 1);
    assert.equal((await gw('POST', '/api/social/devices', { token, body: { token: '<script>' } })).status, 400);
    assert.equal((await gw('DELETE', '/api/social/devices', { token, body: { token: TOKEN_A } })).status, 204);
    assert.equal(await push.contarDispositivos(3), 0);
    assert.equal((await gw('POST', '/api/social/devices', { body: { token: TOKEN_A } })).status, 401);

    // memoria del agente por HTTP
    await darConsentimientoIA(3);
    await sequelize.query("INSERT INTO ia_memoria (estudiante_id,clave,valor) VALUES (3,'horario','noche')");
    const mem = await gw('GET', '/api/content/ai/memory', { token });
    assert.deepEqual(mem.body.map((m) => [m.clave, m.etiqueta, m.valor]), [['horario', 'Horario preferido', 'noche']]);
    assert.equal((await gw('DELETE', '/api/content/ai/memory', { token })).status, 204);
    assert.deepEqual((await gw('GET', '/api/content/ai/memory', { token })).body, []);
  } finally {
    await srv.cerrar();
  }
});

test('el agente no inventa acciones: el prompt fija limites y se corrige si dice que hizo algo sin hacerlo', async () => {
  const system = await ia.construirSystemPrompt(4);
  assert.match(system, /LIMITES \(obligatorios\)/);
  assert.match(system, /NUNCA finjas haberlo hecho/);
  assert.match(system, /No puedes|NO puedes/);

  // dice que cambio la contrasena sin ninguna funcion: se aclara que no se hizo nada
  const falso = ia.corregirPromesas('Listo, ya cambie tu contrasena.', { propuesta: null, memoria: [], transferir: null });
  assert.match(falso, /no hice ningun cambio/);
  // dice que ya registro la sesion pero solo hay una propuesta: se avisa que falta confirmar
  assert.match(ia.corregirPromesas('Ya registre tu sesion.', { propuesta: { tipo: 'registrar_sesion' }, memoria: [] }), /todavia no esta guardado/);
  // respuestas normales no se tocan
  assert.equal(ia.corregirPromesas('Hoy llevas 1 sesion, sigue asi.', {}), 'Hoy llevas 1 sesion, sigue asi.');
  assert.equal(ia.corregirPromesas('He guardado tus preferencias.', { memoria: [{ clave: 'objetivo' }] }), 'He guardado tus preferencias.');
});
