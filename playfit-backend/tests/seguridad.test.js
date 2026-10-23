// Fase 7 · Seguridad: bloqueo temporal por cuenta, tokens de cuentas desactivadas/eliminadas, 503 si cae la BD.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const S = require('./_setup');
const { levantar, api } = require('./_http');
const { run, select, http: httpLib } = require('@playfit/shared');
const express = require('express');

let sis, http;
before(async () => { await S.preparar(); sis = await levantar(); http = api(sis.base); });
after(async () => { await sis.cerrar(); await S.cerrar(); });

const codigo = (r) => r.body && r.body.error && r.body.error.code;
const intentar = (email, password) => http('POST', '/api/auth/login', { body: { email, password } });
const login = async (email) => { const r = await intentar(email, 'PlayFit123!'); assert.equal(r.status, 200, r.text); return r.body.accessToken; };

test('login: tras 5 fallos la cuenta se bloquea temporalmente, incluso con la contrasena correcta', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await intentar('camila@playfit.test', 'mala1234')).status, 401);
  const r = await intentar('camila@playfit.test', 'PlayFit123!');
  assert.equal(r.status, 429); assert.equal(codigo(r), 'CUENTA_BLOQUEADA_TEMPORAL');
  assert.equal((await intentar('luis@playfit.test', 'PlayFit123!')).status, 200, 'otra cuenta no se ve afectada');
});
test('login: el bloqueo vive en la BD (no en memoria) y se levanta al pasar la ventana', async () => {
  const n = await select("SELECT COUNT(*) AS n FROM intentos_login WHERE email='camila@playfit.test'");
  assert.equal(Number(n[0].n), 5);
  await run("UPDATE intentos_login SET creado_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 20 MINUTE) WHERE email='camila@playfit.test'");
  assert.equal((await intentar('camila@playfit.test', 'PlayFit123!')).status, 200);
});
test('login: un acierto antes del umbral reinicia el contador', async () => {
  for (let i = 0; i < 4; i++) await intentar('andres@playfit.test', 'mala1234');
  assert.equal((await intentar('andres@playfit.test', 'PlayFit123!')).status, 200);
  for (let i = 0; i < 4; i++) assert.equal((await intentar('andres@playfit.test', 'mala1234')).status, 401);
  assert.equal((await intentar('andres@playfit.test', 'PlayFit123!')).status, 200);
});
test('login: un correo que no existe se bloquea igual (no revela que cuentas existen)', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await intentar('fantasma@playfit.test', 'mala1234')).status, 401);
  const r = await intentar('fantasma@playfit.test', 'mala1234');
  assert.equal(r.status, 429); assert.equal(codigo(r), 'CUENTA_BLOQUEADA_TEMPORAL');
});
test('login: el correo se normaliza (mayusculas y espacios cuentan como el mismo correo)', async () => {
  for (let i = 0; i < 5; i++) await intentar('  VALENTINA@playfit.test ', 'mala1234');
  assert.equal(codigo(await intentar('valentina@playfit.test', 'PlayFit123!')), 'CUENTA_BLOQUEADA_TEMPORAL');
});

test('tokens: al desactivar una cuenta su access token deja de servir de inmediato', async () => {
  const admin = await login('admin@playfit.test');
  const tSebas = await login('sebastian@playfit.test');
  assert.equal((await http('GET', '/api/auth/me', { token: tSebas })).status, 200);
  assert.equal((await http('PATCH', '/api/auth/users/8', { token: admin, body: { activo: false } })).status, 204);
  const r = await http('GET', '/api/social/dashboard', { token: tSebas });
  assert.equal(r.status, 401); assert.equal(codigo(r), 'CUENTA_INACTIVA');
  assert.equal((await http('GET', '/api/content/exercises', { token: tSebas })).status, 401, 'tambien en los otros servicios');
});
test('tokens: una cuenta eliminada ya no puede usar su token', async () => {
  const t = await login('luis@playfit.test');
  const del = await http('DELETE', '/api/auth/me', { token: t, body: { password: 'PlayFit123!' } });
  assert.equal(del.status, 204);
  const r = await http('GET', '/api/auth/me', { token: t });
  assert.equal(r.status, 401); assert.equal(codigo(r), 'TOKEN_INVALIDO');
});

test('registro: contrasena de mas de 72 bytes (acentos cuentan doble) se rechaza con mensaje claro', async () => {
  const r = await http('POST', '/api/auth/register', { body: {
    nombre: 'Nuevo', apellido: 'Usuario', email: 'largo@playfit.test', password: 'á'.repeat(40) + '1', consentimientos: { tratamiento_datos: true, mayoria_edad: true } } });
  assert.equal(r.status, 400); assert.equal(codigo(r), 'PASSWORD_DEBIL');
});

test('gateway: los logins CORRECTOS no gastan el limite de intentos (solo los fallidos)', async () => {
  const g = await sis.levantarGateway({ limiteAuth: 3, limiteGlobal: 1000 });
  try {
    const h = api(g.base);
    for (let i = 0; i < 6; i++) assert.equal((await h('POST', '/api/auth/login', { body: { email: 'ana@playfit.test', password: 'PlayFit123!' } })).status, 200);
  } finally { await g.cerrar(); }
});

test('errores: si la base de datos no responde el cliente recibe 503 claro, no "error interno"', async () => {
  const { ConnectionRefusedError } = require('sequelize');
  const app = httpLib.createServiceApp('prueba', (a) => {
    a.get('/boom', (req, res, next) => next(new ConnectionRefusedError(new Error('connect ECONNREFUSED 127.0.0.1:3307'))));
    a.get('/bug', (req, res, next) => next(new Error('fallo cualquiera')));
  });
  const srv = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  try {
    const h = api(`http://127.0.0.1:${srv.address().port}`);
    const a = await h('GET', '/boom');
    assert.equal(a.status, 503); assert.equal(codigo(a), 'BASE_DE_DATOS_NO_DISPONIBLE');
    const b = await h('GET', '/bug');
    assert.equal(b.status, 500); assert.equal(codigo(b), 'ERROR_INTERNO');
  } finally { await new Promise((ok) => srv.close(ok)); }
});
