const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const S = require('./_setup');
const auth = require('@playfit/auth-service');
const { one, rbac } = require('@playfit/shared');

before(S.preparar); after(S.cerrar);
const rechaza = (p, code) => assert.rejects(p, (e) => { assert.equal(e.code, code, `esperaba ${code}, llego ${e.code}: ${e.message}`); return true; });

test('registro exitoso crea usuario, consentimientos y tokens', async () => {
  const r = await auth.registrarEstudiante({ nombre: 'Nuevo', apellido: 'Usuario', email: 'Nuevo@Test.com', password: 'Clave1234', codigo_estudiantil: 'EST9999',
    consentimientos: { tratamiento_datos: true, mayoria_edad: true, datos_salud: true, ia_chatbot: false } });
  assert.equal(r.usuario.email, 'nuevo@test.com');
  assert.equal(r.usuario.rol, 'estudiante');
  assert.ok(r.accessToken && r.refreshToken);
  assert.equal(await auth.tieneConsentimiento(r.usuario.id, 'datos_salud'), true);
  assert.equal(await auth.tieneConsentimiento(r.usuario.id, 'ia_chatbot'), false);
  const fila = await one('SELECT password_hash FROM usuarios WHERE id=:id', { id: r.usuario.id });
  assert.match(fila.password_hash, /^\$2[aby]\$/); // bcrypt, nunca texto plano
});
test('registro rechaza correo repetido, password debil, sin consentimiento y correo invalido', async () => {
  const base = { nombre: 'Ana', apellido: 'Xx', email: 'otro@test.com', password: 'Clave1234', consentimientos: { tratamiento_datos: true, mayoria_edad: true } };
  await rechaza(auth.registrarEstudiante({ ...base, email: 'ana@playfit.test' }), 'EMAIL_EN_USO');
  await rechaza(auth.registrarEstudiante({ ...base, password: 'corta1' }), 'PASSWORD_DEBIL');
  await rechaza(auth.registrarEstudiante({ ...base, password: 'sololetrasss' }), 'PASSWORD_DEBIL');
  await rechaza(auth.registrarEstudiante({ ...base, consentimientos: {} }), 'CONSENTIMIENTO_REQUERIDO');
  await rechaza(auth.registrarEstudiante({ ...base, consentimientos: { tratamiento_datos: true } }), 'EDAD_REQUERIDA');
  await rechaza(auth.registrarEstudiante({ ...base, consentimientos: { tratamiento_datos: true, mayoria_edad: false } }), 'EDAD_REQUERIDA');
  await rechaza(auth.registrarEstudiante({ ...base, email: 'no-es-correo' }), 'EMAIL_INVALIDO');
  await rechaza(auth.registrarEstudiante({ ...base, codigo_estudiantil: '20231001' }), 'CODIGO_EN_USO');
});
test('login correcto con la contrasena del seed y token verificable', async () => {
  const r = await auth.login('ana@playfit.test', 'PlayFit123!');
  assert.deepEqual(auth.verificarAccessToken(r.accessToken), { id: 3, rol: 'estudiante' });
  assert.ok((await one('SELECT ultimo_login FROM usuarios WHERE id=3')).ultimo_login);
});
test('login falla con password mala, correo inexistente y cuenta desactivada (mismo error)', async () => {
  await rechaza(auth.login('ana@playfit.test', 'mala'), 'CREDENCIALES_INVALIDAS');
  await rechaza(auth.login('nadie@playfit.test', 'PlayFit123!'), 'CREDENCIALES_INVALIDAS');
  await auth.cambiarEstadoUsuario(S.ADMIN, 8, false);
  await rechaza(auth.login('sebastian@playfit.test', 'PlayFit123!'), 'CREDENCIALES_INVALIDAS');
  await auth.cambiarEstadoUsuario(S.ADMIN, 8, true);
});
test('token manipulado o falso es rechazado', async () => {
  await rechaza(Promise.resolve().then(() => auth.verificarAccessToken('abc.def.ghi')), 'TOKEN_INVALIDO');
  const r = await auth.login('ana@playfit.test', 'PlayFit123!');
  await rechaza(Promise.resolve().then(() => auth.verificarAccessToken(r.accessToken.slice(0, -3) + 'abc')), 'TOKEN_INVALIDO');
});
test('refresh rota el token; reusar uno viejo cierra TODAS las sesiones', async () => {
  const a = await auth.login('luis@playfit.test', 'PlayFit123!');
  const b = await auth.refrescar(a.refreshToken);
  assert.notEqual(b.refreshToken, a.refreshToken);
  await rechaza(auth.refrescar(a.refreshToken), 'TOKEN_REUTILIZADO'); // reuso => robo posible
  await rechaza(auth.refrescar(b.refreshToken), 'TOKEN_REUTILIZADO'); // el nuevo tambien quedo revocado
});
test('logout revoca el refresh token', async () => {
  const a = await auth.login('camila@playfit.test', 'PlayFit123!');
  await auth.logout(a.refreshToken);
  await rechaza(auth.refrescar(a.refreshToken), 'TOKEN_REUTILIZADO');
});
test('consentimientos: el ultimo registro manda (revocar funciona)', async () => {
  await auth.registrarConsentimiento(S.ANA, 'ia_chatbot', true);
  assert.equal(await auth.tieneConsentimiento(3, 'ia_chatbot'), true);
  await auth.registrarConsentimiento(S.ANA, 'ia_chatbot', false);
  assert.equal(await auth.tieneConsentimiento(3, 'ia_chatbot'), false);
  await rechaza(auth.registrarConsentimiento(S.ANA, 'inventado', true), 'DATOS_INVALIDOS');
});
test('cambiar password exige la actual y revoca sesiones', async () => {
  const a = await auth.login('valentina@playfit.test', 'PlayFit123!');
  await rechaza(auth.cambiarPassword(S.VALE, 'equivocada', 'Nueva12345'), 'CREDENCIALES_INVALIDAS');
  await auth.cambiarPassword(S.VALE, 'PlayFit123!', 'Nueva12345');
  await rechaza(auth.refrescar(a.refreshToken), 'TOKEN_REUTILIZADO');
  await auth.login('valentina@playfit.test', 'Nueva12345');
});
test('RBAC: solo admin crea cuentas de admin; no existe el rol docente', async () => {
  const d = await auth.crearUsuarioStaff(S.ADMIN, { rol: 'admin', nombre: 'Pedro', apellido: 'Gomez', email: 'pedro@playfit.test', password: 'Admin12345' });
  assert.equal(d.rol, 'admin');
  await rechaza(auth.crearUsuarioStaff(S.ADMIN, { rol: 'docente', nombre: 'X', apellido: 'Y', email: 'x@y.com', password: 'Admin12345' }), 'DATOS_INVALIDOS');
  await rechaza(auth.crearUsuarioStaff(S.ANA, { rol: 'admin', nombre: 'X', apellido: 'Y', email: 'x@y.com', password: 'Admin12345' }), 'PROHIBIDO');
  await rechaza(auth.cambiarEstadoUsuario(S.ADMIN, 1, false), 'DATOS_INVALIDOS'); // no puede desactivarse a si mismo
  assert.equal(rbac.can('admin', 'clinico:leer_propio'), false);
  assert.equal(rbac.can('admin', 'reto:crear'), true);
  assert.equal(rbac.can('docente', 'reto:crear'), false);
});
