const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const S = require('./_setup');
const content = require('@playfit/content-service');
const clin = require('@playfit/clinical-service');
const { ia } = content;
const { select, sequelize } = require('@playfit/shared');

before(S.preparar); after(S.cerrar);
const rechaza = (p, code) => assert.rejects(p, (e) => { assert.equal(e.code, code, `esperaba ${code}, llego ${e.code}: ${e.message}`); return true; });

// Modelo falso: guarda lo que recibe para poder auditar que NUNCA llegue texto clinico.
const crearLlmFalso = () => { const llamadas = []; return { llamadas, async generate(x) { llamadas.push(x); return 'Respuesta de prueba'; } }; };
const darConsentimientoIA = (id) => sequelize.query("INSERT INTO consentimientos (usuario_id,tipo,aceptado) VALUES (:id,'ia_chatbot',1)", { replacements: { id } });

test('mascota: elige el mensaje mas especifico segun los datos reales', async () => {
  assert.equal((await content.elegirMensaje('racha', { racha: 8 })).pose, 'yeah');   // >=7 gana a >=3
  assert.equal((await content.elegirMensaje('racha', { racha: 4 })).pose, 'vamos');
  assert.equal((await content.elegirMensaje('racha', { racha: 0 })).pose, 'triste');
  assert.equal((await content.elegirMensaje('racha', { racha: 1 })), null);                  // ninguna regla aplica
  assert.equal((await content.elegirMensaje('ranking', { puesto: 1 })).pose, 'logro');
  assert.equal((await content.elegirMensaje('ranking', { puesto: 5 })).pose, 'enfocado');
  assert.equal((await content.elegirMensaje('reto', { estado: 'completado' })).pose, 'logro');
  assert.equal((await content.elegirMensaje('comparacion', { estado: 'pierdes' })).pose, 'enfocado');
  assert.equal((await content.elegirMensaje('bienvenida', {})).pose, 'feliz');               // sin condicion = respaldo
});
test('mascota: AUSENTE en pantallas clinicas y para admin', async () => {
  for (const pantalla of ['historial_clinico', 'mediciones', 'flags']) assert.equal(await content.elegirMensaje('bienvenida', {}, { pantalla, rol: 'estudiante' }), null);
  assert.equal(await content.elegirMensaje('bienvenida', {}, { pantalla: 'inicio', rol: 'admin' }), null);
  assert.ok(await content.elegirMensaje('bienvenida', {}, { pantalla: 'dashboard', rol: 'estudiante' }));
});
test('contenido: detalle de ejercicio con pasos, tips y contraindicaciones; nutricion filtrada', async () => {
  const d = await content.detalleEjercicio(1);
  assert.equal(d.slug, 'sentadilla'); assert.equal(d.pasos.length, 4); assert.ok(d.tips.length >= 2); assert.deepEqual(d.contraindicado_con, ['LESION_RODILLA']);
  assert.equal((await content.listarEjercicios({ grupo: 'piernas' })).length, 2);
  await rechaza(content.listarEjercicios({ grupo: 'inventado' }), 'DATOS_INVALIDOS');
  await rechaza(content.detalleEjercicio(999), 'NO_ENCONTRADO');
  assert.ok(await content.tipPostSerie(1)); assert.equal(await content.tipPostSerie(9), null);
  assert.equal((await content.listarNutricion({ categoria: 'hidratacion' })).length, 1);
});

test('IA: sin consentimiento no responde y no gasta cuota', async () => {
  const llm = crearLlmFalso();
  await sequelize.query("INSERT INTO consentimientos (usuario_id,tipo,aceptado) VALUES (4,'ia_chatbot',0)"); // el seed lo da a todos: se revoca
  await rechaza(ia.chat(S.LUIS, { mensaje: 'hola' }, { llm }), 'CONSENTIMIENTO_REQUERIDO');
  assert.equal(llm.llamadas.length, 0);
  assert.equal((await select('SELECT solicitudes FROM ia_uso_diario WHERE estudiante_id=4'))[0].solicitudes, 1); // solo la del seed
});
test('IA: al modelo solo llegan CODIGOS de flags, jamas el texto clinico ni datos personales', async () => {
  await sequelize.query("INSERT INTO consentimientos (usuario_id,tipo,aceptado) VALUES (4,'datos_salud',1)");
  const secreto = 'diagnostico confidencial XYZ-777 de la rodilla izquierda';
  await clin.guardarHistorial(S.LUIS, 4, { condiciones: secreto, medicamentos: 'MedicinaSecretaABC' });
  await darConsentimientoIA(4);
  const llm = crearLlmFalso();
  const r = await ia.chat(S.LUIS, { mensaje: 'Que rutina de piernas me recomiendas?' }, { llm });
  assert.equal(r.respuesta, 'Respuesta de prueba'); assert.equal(r.restantes_hoy, 1); // limite 3 - 1 del seed - 1 de ahora
  const enviado = JSON.stringify(llm.llamadas[0]);
  assert.match(enviado, /LESION_RODILLA/);
  for (const prohibido of ['XYZ-777', 'MedicinaSecretaABC', 'confidencial', 'Luis', 'Moreno', 'luis@playfit.test']) assert.ok(!enviado.includes(prohibido), `se filtro: ${prohibido}`);
  const msg = await select("SELECT flags_aplicados FROM mensajes_ia WHERE conversacion_id=:c AND rol='modelo'", { c: r.conversacion_id });
  const fa = msg[0].flags_aplicados; // el driver puede entregar el JSON ya parseado o como texto
  assert.deepEqual(typeof fa === 'string' ? JSON.parse(fa) : fa, ['LESION_RODILLA']);
});
test('IA: la conversacion mantiene historial y es privada del estudiante', async () => {
  const llm = crearLlmFalso();
  const r1 = await ia.chat(S.VALE, { mensaje: 'primer mensaje' }, { llm });
  await ia.chat(S.VALE, { conversacionId: r1.conversacion_id, mensaje: 'segundo mensaje' }, { llm: llm });
  assert.ok(llm.llamadas.at(-1).history.length >= 2);
  const v = await ia.verConversacion(S.VALE, r1.conversacion_id);
  assert.ok(v.mensajes.length >= 4);
  await rechaza(ia.verConversacion(S.ANA, r1.conversacion_id), 'NO_ENCONTRADO');
  await rechaza(ia.chat(S.ANA, { conversacionId: r1.conversacion_id, mensaje: 'hola' }, { llm }), 'NO_ENCONTRADO');
});
test('IA: la cuota diaria se respeta (limite 3 en pruebas) y un fallo del modelo la devuelve', async () => {
  await darConsentimientoIA(5);
  const llm = crearLlmFalso();
  for (let i = 0; i < 3; i++) await ia.chat(S.CAMILA, { mensaje: `pregunta ${i}` }, { llm });
  await rechaza(ia.chat(S.CAMILA, { mensaje: 'una mas' }, { llm }), 'CUOTA_IA_AGOTADA');
  assert.equal(llm.llamadas.length, 3);
  await darConsentimientoIA(6);
  const roto = { async generate() { throw new Error('Gemini caido'); } };
  await assert.rejects(ia.chat(S.ANDRES, { mensaje: 'hola' }, { llm: roto }), /Gemini caido/);
  const uso = await select('SELECT solicitudes FROM ia_uso_diario WHERE estudiante_id=6');
  assert.equal(uso[0].solicitudes, 0); // la cuota se devolvio
});
test('IA: mensajes con senales de alarma NO van al modelo; se responde con aviso fijo', async () => {
  await darConsentimientoIA(7);
  const llm = crearLlmFalso();
  const r = await ia.chat(S.VALE, { mensaje: 'Siento dolor en el pecho y mareo intenso al correr' }, { llm });
  assert.equal(r.alerta_salud, true); assert.equal(r.respuesta, ia.MENSAJE_ALARMA); assert.equal(llm.llamadas.length, 0);
  assert.equal(ia.detectarEmergencia('Quiero mejorar mi técnica de sentadilla'), false);
});
test('IA: validaciones, rol y modelo no configurado', async () => {
  await darConsentimientoIA(8);
  await rechaza(ia.chat(S.SEBAS, { mensaje: '   ' }, { llm: crearLlmFalso() }), 'DATOS_INVALIDOS');
  await rechaza(ia.chat(S.SEBAS, { mensaje: 'x'.repeat(1001) }, { llm: crearLlmFalso() }), 'DATOS_INVALIDOS');
  await rechaza(ia.chat(S.ADMIN, { mensaje: 'hola' }, { llm: crearLlmFalso() }), 'PROHIBIDO');
  await rechaza(ia.chat(S.SEBAS, { mensaje: 'hola' }, {}), 'IA_NO_CONFIGURADA');
});
test('cliente Gemini: arma la peticion REST correcta (probado con fetch simulado, sin red)', async () => {
  let capturado;
  const fetchFn = async (url, opts) => { capturado = { url, opts }; return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'Hola ' }, { text: 'mundo' }] } }] }) }; };
  const cli = ia.crearClienteGemini({ apiKey: 'CLAVE', modelo: 'gemini-test', fetchFn });
  const out = await cli.generate({ system: 'SYS', history: [{ role: 'usuario', text: 'a' }, { role: 'modelo', text: 'b' }], userMessage: 'c' });
  assert.equal(out, 'Hola mundo');
  assert.match(capturado.url, /models\/gemini-test:generateContent$/);
  assert.equal(capturado.opts.headers['x-goog-api-key'], 'CLAVE');
  const body = JSON.parse(capturado.opts.body);
  assert.equal(body.systemInstruction.parts[0].text, 'SYS');
  assert.deepEqual(body.contents.map((c) => c.role), ['user', 'model', 'user']);
  assert.equal(ia.crearClienteGemini({ apiKey: '' }), null);
  const f429 = async () => ({ ok: false, status: 429 });
  await rechaza(ia.crearClienteGemini({ apiKey: 'k', fetchFn: f429 }).generate({ system: '', history: [], userMessage: 'x' }), 'IA_SATURADA');
});

test('cliente Gemini: modelo retirado (404) y clave rechazada (403) dan un 503 claro, no un error generico', async () => {
  const falso = (status) => async () => ({ ok: false, status, json: async () => ({}) });
  const sinLog = console.error; console.error = () => {};
  try {
    const a = ia.crearClienteGemini({ apiKey: 'K', modelo: 'viejo', fetchFn: falso(404) });
    await assert.rejects(a.generate({ system: 's', history: [], userMessage: 'hola' }), (e) => e.status === 503 && e.code === 'IA_MODELO_NO_DISPONIBLE');
    const b = ia.crearClienteGemini({ apiKey: 'K', modelo: 'm', fetchFn: falso(403) });
    await assert.rejects(b.generate({ system: 's', history: [], userMessage: 'hola' }), (e) => e.status === 503 && e.code === 'IA_CLAVE_INVALIDA');
    const c = ia.crearClienteGemini({ apiKey: 'K', modelo: 'm', fetchFn: falso(500) });
    await assert.rejects(c.generate({ system: 's', history: [], userMessage: 'hola' }), (e) => e.code === 'IA_ERROR');
  } finally { console.error = sinLog; }
});
