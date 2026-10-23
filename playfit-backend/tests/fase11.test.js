// Fase 11: consentimiento con evidencia, 2FA (TOTP), codigos de respaldo, recuperacion de contrasena y panel admin.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const S = require('./_setup');
const auth = require('@playfit/auth-service');
const seg = require('@playfit/auth-service/src/seguridad');
const adminSvc = require('@playfit/auth-service/src/admin');
const totp = require('@playfit/auth-service/src/totp');
const mailer = require('@playfit/auth-service/src/mailer');
const textos = require('@playfit/auth-service/src/consentTexts');
const { sentencias } = require('@playfit/shared/src/migrate');
const { one, select, sequelize } = require('@playfit/shared');

before(S.preparar); after(S.cerrar);
const rechaza = (p, code) => assert.rejects(p, (e) => { assert.equal(e.code, code, `esperaba ${code}, llego ${e.code}: ${e.message}`); return true; });
const PASS = 'PlayFit123!';
const secretoDe = async (id) => totp.descifrar((await one('SELECT totp_secreto_cifrado AS s FROM usuarios WHERE id=:id', { id })).s);
// el codigo de otro paso de 30 s (el servicio acepta +-1 paso y NO deja reutilizar un paso ya usado)
const otroPaso = async (id) => { await sequelize.query('UPDATE usuarios SET totp_ultimo_paso=totp_ultimo_paso-10 WHERE id=:id', { replacements: { id } }); };

// ---------- piezas sueltas (no necesitan BD) ----------
test('TOTP: coincide con los vectores de la RFC 6238 y tolera +-1 paso', () => {
  const s = totp.base32(Buffer.from('12345678901234567890'));
  assert.equal(totp.codigoActual(s, 59000), '287082');
  assert.equal(totp.codigoActual(s, 1111111109000), '081804');
  assert.equal(totp.verificar(s, '287082', { ahoyMs: 59000 }), 1);
  assert.equal(totp.verificar(s, '287082', { ahoyMs: 59000 + 30000 }), 1);      // un paso despues
  assert.equal(totp.verificar(s, '287082', { ahoyMs: 59000 + 90000 }), null);   // tres pasos: fuera de la ventana
  assert.equal(totp.verificar(s, '287082', { ahoyMs: 59000, ultimoPaso: 1 }), null); // ya usado
  assert.equal(totp.verificar(s, 'abc123', { ahoyMs: 59000 }), null);
  assert.equal(totp.descifrar(totp.cifrar('SECRETO')), 'SECRETO');
});
test('migraciones: el parser separa sentencias y descarta comentarios', () => {
  const r = sentencias('-- hola; mundo\nALTER TABLE a ADD b INT;\nCREATE TABLE c (x INT);\n');
  assert.deepEqual(r, ['ALTER TABLE a ADD b INT', 'CREATE TABLE c (x INT)']);
});

// ---------- consentimiento ----------
test('consentimiento: los textos publicos tienen version y hash, y el registro guarda evidencia', async () => {
  const pub = textos.publico();
  assert.equal(pub.textos.length, 5);
  assert.deepEqual(pub.textos.filter((t) => t.obligatorio).map((t) => t.tipo), ['tratamiento_datos', 'mayoria_edad']);
  assert.ok(pub.textos.every((t) => /^[0-9a-f]{64}$/.test(t.hash)));
  const r = await auth.registrarEstudiante({ nombre: 'Eva', apellido: 'Mora', email: 'eva@playfit.test', password: 'Clave12345',
    consentimientos: { tratamiento_datos: true, mayoria_edad: true, datos_salud: false, uso_camara: true } }, { ip: '10.0.0.7' });
  const filas = await select('SELECT tipo,aceptado,version_politica,texto_hash,ip FROM consentimientos WHERE usuario_id=:u ORDER BY id', { u: r.usuario.id });
  assert.equal(filas.length, 4);
  const edad = filas.find((f) => f.tipo === 'mayoria_edad');
  assert.equal(edad.aceptado, 1); assert.equal(edad.version_politica, textos.VERSION);
  assert.equal(edad.texto_hash, textos.porTipo.mayoria_edad.hash); assert.equal(edad.ip, '10.0.0.7');
  assert.equal(filas.find((f) => f.tipo === 'datos_salud').aceptado, 0);
});
test('consentimiento: si la app tiene textos viejos, el registro se rechaza', async () => {
  const base = { nombre: 'Old', apellido: 'Texto', email: 'old@playfit.test', password: 'Clave12345', consentimientos: { tratamiento_datos: true, mayoria_edad: true } };
  await rechaza(auth.registrarEstudiante({ ...base, version_consentimiento: '0.1' }), 'TEXTOS_DESACTUALIZADOS');
  assert.ok((await auth.registrarEstudiante({ ...base, version_consentimiento: textos.VERSION })).accessToken);
});
test('consentimiento: la declaracion de edad no se puede retirar', async () => {
  await rechaza(auth.registrarConsentimiento(S.ANA, 'mayoria_edad', false), 'DATOS_INVALIDOS');
  await auth.registrarConsentimiento(S.ANA, 'uso_camara', false, { ip: '1.2.3.4' });
  assert.equal(await auth.tieneConsentimiento(3, 'uso_camara'), false);
});

// ---------- 2FA ----------
test('2FA opcional: activar, iniciar sesion en dos pasos, codigo repetido y codigos de respaldo', async () => {
  const st0 = await seg.estado2fa(S.LUIS);
  assert.equal(st0.activo, false); assert.equal(st0.obligatorio, false);
  assert.equal((await auth.login('luis@playfit.test', PASS)).accessToken !== undefined, true); // sin 2FA entra directo
  const cfg = await seg.configurar2fa(S.LUIS);
  assert.match(cfg.otpauth_uri, /^otpauth:\/\/totp\/PlayFit:luis%40playfit\.test\?secret=[A-Z2-7]{32}/);
  await rechaza(seg.activar2fa(S.LUIS, '000000'), 'CODIGO_2FA_INVALIDO');
  const { codigos_respaldo } = await seg.activar2fa(S.LUIS, totp.codigoActual(cfg.secreto));
  assert.equal(codigos_respaldo.length, 8);
  await rechaza(seg.configurar2fa(S.LUIS), 'YA_ACTIVO');
  // el secreto NO queda en claro en la base
  const f = await one('SELECT totp_secreto_cifrado AS s, totp_pendiente_cifrado AS p FROM usuarios WHERE id=4');
  assert.ok(!f.s.includes(cfg.secreto)); assert.equal(f.p, null);

  const paso1 = await auth.login('luis@playfit.test', PASS);
  assert.equal(paso1.requiere_2fa, true); assert.equal(paso1.accessToken, undefined);
  // el desafio NO sirve como access token
  assert.throws(() => auth.verificarAccessToken(paso1.desafio), (e) => e.code === 'TOKEN_INVALIDO');
  await otroPaso(4);
  const ok = await seg.loginConCodigo(paso1.desafio, totp.codigoActual(cfg.secreto));
  assert.ok(ok.accessToken && ok.refreshToken); assert.equal(ok.usuario.dos_factores, true);
  // repetir el MISMO codigo no vale (anti-repeticion)
  await rechaza(seg.loginConCodigo(paso1.desafio, totp.codigoActual(cfg.secreto)), 'CODIGO_2FA_INVALIDO');
  // un codigo de respaldo vale una sola vez
  const bk = codigos_respaldo[0];
  assert.ok((await seg.loginConCodigo(paso1.desafio, bk)).accessToken);
  await rechaza(seg.loginConCodigo(paso1.desafio, bk), 'CODIGO_2FA_INVALIDO');
  assert.equal((await seg.estado2fa(S.LUIS)).codigos_respaldo_disponibles, 7);
  // un desafio inventado o de otro tipo se rechaza
  await rechaza(seg.loginConCodigo('basura', '123456'), 'DESAFIO_INVALIDO');
  await rechaza(seg.loginConCodigo(seg.firmarDesafio(4, 'setup'), '123456'), 'DESAFIO_INVALIDO');
});
test('2FA: codigos incorrectos repetidos bloquean temporalmente (aunque luego pongas el bueno)', async () => {
  const cfg = await seg.configurar2fa(S.CAMILA);
  await seg.activar2fa(S.CAMILA, totp.codigoActual(cfg.secreto));
  const d = (await auth.login('camila@playfit.test', PASS)).desafio;
  for (let i = 0; i < 5; i++) await rechaza(seg.loginConCodigo(d, '111111'), 'CODIGO_2FA_INVALIDO');
  await otroPaso(5);
  await rechaza(seg.loginConCodigo(d, totp.codigoActual(cfg.secreto)), 'CUENTA_BLOQUEADA_TEMPORAL');
});
test('2FA: desactivar exige contrasena y un codigo; regenerar respaldo invalida los viejos', async () => {
  const cfg = await seg.configurar2fa(S.ANDRES);
  const { codigos_respaldo } = await seg.activar2fa(S.ANDRES, totp.codigoActual(cfg.secreto));
  await otroPaso(6);
  const nuevos = await seg.regenerarRespaldo(S.ANDRES, totp.codigoActual(cfg.secreto));
  assert.equal(nuevos.codigos_respaldo.length, 8);
  const d = (await auth.login('andres@playfit.test', PASS)).desafio;
  await rechaza(seg.loginConCodigo(d, codigos_respaldo[1]), 'CODIGO_2FA_INVALIDO'); // codigo viejo
  assert.ok((await seg.loginConCodigo(d, nuevos.codigos_respaldo[1])).accessToken);
  await rechaza(seg.desactivar2fa(S.ANDRES, 'mala', nuevos.codigos_respaldo[2]), 'CREDENCIALES_INVALIDAS');
  await rechaza(seg.desactivar2fa(S.ANDRES, PASS, '000000'), 'CODIGO_2FA_INVALIDO');
  await seg.desactivar2fa(S.ANDRES, PASS, nuevos.codigos_respaldo[2]);
  assert.equal((await seg.estado2fa(S.ANDRES)).activo, false);
  assert.equal((await auth.login('andres@playfit.test', PASS)).accessToken !== undefined, true);
});
test('2FA del admin: obligatorio. Sin 2FA configura y entra en el mismo paso; luego siempre lo pide', async () => {
  process.env.ADMIN_2FA_OBLIGATORIO = '1';
  try {
    assert.equal((await seg.estado2fa(S.ADMIN)).obligatorio, true);
    const p1 = await auth.login('admin@playfit.test', PASS);
    assert.equal(p1.requiere_configurar_2fa, true); assert.equal(p1.accessToken, undefined);
    const cfg = await seg.iniciarConfiguracionInicial(p1.desafio);
    await rechaza(seg.confirmarConfiguracionInicial(p1.desafio, '000000'), 'CODIGO_2FA_INVALIDO');
    const sesion = await seg.confirmarConfiguracionInicial(p1.desafio, totp.codigoActual(cfg.secreto));
    assert.ok(sesion.accessToken); assert.equal(sesion.codigos_respaldo.length, 8);
    // la proxima vez ya pide el codigo
    const p2 = await auth.login('admin@playfit.test', PASS);
    assert.equal(p2.requiere_2fa, true);
    await rechaza(seg.desactivar2fa(S.ADMIN, PASS, sesion.codigos_respaldo[0]), 'DOS_FACTORES_OBLIGATORIO');
    // el desafio de "login" no permite configurar ni al reves
    await rechaza(seg.iniciarConfiguracionInicial(p2.desafio), 'DESAFIO_INVALIDO');
    // el admin puede ayudar a otro usuario que perdio su celular
    await rechaza(seg.restablecer2faDe(S.ADMIN, 1), 'DATOS_INVALIDOS');
    await rechaza(seg.restablecer2faDe(S.ANA, 4), 'PROHIBIDO');
    await seg.restablecer2faDe(S.ADMIN, 4);
    assert.equal((await seg.estado2fa(S.LUIS)).activo, false);
    const aud = await select("SELECT usuario_id FROM auditoria_accesos WHERE recurso='seguridad_2fa' AND recurso_id=4");
    assert.ok(aud.some((a) => a.usuario_id === 1));
  } finally { process.env.ADMIN_2FA_OBLIGATORIO = '0'; }
});

// ---------- recuperacion de contrasena ----------
test('recuperacion: respuesta generica, codigo de un solo uso, intentos limitados y cierra sesiones', async () => {
  const correos = [];
  mailer.setTransporte(async (c) => { correos.push(c); });
  try {
    const desconocido = await seg.solicitarRecuperacion('nadie@playfit.test');
    const conocido = await seg.solicitarRecuperacion('valentina@playfit.test');
    assert.deepEqual(desconocido, conocido);             // no revela que correos existen
    assert.equal(correos.length, 1); assert.equal(correos[0].para, 'valentina@playfit.test');
    const cod = /(\d{6})/.exec(correos[0].texto)[1];
    const f = await one("SELECT codigo_hash FROM codigos_verificacion WHERE usuario_id=7");
    assert.ok(!f.codigo_hash.includes(cod) && f.codigo_hash.length === 64); // no se guarda en claro

    const sesion = await auth.login('valentina@playfit.test', PASS);
    await rechaza(seg.restablecerPassword('valentina@playfit.test', '000000', 'Nueva12345'), 'CODIGO_INVALIDO');
    await rechaza(seg.restablecerPassword('valentina@playfit.test', cod, 'corta'), 'PASSWORD_DEBIL');
    await seg.restablecerPassword('valentina@playfit.test', cod, 'Nueva12345');
    await rechaza(seg.restablecerPassword('valentina@playfit.test', cod, 'Otra123456'), 'CODIGO_INVALIDO'); // un solo uso
    await rechaza(auth.login('valentina@playfit.test', PASS), 'CREDENCIALES_INVALIDAS');
    assert.ok((await auth.login('valentina@playfit.test', 'Nueva12345')).accessToken);
    await rechaza(auth.refrescar(sesion.refreshToken), 'TOKEN_REUTILIZADO');

    // 5 intentos fallidos invalidan el codigo aunque despues pongas el correcto
    await seg.solicitarRecuperacion('sebastian@playfit.test');
    const cod2 = /(\d{6})/.exec(correos[correos.length - 1].texto)[1];
    for (let i = 0; i < 5; i++) await rechaza(seg.restablecerPassword('sebastian@playfit.test', cod2 === '999999' ? '888888' : '999999', 'Nueva12345'), 'CODIGO_INVALIDO');
    await rechaza(seg.restablecerPassword('sebastian@playfit.test', cod2, 'Nueva12345'), 'CODIGO_INVALIDO');

    // un codigo nuevo invalida el anterior y hay maximo 3 correos por hora
    await seg.solicitarRecuperacion('camila@playfit.test');
    const a = /(\d{6})/.exec(correos[correos.length - 1].texto)[1];
    await seg.solicitarRecuperacion('camila@playfit.test');
    const b = /(\d{6})/.exec(correos[correos.length - 1].texto)[1];
    if (a !== b) await rechaza(seg.restablecerPassword('camila@playfit.test', a, 'Nueva12345'), 'CODIGO_INVALIDO');
    await seg.solicitarRecuperacion('camila@playfit.test');
    const antes = correos.length;
    await seg.solicitarRecuperacion('camila@playfit.test'); // 4to en la hora: se ignora
    assert.equal(correos.length, antes);
  } finally { mailer.setTransporte(null); }
});
test('recuperacion: desbloquea una cuenta bloqueada por intentos fallidos', async () => {
  const correos = [];
  mailer.setTransporte(async (c) => { correos.push(c); });
  try {
    for (let i = 0; i < 5; i++) await rechaza(auth.login('luis@playfit.test', 'mala'), 'CREDENCIALES_INVALIDAS');
    await rechaza(auth.login('luis@playfit.test', PASS), 'CUENTA_BLOQUEADA_TEMPORAL');
    await seg.solicitarRecuperacion('luis@playfit.test');
    await seg.restablecerPassword('luis@playfit.test', /(\d{6})/.exec(correos[0].texto)[1], 'Desbloqueo123');
    assert.ok((await auth.login('luis@playfit.test', 'Desbloqueo123')).accessToken);
  } finally { mailer.setTransporte(null); }
});

// ---------- panel admin ----------
test('admin: auditoria y metricas agregadas; los demas roles no entran', async () => {
  const aud = await adminSvc.auditoria(S.ADMIN, { limite: 50 });
  assert.ok(aud.length > 0 && aud[0].id > aud[aud.length - 1].id); // mas reciente primero
  assert.ok((await adminSvc.auditoria(S.ADMIN, { recurso: 'seguridad_2fa' })).every((a) => a.recurso === 'seguridad_2fa'));
  const m = await adminSvc.metricas(S.ADMIN);
  assert.ok(m.usuarios_total >= 6); assert.ok(m.sesiones_total > 0);
  assert.ok(Array.isArray(m.sesiones_por_semana)); assert.equal(typeof m.usuarios_con_2fa, 'number');
  assert.ok(!JSON.stringify(m).includes('@'), 'las metricas son anonimas: sin correos');
  await rechaza(adminSvc.auditoria(S.ANA), 'PROHIBIDO');
  await rechaza(adminSvc.metricas(S.ANA), 'PROHIBIDO');
});
test('el rol docente ya no existe en el esquema', async () => {
  const roles = (await select('SELECT nombre FROM roles ORDER BY id')).map((r) => r.nombre);
  assert.deepEqual(roles, ['estudiante', 'admin']);
  // El esquema nuevo no define cursos (una BD antigua puede conservar las tablas sin uso, por eso se revisa el archivo)
  const sql = require('fs').readFileSync(require('path').join(__dirname, '..', 'database', '01_schema.sql'), 'utf8');
  assert.ok(!/CREATE TABLE[^;]*\bcursos\b/i.test(sql) && !/\bcurso_estudiantes\b/.test(sql) && !/\bcurso_id\b/.test(sql));
});

test('admin: lista y desactiva retos oficiales; un usuario no puede', async () => {
  const soc = require('@playfit/social-service');
  const lista = await soc.listarRetosAdmin(S.ADMIN);
  assert.ok(lista.length >= 4 && lista.every((r) => 'participantes' in r && 'completados' in r));
  await rechaza(soc.listarRetosAdmin(S.ANA), 'PROHIBIDO');
  await soc.cambiarEstadoReto(S.ADMIN, lista[0].id, false);
  assert.equal(Number((await one('SELECT activo FROM retos WHERE id=:id', { id: lista[0].id })).activo), 0);
  await rechaza(soc.cambiarEstadoReto(S.ADMIN, 99999, false), 'NO_ENCONTRADO');
  await rechaza(soc.cambiarEstadoReto(S.ANA, lista[0].id, true), 'PROHIBIDO');
});
