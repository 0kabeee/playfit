// Fase 12 por HTTP real (gateway + servicios): rutas de retos de squad, duelos y soporte.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const S = require('./_setup');
const { levantar, api } = require('./_http');

let sis, http;
before(async () => { await S.preparar(); sis = await levantar(); http = api(sis.base); });
after(async () => { await sis.cerrar(); await S.cerrar(); });

const login = async (email) => {
  const r = await http('POST', '/api/auth/login', { body: { email, password: 'PlayFit123!' } });
  assert.equal(r.status, 200, `login ${email}: ${r.text}`);
  return r.body.accessToken;
};
const codigo = (r) => r.body && r.body.error && r.body.error.code;

test('http: crear y cancelar un reto de squad; otro squad no lo ve', async () => {
  const ana = await login('ana@playfit.test'), vale = await login('valentina@playfit.test');
  const c = await http('POST', '/api/social/squads/me/challenges', { token: ana, body: { titulo: 'Reto HTTP', metrica: 'sesiones', meta: 2, dias: 3 } });
  assert.equal(c.status, 201, c.text);
  assert.equal((await http('GET', `/api/social/challenges/${c.body.id}`, { token: vale })).status, 404);
  assert.equal((await http('GET', `/api/social/challenges/${c.body.id}`, { token: ana })).status, 200);
  assert.equal((await http('DELETE', `/api/social/challenges/${c.body.id}`, { token: vale })).status, 404);
  assert.equal((await http('DELETE', `/api/social/challenges/${c.body.id}`, { token: ana })).status, 204);
  const mal = await http('POST', '/api/social/squads/me/challenges', { token: ana, body: { titulo: 'x', metrica: 'sesiones', meta: 2, dias: 3 } });
  assert.equal(mal.status, 400);
});

test('http: duelo de punta a punta (retar, listar, aceptar)', async () => {
  const ana = await login('ana@playfit.test'), luis = await login('luis@playfit.test');
  const d = await http('POST', '/api/social/duels', { token: ana, body: { rival_id: 4, metrica: 'sesiones', dias: 2 } });
  assert.equal(d.status, 201, d.text);
  const l = await http('GET', '/api/social/duels', { token: luis });
  assert.equal(l.status, 200); assert.equal(l.body.recibidos.length, 1);
  assert.equal(codigo(await http('POST', `/api/social/duels/${d.body.id}/respond`, { token: luis, body: { aceptar: 'si' } })), 'DATOS_INVALIDOS');
  const r = await http('POST', `/api/social/duels/${d.body.id}/respond`, { token: luis, body: { aceptar: true } });
  assert.equal(r.status, 200); assert.equal(r.body.estado, 'activo');
  assert.equal((await http('POST', `/api/social/duels/${d.body.id}/cancel`, { token: ana })).status, 409);
});

test('http: soporte usuario -> transferencia por pago -> bandeja y respuesta del admin', async () => {
  const camila = await login('camila@playfit.test'), admin = await login('admin@playfit.test');
  assert.equal((await http('GET', '/api/social/support', { token: camila })).body.conversacion, null);
  const m = await http('POST', '/api/social/support/messages', { token: camila, body: { mensaje: 'Me cobraron el Premium dos veces' } });
  assert.equal(m.status, 201); assert.equal(m.body.transferida, true);
  assert.equal((await http('GET', '/api/social/admin/support', { token: camila })).status, 403);
  const b = await http('GET', '/api/social/admin/support', { token: admin });
  assert.equal(b.status, 200); assert.ok(b.body.pendientes >= 1);
  const id = b.body.conversaciones[0].id;
  const resp = await http('POST', `/api/social/admin/support/${id}/messages`, { token: admin, body: { mensaje: 'Ya reviso tu caso' } });
  assert.equal(resp.status, 201); assert.equal(resp.body.estado, 'atendiendo');
  const mio = await http('GET', '/api/social/support', { token: camila });
  assert.equal(mio.body.conversacion.mensajes.at(-1).contenido, 'Ya reviso tu caso');
  assert.equal((await http('POST', `/api/social/admin/support/${id}/close`, { token: admin })).status, 204);
  assert.equal((await http('POST', '/api/social/support/close', { token: camila })).status, 404);
});

test('http: el chat de IA transfiere los pagos a soporte', async () => {
  const vale = await login('valentina@playfit.test');
  const llamadasAntes = sis.llm.llamadas.length;
  const r = await http('POST', '/api/content/ai/chat', { token: vale, body: { mensaje: 'Quiero pagar el Premium' } });
  assert.equal(r.status, 200, r.text); assert.equal(r.body.transferido_a_soporte, true);
  assert.equal(sis.llm.llamadas.length, llamadasAntes, 'el modelo no recibio el mensaje');
});
