// Pruebas del inicializador de despliegue (scripts/db-init.js) con una conexion simulada: no necesitan MariaDB.
const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const { inicializar } = require('../scripts/db-init');

function bdFalsa({ vacia = true, fallosAlConectar = 0, lock = 1 } = {}) {
  const consultas = [];
  let fallos = fallosAlConectar;
  return {
    consultas,
    async query(sql, opts = {}) {
      consultas.push({ sql, opts });
      if (sql === 'SELECT 1') { if (fallos-- > 0) throw new Error('ECONNREFUSED'); return [[{ 1: 1 }]]; }
      if (sql.includes('GET_LOCK')) return [{ ok: lock }];
      if (sql.includes('information_schema.tables')) return [{ n: vacia ? 0 : 1 }];
      return [[], {}];
    }
  };
}
const silencio = () => {};
const rapido = { intentos: 5, pausaMs: 1 };
const contiene = (bd, texto) => bd.consultas.some((c) => c.sql.includes(texto));

test('base vacia: crea esquema, carga seed, protege las cuentas y aplica migraciones', async () => {
  const bd = bdFalsa({ vacia: true });
  const r = await inicializar({ sql: bd, demoPassword: 'clave-demo-segura', log: silencio, esperar: rapido });
  assert.strictEqual(r.creada, true);
  assert.ok(contiene(bd, 'CREATE TABLE usuarios'), 'debe correr 01_schema.sql');
  assert.ok(contiene(bd, 'INSERT INTO usuarios'), 'debe correr 02_seed.sql');
  assert.ok(contiene(bd, 'intentos_login'), 'debe correr 03_fase7.sql');
  assert.ok(contiene(bd, 'codigos_verificacion'), 'debe correr 04_fase11.sql');
  const upd = bd.consultas.find((c) => c.sql.startsWith('UPDATE usuarios SET password_hash'));
  assert.ok(upd, 'debe reemplazar las contrasenas del seed');
  assert.ok(await bcrypt.compare('clave-demo-segura', upd.opts.replacements.h));
  assert.ok(contiene(bd, 'RELEASE_LOCK'));
});

test('base con datos: NO toca el esquema (no hay DROP) y solo aplica migraciones', async () => {
  const bd = bdFalsa({ vacia: false });
  const r = await inicializar({ sql: bd, demoPassword: 'clave-demo-segura', log: silencio, esperar: rapido });
  assert.strictEqual(r.creada, false);
  assert.ok(!contiene(bd, 'DROP TABLE'), 'jamas debe borrar tablas de una base con datos');
  assert.ok(!contiene(bd, 'UPDATE usuarios'));
  assert.ok(contiene(bd, 'intentos_login'));
  assert.ok(contiene(bd, 'codigos_verificacion'));
});

test('espera a que MariaDB arranque antes de rendirse', async () => {
  const bd = bdFalsa({ vacia: false, fallosAlConectar: 3 });
  await inicializar({ sql: bd, log: silencio, esperar: rapido });
  assert.strictEqual(bd.consultas.filter((c) => c.sql === 'SELECT 1').length, 4);
});

test('si MariaDB nunca responde, falla con un mensaje claro', async () => {
  const bd = bdFalsa({ fallosAlConectar: 99 });
  await assert.rejects(inicializar({ sql: bd, log: silencio, esperar: rapido }), /MariaDB no respondio/);
});

test('si otra copia tiene el candado, no inicializa', async () => {
  const bd = bdFalsa({ lock: 0 });
  await assert.rejects(inicializar({ sql: bd, log: silencio, esperar: rapido }), /candado/);
  assert.ok(!contiene(bd, 'CREATE TABLE'));
});

test('rechaza una DEMO_PASSWORD demasiado corta', async () => {
  const bd = bdFalsa({ vacia: true });
  await assert.rejects(inicializar({ sql: bd, demoPassword: 'corta', log: silencio, esperar: rapido }), /al menos 10/);
  assert.ok(contiene(bd, 'RELEASE_LOCK'), 'libera el candado aunque falle');
});
