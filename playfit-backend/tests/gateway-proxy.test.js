// Gateway detras de un proxy (Caddy en Kubernetes): los limites por IP deben usar la IP real del cliente.
// No necesita MariaDB (los servicios no se llaman: el limitador responde antes).
const test = require('node:test');
const assert = require('node:assert');
const { createGateway } = require('../gateway/src/app');

const targets = { auth: 'http://127.0.0.1:9', clinical: 'http://127.0.0.1:9', social: 'http://127.0.0.1:9', content: 'http://127.0.0.1:9' };

async function levantar(opciones) {
  const app = createGateway({ targets, limiteAuth: 2, log: false, ...opciones });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const registrar = (ip) => fetch(`${url}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip }, body: '{}' });
  return { server, registrar };
}

test('con trustProxy=1 cada cliente tiene su propio limite (no se bloquean entre todos)', async () => {
  const { server, registrar } = await levantar({ trustProxy: 1 });
  try {
    for (let i = 0; i < 2; i++) assert.notStrictEqual((await registrar('203.0.113.10')).status, 429);
    assert.strictEqual((await registrar('203.0.113.10')).status, 429, 'el mismo cliente si queda limitado');
    assert.notStrictEqual((await registrar('198.51.100.7')).status, 429, 'otro cliente NO hereda el bloqueo');
  } finally { server.close(); }
});

test('sin trustProxy (PC) se ignora X-Forwarded-For: no se puede esquivar el limite falsificando la cabecera', async () => {
  const { server, registrar } = await levantar({ trustProxy: false });
  try {
    await registrar('1.1.1.1'); await registrar('2.2.2.2');
    assert.strictEqual((await registrar('3.3.3.3')).status, 429);
  } finally { server.close(); }
});
