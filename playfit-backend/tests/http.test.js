// Pruebas HTTP REALES: servicios y gateway escuchando en puertos locales, peticiones con fetch.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const S = require('./_setup');
const { levantar, api, cerrar } = require('./_http');
const { select, sequelize } = require('@playfit/shared');

let sis, http;
before(async () => { await S.preparar(); sis = await levantar(); http = api(sis.base); });
after(async () => { await sis.cerrar(); await S.cerrar(); });

const login = async (email, password = 'PlayFit123!') => {
  const r = await http('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(r.status, 200, `login ${email}: ${r.text}`);
  return r.body.accessToken;
};
const codigo = (r) => r.body && r.body.error && r.body.error.code;

// ================= gateway: infraestructura =================
test('gateway: /health agrega el estado de los 4 servicios', async () => {
  const r = await http('GET', '/health');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.servicios, { auth: 'ok', clinical: 'ok', social: 'ok', content: 'ok' });
});
test('gateway: cabeceras de seguridad, x-request-id y sin x-powered-by', async () => {
  const r = await http('GET', '/health');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(r.headers.get('x-request-id'));
  assert.equal(r.headers.get('x-powered-by'), null);
});
test('gateway: rutas inexistentes dan 404 JSON (en gateway y en servicios)', async () => {
  const a = await http('GET', '/api/nada');
  assert.equal(a.status, 404); assert.equal(codigo(a), 'RUTA_NO_ENCONTRADA');
  const t = await login('ana@playfit.test');
  const b = await http('GET', '/api/social/nada', { token: t });
  assert.equal(b.status, 404); assert.equal(codigo(b), 'RUTA_NO_ENCONTRADA');
});
test('gateway: JSON malformado -> 400 y cuerpo gigante -> 413', async () => {
  const a = await http('POST', '/api/auth/login', { raw: '{"email": ' });
  assert.equal(a.status, 400); assert.equal(codigo(a), 'JSON_INVALIDO');
  const b = await http('POST', '/api/auth/login', { raw: JSON.stringify({ email: 'x'.repeat(300000) }) });
  assert.equal(b.status, 413); assert.equal(codigo(b), 'CUERPO_DEMASIADO_GRANDE');
});
test('gateway: limite de intentos de login -> 429 (instancia con limite 3)', async () => {
  const g = await sis.levantarGateway({ limiteAuth: 3, limiteGlobal: 1000 });
  try {
    const h = api(g.base);
    const estados = [];
    for (let i = 0; i < 5; i++) estados.push((await h('POST', '/api/auth/login', { body: { email: 'ana@playfit.test', password: 'mala' } })).status);
    assert.deepEqual(estados, [401, 401, 401, 429, 429]);
    const r = await h('POST', '/api/auth/login', { body: { email: 'ana@playfit.test', password: 'mala' } });
    assert.equal(codigo(r), 'DEMASIADOS_INTENTOS');
  } finally { await g.cerrar(); }
});
test('gateway: servicio caido -> 502 JSON claro (no se cuelga ni filtra detalles)', async () => {
  const g = await sis.levantarGateway({ targets: { ...sis.targets, social: 'http://127.0.0.1:1' } });
  try {
    const t = await login('ana@playfit.test');
    const r = await api(g.base)('GET', '/api/social/dashboard', { token: t });
    assert.equal(r.status, 502); assert.equal(codigo(r), 'SERVICIO_NO_DISPONIBLE');
    const h = await api(g.base)('GET', '/health');
    assert.equal(h.status, 503); assert.equal(h.body.servicios.social, 'caido');
  } finally { await g.cerrar(); }
});
test('gateway: CORS solo para origenes autorizados', async () => {
  const g = await sis.levantarGateway({ corsOrigins: ['http://localhost:5000'] });
  try {
    const ok = await api(g.base)('OPTIONS', '/api/auth/login', { headers: { origin: 'http://localhost:5000', 'access-control-request-method': 'POST' } });
    assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:5000');
    const mal = await api(g.base)('OPTIONS', '/api/auth/login', { headers: { origin: 'http://sitio-malo.com', 'access-control-request-method': 'POST' } });
    assert.equal(mal.headers.get('access-control-allow-origin'), null);
  } finally { await g.cerrar(); }
});

// ================= autenticacion por HTTP =================
test('auth: registro -> /me -> refresh con rotacion -> reuso detectado -> logout', async () => {
  const reg = await http('POST', '/api/auth/register', { body: { nombre: 'Laura', apellido: 'Rios', email: 'laura@playfit.test', password: 'Clave12345', consentimientos: { tratamiento_datos: true } } });
  assert.equal(reg.status, 201); assert.equal(reg.body.usuario.rol, 'estudiante');
  const me = await http('GET', '/api/auth/me', { token: reg.body.accessToken });
  assert.equal(me.status, 200); assert.equal(me.body.email, 'laura@playfit.test');
  assert.equal(me.body.password_hash, undefined); // jamas se expone el hash
  const r1 = await http('POST', '/api/auth/refresh', { body: { refreshToken: reg.body.refreshToken } });
  assert.equal(r1.status, 200); assert.notEqual(r1.body.refreshToken, reg.body.refreshToken);
  const reuso = await http('POST', '/api/auth/refresh', { body: { refreshToken: reg.body.refreshToken } });
  assert.equal(reuso.status, 401); assert.equal(codigo(reuso), 'TOKEN_REUTILIZADO');
  const lo = await http('POST', '/api/auth/login', { body: { email: 'laura@playfit.test', password: 'Clave12345' } });
  const out = await http('POST', '/api/auth/logout', { body: { refreshToken: lo.body.refreshToken } });
  assert.equal(out.status, 204);
});
test('auth: errores de validacion y credenciales con codigos estables', async () => {
  const debil = await http('POST', '/api/auth/register', { body: { nombre: 'Ana', apellido: 'Lopez', email: 'x@y.com', password: '123', consentimientos: { tratamiento_datos: true } } });
  assert.equal(debil.status, 400); assert.equal(codigo(debil), 'PASSWORD_DEBIL');
  const mala = await http('POST', '/api/auth/login', { body: { email: 'ana@playfit.test', password: 'mala' } });
  assert.equal(mala.status, 401); assert.equal(codigo(mala), 'CREDENCIALES_INVALIDAS');
  const vacio = await http('POST', '/api/auth/login', {});
  assert.equal(vacio.status, 401);
});
test('seguridad: sin token, token falso, firmado con otra clave o vencido -> 401', async () => {
  assert.equal(codigo(await http('GET', '/api/social/dashboard')), 'NO_AUTENTICADO');
  assert.equal(codigo(await http('GET', '/api/social/dashboard', { token: 'abc.def.ghi' })), 'TOKEN_INVALIDO');
  const falso = jwt.sign({ sub: 1, rol: 'admin' }, 'otra-clave-que-no-es-la-nuestra-123');
  assert.equal(codigo(await http('GET', '/api/auth/users', { token: falso })), 'TOKEN_INVALIDO');
  const vencido = jwt.sign({ sub: 3, rol: 'estudiante' }, process.env.JWT_SECRET, { expiresIn: -10 });
  assert.equal(codigo(await http('GET', '/api/social/dashboard', { token: vencido })), 'TOKEN_EXPIRADO');
});
test('seguridad: no se puede suplantar identidad con cabeceras y los servicios exigen token aun si se llaman directo', async () => {
  const r = await http('GET', '/api/auth/me', { headers: { 'x-user-id': '1', 'x-user-role': 'admin' } });
  assert.equal(r.status, 401);
  const directo = await api(sis.targets.clinical)('GET', '/api/clinical/students/3/history');
  assert.equal(directo.status, 401);
});
test('auth: consentimientos y administracion de usuarios segun el rol', async () => {
  const ana = await login('ana@playfit.test'), admin = await login('admin@playfit.test'), doc = await login('docente@playfit.test');
  const c = await http('PUT', '/api/auth/consents/ia_chatbot', { token: ana, body: { aceptado: false } });
  assert.equal(c.status, 200); assert.equal(c.body.ia_chatbot, false);
  assert.equal((await http('PUT', '/api/auth/consents/ia_chatbot', { token: ana, body: { aceptado: 'si' } })).status, 400);
  await http('PUT', '/api/auth/consents/ia_chatbot', { token: ana, body: { aceptado: true } });
  assert.equal((await http('GET', '/api/auth/users', { token: ana })).status, 403);
  assert.equal((await http('GET', '/api/auth/users', { token: doc })).status, 403);
  const lista = await http('GET', '/api/auth/users', { token: admin });
  assert.equal(lista.status, 200); assert.ok(lista.body.length >= 8);
  const nuevo = await http('POST', '/api/auth/users', { token: admin, body: { rol: 'docente', nombre: 'Rosa', apellido: 'Vega', email: 'rosa@playfit.test', password: 'Docente123' } });
  assert.equal(nuevo.status, 201);
  assert.equal((await http('POST', '/api/auth/users', { token: ana, body: { rol: 'admin', nombre: 'Xx', apellido: 'Yy', email: 'z@z.com', password: 'Docente123' } })).status, 403);
  assert.equal((await http('PATCH', `/api/auth/users/${nuevo.body.id}`, { token: admin, body: { activo: false } })).status, 204);
  assert.equal((await http('POST', '/api/auth/login', { body: { email: 'rosa@playfit.test', password: 'Docente123' } })).status, 401);
});

// ================= social por HTTP =================
test('social: flujo del estudiante (dashboard, sesion, historial, retos, rankings)', async () => {
  const t = await login('andres@playfit.test');
  const d0 = await http('GET', '/api/social/dashboard', { token: t });
  assert.equal(d0.status, 200); assert.equal(d0.body.racha_actual, 0); assert.equal(d0.body.semana.length, 7);
  const s = await http('POST', '/api/social/sessions', { token: t, body: { ejercicios: [{ ejercicio_id: 1, series: [{ repeticiones: 150 }, { repeticiones: 150 }] }] } });
  assert.equal(s.status, 201); assert.ok(s.body.xp_ganado >= 50); assert.equal(s.body.racha, 1);
  const d1 = await http('GET', '/api/social/dashboard', { token: t });
  assert.equal(d1.body.racha_actual, 1); assert.ok(d1.body.xp_total > d0.body.xp_total);
  const h = await http('GET', '/api/social/sessions?limit=2', { token: t });
  assert.equal(h.body.length, 2); assert.ok(h.body[0].series.length >= 1);
  const rk = await http('GET', '/api/social/rankings/xp?limit=3', { token: t });
  assert.equal(rk.body.length, 3);
  const re = await http('GET', '/api/social/rankings/exercises/1', { token: t });
  assert.equal(re.body.unidad, 'reps'); assert.ok(re.body.ranking.some((x) => x.es_yo));
  const rt = await http('GET', '/api/social/challenges', { token: t });
  assert.ok(rt.body.completados.length >= 1);
});
test('social: validaciones y permisos por HTTP', async () => {
  const t = await login('camila@playfit.test'), doc = await login('docente@playfit.test');
  const mala = await http('POST', '/api/social/sessions', { token: t, body: { ejercicios: [{ ejercicio_id: 1, series: [{ repeticiones: 0 }] }] } });
  assert.equal(mala.status, 400); assert.equal(codigo(mala), 'DATOS_INVALIDOS');
  assert.equal((await http('POST', '/api/social/sessions', { token: doc, body: { ejercicios: [{ ejercicio_id: 1, series: [{ repeticiones: 5 }] }] } })).status, 403);
  assert.equal((await http('GET', '/api/social/squads/abc', { token: t })).status, 400);
  assert.equal((await http('GET', '/api/social/rankings/exercises/999', { token: t })).status, 404);
  const base = { titulo: 'Reto HTTP', descripcion: 'Entrena 3 veces', tipo: 'individual', metrica: 'sesiones', meta: 3, fecha_fin: '2999-01-01' };
  assert.equal((await http('POST', '/api/social/challenges', { token: t, body: base })).status, 403);
  const largo = await http('POST', '/api/social/challenges', { token: doc, body: base });
  assert.equal(largo.status, 400); // dura mas de 90 dias
});
test('social: el docente crea un reto y el estudiante se une', async () => {
  const t = await login('sebastian@playfit.test'), doc = await login('docente@playfit.test');
  const { clock } = require('@playfit/shared');
  const hoy = clock.hoy(), fin = clock.addDays(hoy, 10);
  const c = await http('POST', '/api/social/challenges', { token: doc, body: { titulo: 'Reto del docente', descripcion: 'Entrena 5 dias', tipo: 'individual', metrica: 'dias_activos', meta: 5, fecha_inicio: hoy, fecha_fin: fin } });
  assert.equal(c.status, 201, c.text);
  const j = await http('POST', `/api/social/challenges/${c.body.id}/join`, { token: t });
  assert.equal(j.status, 200); assert.equal(j.body.meta, 5);
  const otra = await http('POST', `/api/social/challenges/${c.body.id}/join`, { token: t });
  assert.equal(otra.status, 409); assert.equal(codigo(otra), 'YA_PARTICIPA');
});
test('social: crear squad, unirse por codigo, ver detalle, comparar y salir', async () => {
  const reg = async (n) => (await http('POST', '/api/auth/register', { body: { nombre: n, apellido: 'Prueba', email: `${n.toLowerCase()}@squad.test`, password: 'Clave12345', consentimientos: { tratamiento_datos: true } } })).body;
  const [a, b] = [await reg('Marta'), await reg('Pablo')];
  const sq = await http('POST', '/api/social/squads', { token: a.accessToken, body: { nombre: 'Los Probadores' } });
  assert.equal(sq.status, 201); assert.match(sq.body.codigo_invitacion, /^[A-Z2-9]{8}$/);
  const dup = await http('POST', '/api/social/squads', { token: a.accessToken, body: { nombre: 'Otro squad' } });
  assert.equal(dup.status, 409);
  const j = await http('POST', '/api/social/squads/join', { token: b.accessToken, body: { codigo: sq.body.codigo_invitacion } });
  assert.equal(j.status, 200); assert.equal(j.body.miembros, 2);
  const mi = await http('GET', '/api/social/squads/me', { token: b.accessToken });
  assert.equal(mi.body.squad.miembros.length, 2); assert.ok(mi.body.squad.codigo_invitacion);
  for (const [tk, reps] of [[a, 20], [b, 10]]) await http('POST', '/api/social/sessions', { token: tk.accessToken, body: { ejercicios: [{ ejercicio_id: 2, series: [{ repeticiones: reps }] }] } });
  const cmp = await http('GET', `/api/social/squads/compare?with=${a.usuario.id}&exercise=2`, { token: b.accessToken });
  assert.equal(cmp.status, 200); assert.equal(cmp.body.resultado, 'pierdes');
  assert.equal((await http('GET', '/api/social/squads/compare', { token: b.accessToken })).status, 400);
  const out = await http('POST', '/api/social/squads/leave', { token: a.accessToken });
  assert.equal(out.body.nuevo_lider_id, b.usuario.id);
  assert.equal((await http('GET', '/api/social/squads/me', { token: a.accessToken })).body.squad, null);
});

// ================= clinico por HTTP =================
test('clinico: el estudiante guarda y lee su historial; flags derivados; todo auditado con IP', async () => {
  const t = await login('valentina@playfit.test');
  const put = await http('PUT', '/api/clinical/students/me/history', { token: t, body: { condiciones: 'Asma leve', lesiones: 'Esguince de rodilla' } });
  assert.equal(put.status, 200);
  assert.deepEqual(put.body.flags.map((f) => f.codigo).sort(), ['ASMA_EJERCICIO', 'LESION_RODILLA', 'RESTRICCION_IMPACTO']);
  const get = await http('GET', '/api/clinical/students/me/history', { token: t });
  assert.equal(get.body.condiciones, 'Asma leve');
  const ex = await http('GET', '/api/clinical/me/exercises', { token: t });
  assert.ok(ex.body.restringidos.some((e) => e.slug === 'sentadilla'));
  const aud = await select("SELECT ip FROM auditoria_accesos WHERE recurso='historial_clinico' AND recurso_id=7 AND accion='leer'");
  assert.ok(aud.length >= 1 && aud[0].ip, 'la auditoria debe guardar la IP del cliente');
});
test('clinico: permisos (otro estudiante, docente del curso, admin) y mediciones', async () => {
  const luis = await login('luis@playfit.test'), doc = await login('docente@playfit.test'), admin = await login('admin@playfit.test'), vale = await login('valentina@playfit.test');
  assert.equal((await http('GET', '/api/clinical/students/7/history', { token: luis })).status, 403);
  assert.equal((await http('GET', '/api/clinical/students/7/history', { token: admin })).status, 403);
  assert.equal((await http('GET', '/api/clinical/students/7/history', { token: doc })).status, 200);
  assert.equal((await http('GET', '/api/clinical/students/xyz/history', { token: doc })).status, 400);
  assert.equal((await http('GET', '/api/clinical/students/7/history')).status, 401);
  const f = await http('PUT', '/api/clinical/students/7/flags', { token: doc, body: { codigos: ['LESION_HOMBRO'] } });
  assert.equal(f.status, 200); assert.equal(f.body[0].origen, 'docente');
  assert.equal((await http('PUT', '/api/clinical/students/7/flags', { token: vale, body: { codigos: ['LESION_HOMBRO'] } })).status, 403);
  const m = await http('POST', '/api/clinical/students/me/measurements', { token: vale, body: { peso_kg: 58, estatura_cm: 163 } });
  assert.equal(m.status, 201); assert.equal(m.body.categoria_imc, 'normal');
  assert.equal((await http('POST', '/api/clinical/students/me/measurements', { token: vale, body: { peso_kg: 5, estatura_cm: 163 } })).status, 400);
  assert.ok((await http('GET', '/api/clinical/students/me/measurements', { token: vale })).body.length >= 2);
});

// ================= contenido e IA por HTTP =================
test('contenido: ejercicios, detalle, tip, nutricion', async () => {
  const t = await login('ana@playfit.test');
  assert.equal((await http('GET', '/api/content/exercises', { token: t })).body.length, 10);
  assert.equal((await http('GET', '/api/content/exercises?group=piernas', { token: t })).body.length, 2);
  assert.equal((await http('GET', '/api/content/exercises?group=raro', { token: t })).status, 400);
  const d = await http('GET', '/api/content/exercises/1', { token: t });
  assert.equal(d.body.pasos.length, 4); assert.deepEqual(d.body.contraindicado_con, ['LESION_RODILLA']);
  assert.ok((await http('GET', '/api/content/exercises/1/tip', { token: t })).body.tip);
  assert.equal((await http('GET', '/api/content/nutrition?category=hidratacion', { token: t })).body.length, 1);
});
test('mascota por HTTP: mensaje segun datos reales y AUSENTE en pantallas clinicas o para docentes', async () => {
  const t = await login('ana@playfit.test'), doc = await login('docente@playfit.test');
  const ok = await http('GET', '/api/content/mascot?context=racha&racha=12&pantalla=dashboard', { token: t });
  assert.equal(ok.body.mensaje.pose, 'yeah');
  const clin = await http('GET', '/api/content/mascot?context=racha&racha=12&pantalla=historial_clinico', { token: t });
  assert.equal(clin.body.mensaje, null);
  assert.equal((await http('GET', '/api/content/mascot?context=racha&racha=12', { token: doc })).body.mensaje, null);
  assert.equal((await http('GET', '/api/content/mascot', { token: t })).status, 400);
  assert.equal((await http('GET', '/api/content/mascot?context=racha&racha=mucho', { token: t })).status, 400);
});
test('IA por HTTP: responde con el modelo, solo manda flags, valida y exige sesion', async () => {
  await http('PUT', '/api/clinical/students/me/history', { token: await login('luis@playfit.test'), body: { condiciones: 'dato-clinico-secreto-ZZZ de rodilla' } });
  const t = await login('luis@playfit.test');
  assert.equal((await http('POST', '/api/content/ai/chat', { body: { mensaje: 'hola' } })).status, 401);
  const r = await http('POST', '/api/content/ai/chat', { token: t, body: { mensaje: 'Que hago de piernas?' } });
  assert.equal(r.status, 200); assert.equal(r.body.respuesta, 'Hazlo con control y sin dolor.');
  const enviado = JSON.stringify(sis.llm.llamadas.at(-1));
  assert.match(enviado, /LESION_RODILLA/); assert.ok(!enviado.includes('dato-clinico-secreto-ZZZ'));
  const r2 = await http('POST', '/api/content/ai/chat', { token: t, body: { mensaje: 'y de espalda?', conversacionId: r.body.conversacion_id } });
  assert.equal(r2.body.conversacion_id, r.body.conversacion_id);
  assert.equal((await http('GET', `/api/content/ai/conversations/${r.body.conversacion_id}`, { token: t })).body.mensajes.length, 4);
  assert.equal((await http('POST', '/api/content/ai/chat', { token: t, body: { mensaje: '' } })).status, 400);
  assert.equal((await http('GET', `/api/content/ai/conversations/${r.body.conversacion_id}`, { token: await login('ana@playfit.test') })).status, 404);
});
test('IA por HTTP: sin modelo configurado -> 503 claro; con cuota agotada -> 429; alarma no llega al modelo', async () => {
  const { createApp } = require('@playfit/content-service/src/app');
  const sinIA = await new Promise((ok) => { const s = createApp({ llm: null }).listen(0, '127.0.0.1', () => ok(s)); });
  try {
    const t = await login('camila@playfit.test');
    const r = await api(`http://127.0.0.1:${sinIA.address().port}`)('POST', '/api/content/ai/chat', { token: t, body: { mensaje: 'hola' } });
    assert.equal(r.status, 503); assert.equal(codigo(r), 'IA_NO_CONFIGURADA');
  } finally { await cerrar(sinIA); }
  const t = await login('sebastian@playfit.test');
  const antes = sis.llm.llamadas.length;
  const a = await http('POST', '/api/content/ai/chat', { token: t, body: { mensaje: 'Siento dolor en el pecho cuando corro' } });
  assert.equal(a.body.alerta_salud, true); assert.equal(sis.llm.llamadas.length, antes);
  for (let i = 0; i < 2; i++) assert.equal((await http('POST', '/api/content/ai/chat', { token: t, body: { mensaje: `pregunta ${i}` } })).status, 200);
  const tope = await http('POST', '/api/content/ai/chat', { token: t, body: { mensaje: 'una mas' } });
  assert.equal(tope.status, 429); assert.equal(codigo(tope), 'CUOTA_IA_AGOTADA');
});

// ================= extras para la app movil =================
test('app: notificaciones (lista, no leidas, marcar leidas)', async () => {
  const t = await login('ana@playfit.test');
  const a = await http('GET', '/api/social/notifications', { token: t });
  assert.equal(a.status, 200); assert.ok(a.body.no_leidas >= 1); assert.ok(a.body.items.length >= 1);
  assert.equal(a.body.items[0].leida, false);
  assert.equal((await http('POST', '/api/social/notifications/read', { token: t })).status, 204);
  const b = await http('GET', '/api/social/notifications', { token: t });
  assert.equal(b.body.no_leidas, 0); assert.ok(b.body.items.every((i) => i.leida === true));
  assert.equal((await http('GET', '/api/social/notifications')).status, 401);
});
test('app: catalogo de insignias marca las obtenidas', async () => {
  const t = await login('ana@playfit.test');
  const r = await http('GET', '/api/social/badges', { token: t });
  assert.equal(r.status, 200); assert.equal(r.body.length, 6);
  assert.equal(r.body.find((b) => b.codigo === 'RACHA_7').obtenida, true);
  assert.equal(r.body.find((b) => b.codigo === 'RACHA_14').obtenida, false);
});
test('app: marcas personales propias y de companeros de squad; no de extranos', async () => {
  const ana = await login('ana@playfit.test');
  const mias = await http('GET', '/api/social/records', { token: ana });
  assert.equal(mias.status, 200); assert.ok(mias.body.length >= 1);
  assert.ok(mias.body.every((m) => m.mejor_peso_kg === null || typeof m.mejor_peso_kg === 'number'));
  const luis = await http('GET', '/api/social/records?student=4', { token: ana });   // mismo squad
  assert.equal(luis.status, 200);
  const ajeno = await http('GET', '/api/social/records?student=7', { token: ana });  // otro squad
  assert.equal(ajeno.status, 403);
  assert.equal((await http('GET', '/api/social/records?student=abc', { token: ana })).status, 400);
});
test('app: detalle de reto (participantes solo del propio squad) y resumen de squad', async () => {
  const ana = await login('ana@playfit.test');
  const d = await http('GET', '/api/social/challenges/2', { token: ana }); // reto de squad (flexiones)
  assert.equal(d.status, 200); assert.equal(d.body.tipo, 'squad'); assert.equal(d.body.participa, true);
  assert.equal(d.body.participantes.length, 4); assert.ok(d.body.participantes.some((p) => p.es_yo));
  assert.equal(d.body.participantes_total, 4);
  const vale = await login('valentina@playfit.test');
  const dv = await http('GET', '/api/social/challenges/2', { token: vale });
  assert.equal(dv.body.participa, false); assert.deepEqual(dv.body.participantes, []); assert.equal(dv.body.puede_unirse, true);
  assert.equal((await http('GET', '/api/social/challenges/999', { token: ana })).status, 404);
  const sq = await http('GET', '/api/social/squads/1', { token: ana });
  assert.ok(sq.body.resumen.racha_combinada >= 12); assert.ok(sq.body.resumen.sesiones_semana >= 1);
  assert.ok(sq.body.miembros.every((m) => typeof m.insignias === 'number'));
});
test('app: eliminar cuenta exige la contrasena, borra los datos y traspasa el liderazgo', async () => {
  const luis = await login('luis@playfit.test');
  assert.equal(codigo(await http('DELETE', '/api/auth/me', { token: luis, body: { password: 'mala' } })), 'CREDENCIALES_INVALIDAS');
  assert.equal((await http('DELETE', '/api/auth/me', { token: await login('docente@playfit.test'), body: { password: 'PlayFit123!' } })).status, 403);
  // Luis (id 4) es miembro; Ana (3) lidera el squad 1. Borramos a Ana: el liderazgo pasa a quien tenga mas XP (Luis).
  const ana = await login('ana@playfit.test');
  const del = await http('DELETE', '/api/auth/me', { token: ana, body: { password: 'PlayFit123!' } });
  assert.equal(del.status, 204);
  assert.equal((await select('SELECT COUNT(*) AS n FROM usuarios WHERE id=3'))[0].n, 0);
  for (const tabla of ['sesiones_entrenamiento', 'perfil_gamificacion', 'historiales_clinicos', 'consentimientos', 'notificaciones', 'refresh_tokens'])
    assert.equal((await select(`SELECT COUNT(*) AS n FROM ${tabla} WHERE ${tabla === 'perfil_gamificacion' ? 'estudiante_id' : tabla === 'sesiones_entrenamiento' || tabla === 'historiales_clinicos' ? 'estudiante_id' : 'usuario_id'}=3`))[0].n, 0, tabla);
  assert.equal((await select('SELECT lider_id FROM squads WHERE id=1'))[0].lider_id, 4);
  assert.equal(codigo(await http('POST', '/api/auth/login', { body: { email: 'ana@playfit.test', password: 'PlayFit123!' } })), 'CREDENCIALES_INVALIDAS');
  const aud = await select("SELECT usuario_id FROM auditoria_accesos WHERE accion='eliminar' AND recurso='usuario' AND recurso_id=3");
  assert.equal(aud.length, 1); assert.equal(aud[0].usuario_id, null); // la bitacora queda, anonimizada
});
