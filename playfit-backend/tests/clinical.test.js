const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const S = require('./_setup');
const clin = require('@playfit/clinical-service');
const { one, select, clock } = require('@playfit/shared');

before(S.preparar); after(S.cerrar);
const rechaza = (p, code) => assert.rejects(p, (e) => { assert.equal(e.code, code, `esperaba ${code}, llego ${e.code}: ${e.message}`); return true; });

test('derivarFlags: detecta lesiones por palabras clave (con tildes y mayusculas) y por defecto SIN_RESTRICCIONES', () => {
  assert.deepEqual(clin.derivarFlags('Me opero de la RODILLA derecha'), ['LESION_RODILLA']);
  assert.deepEqual(clin.derivarFlags('tengo asma y presión alta').sort(), ['ASMA_EJERCICIO', 'HIPERTENSION']);
  assert.deepEqual(clin.derivarFlags('dolor lumbar', 'esguince de tobillo').sort(), ['LESION_ESPALDA_BAJA', 'RESTRICCION_IMPACTO']);
  assert.deepEqual(clin.derivarFlags('', null, undefined), ['SIN_RESTRICCIONES']);
  assert.deepEqual(clin.derivarFlags('estoy sano'), ['SIN_RESTRICCIONES']);
});
test('IMC: categorias segun OMS', () => {
  assert.equal(clin.categoriaIMC(17), 'bajo_peso'); assert.equal(clin.categoriaIMC(22), 'normal');
  assert.equal(clin.categoriaIMC(27), 'sobrepeso'); assert.equal(clin.categoriaIMC(31), 'obesidad');
});
test('el estudiante guarda su historial: queda CIFRADO en la BD y se descifra al leerlo', async () => {
  const r = await clin.guardarHistorial(S.ANA, 3, { condiciones: 'Asma leve desde la infancia', lesiones: 'Esguince de rodilla en 2024', medicamentos: 'Salbutamol' });
  assert.deepEqual(r.flags.map((f) => f.codigo).sort(), ['ASMA_EJERCICIO', 'LESION_RODILLA', 'RESTRICCION_IMPACTO']);
  const crudo = await one('SELECT * FROM historiales_clinicos WHERE estudiante_id=3');
  for (const col of ['condiciones_cifrado', 'lesiones_cifrado', 'medicamentos_cifrado']) {
    assert.match(crudo[col], /^v1:/); assert.doesNotMatch(crudo[col], /asma|rodilla|salbutamol/i);
  }
  const h = await clin.leerHistorial(S.ANA, 3);
  assert.equal(h.condiciones, 'Asma leve desde la infancia'); assert.equal(h.medicamentos, 'Salbutamol');
});
test('sin consentimiento de datos de salud NO se guarda nada', async () => {
  await S.actor; // (solo para claridad)
  const { sequelize } = require('@playfit/shared');
  await sequelize.query("INSERT INTO consentimientos (usuario_id,tipo,aceptado) VALUES (5,'datos_salud',0)");
  await rechaza(clin.guardarHistorial(S.CAMILA, 5, { condiciones: 'algo' }), 'CONSENTIMIENTO_REQUERIDO');
});
test('un estudiante NO puede leer ni escribir el historial de otro; admin tampoco', async () => {
  await rechaza(clin.leerHistorial(S.LUIS, 3), 'PROHIBIDO');
  await rechaza(clin.guardarHistorial(S.LUIS, 3, { condiciones: 'x' }), 'PROHIBIDO');
  await rechaza(clin.leerHistorial(S.ADMIN, 3), 'PROHIBIDO');
  await rechaza(clin.obtenerFlags(S.ADMIN, 3), 'PROHIBIDO');
});
test('cada lectura/escritura clinica queda en la bitacora de auditoria', async () => {
  const filas = await select("SELECT usuario_id,accion FROM auditoria_accesos WHERE recurso='historial_clinico' AND recurso_id=3 ORDER BY id");
  assert.ok(filas.some((f) => f.usuario_id === 3 && f.accion === 'actualizar'));
  assert.ok(filas.some((f) => f.usuario_id === 3 && f.accion === 'leer'));
});
test('mediciones: valida rangos, calcula IMC y variacion de peso', async () => {
  await rechaza(clin.registrarMedicion(S.ANA, 3, { peso_kg: 10, estatura_cm: 165 }), 'DATOS_INVALIDOS');
  await rechaza(clin.registrarMedicion(S.ANA, 3, { peso_kg: 60, estatura_cm: 165, fecha: clock.addDays(clock.hoy(), 3) }), 'DATOS_INVALIDOS');
  const m = await clin.registrarMedicion(S.ANA, 3, { peso_kg: 60, estatura_cm: 165, fecha: clock.addDays(clock.hoy(), 1 - 1) });
  assert.equal(Number(m.imc), 22); assert.equal(m.categoria_imc, 'normal');
  const lista = await clin.listarMediciones(S.ANA, 3);
  assert.equal(lista.at(-1).cambio_peso_kg, -2); // 62 (seed) -> 60
  await rechaza(clin.listarMediciones(S.LUIS, 3), 'PROHIBIDO');
});
test('ejerciciosParaEstudiante separa permitidos y restringidos segun los flags (Luis: rodilla)', async () => {
  const r = await clin.ejerciciosParaEstudiante(4);
  const restr = r.restringidos.map((e) => e.slug).sort();
  assert.deepEqual(restr, ['sentadilla', 'zancadas']);
  assert.ok(r.permitidos.some((e) => e.slug === 'plancha'));
  assert.deepEqual(r.restringidos[0].motivos, ['LESION_RODILLA']);
});
