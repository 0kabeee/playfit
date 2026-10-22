const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const S = require('./_setup');
const soc = require('@playfit/social-service');
const { one, select, sequelize, clock } = require('@playfit/shared');
const G = soc.gamification;

beforeEach(S.preparar); after(S.cerrar);
const rechaza = (p, code) => assert.rejects(p, (e) => { assert.equal(e.code, code, `esperaba ${code}, llego ${e.code}: ${e.message}`); return true; });
const nuevo = async (id) => {
  await sequelize.query('INSERT INTO usuarios (id,rol_id,nombre,apellido,email,password_hash) VALUES (:id,1,"Nuevo",:ap,:em,"x")', { replacements: { id, ap: `E${id}`, em: `n${id}@t.com` } });
  return S.actor(id, 'estudiante');
};
const ses = (ej, ...series) => ({ ejercicio_id: ej, series: series.map((r) => (typeof r === 'number' ? { repeticiones: r } : r)) });
const xpOk = async () => { // invariante: el XP del perfil siempre cuadra con sus movimientos
  const mal = await select('SELECT g.estudiante_id FROM perfil_gamificacion g WHERE g.xp_total <> (SELECT COALESCE(SUM(puntos),0) FROM xp_movimientos x WHERE x.estudiante_id=g.estudiante_id) OR g.nivel <> FLOOR(g.xp_total/300)+1');
  assert.equal(mal.length, 0, 'XP/nivel descuadrados para: ' + mal.map((m) => m.estudiante_id));
};

// ---------- reglas puras ----------
test('gamificacion: niveles, racha y bonos', () => {
  assert.equal(G.nivelDesdeXp(0), 1); assert.equal(G.nivelDesdeXp(299), 1); assert.equal(G.nivelDesdeXp(300), 2);
  assert.deepEqual(G.progresoNivel(750), { nivel: 3, xp_en_nivel: 150, xp_para_siguiente: 150, porcentaje: 50 });
  const h = '2026-10-03';
  assert.equal(G.calcularRacha(null, 0, h), 1);
  assert.equal(G.calcularRacha('2026-10-03', 4, h), 4);   // mismo dia: no suma
  assert.equal(G.calcularRacha('2026-10-02', 4, h), 5);   // dia consecutivo
  assert.equal(G.calcularRacha('2026-10-01', 4, h), 1);   // se rompio
  assert.equal(G.calcularRacha('2026-10-05', 4, h), 4);   // sesion retroactiva no altera
  assert.equal(G.rachaVigente('2026-10-01', 4, h), 0); assert.equal(G.rachaVigente('2026-10-02', 4, h), 4);
  assert.equal(G.bonoRacha(6, 7), 100); assert.equal(G.bonoRacha(7, 7), 0); assert.equal(G.bonoRacha(7, 8), 0); assert.equal(G.bonoRacha(13, 14), 200);
});

// ---------- sesiones ----------
test('sesion: da XP, detecta record, rompe/reinicia racha, sube de nivel y completa reto individual', async () => {
  const antes = await one('SELECT xp_total FROM perfil_gamificacion WHERE estudiante_id=6');
  const r = await soc.registrarSesion(S.ANDRES, { ejercicios: [ses(1, 150, 150)] });
  assert.equal(r.records.length, 1); assert.equal(r.records[0].tipo, 'repeticiones');
  assert.equal(r.racha, 1); // llevaba 3 dias sin entrenar
  assert.equal(r.nivel_anterior, 1); assert.equal(r.subio_nivel, true);
  assert.equal(r.retos_completados.length, 1); assert.equal(r.retos_completados[0].reto_id, 1);
  assert.equal(r.xp_ganado, r.desglose.reduce((a, d) => a + d.xp, 0));
  assert.equal(r.xp_total - antes.xp_total, r.xp_ganado);
  assert.ok(r.insignias_nuevas.every((i) => i.codigo));
  assert.equal((await one('SELECT COUNT(*) AS n FROM notificaciones WHERE usuario_id=6 AND tipo="nivel"')).n, 1);
  await xpOk();
});
test('anti-abuso: solo las 2 primeras sesiones del dia dan XP y la racha no se infla', async () => {
  const a = await soc.registrarSesion(S.ANDRES, { ejercicios: [ses(1, 5)] });
  const b = await soc.registrarSesion(S.ANDRES, { ejercicios: [ses(1, 5)] });
  const c = await soc.registrarSesion(S.ANDRES, { ejercicios: [ses(1, 5)] });
  assert.ok(a.xp_ganado >= 50 && b.xp_ganado >= 50);
  assert.equal(c.desglose.filter((d) => d.motivo === 'Sesion de entrenamiento').length, 0);
  assert.equal(c.racha, 1);
  await xpOk();
});
test('racha: crece dia a dia, otorga bono + insignia a los 7 dias, y primera sesion da insignia', async () => {
  const n = await nuevo(30);
  const ayer = clock.addDays(clock.hoy(), -1);
  const r1 = await soc.registrarSesion(n, { fecha: ayer, ejercicios: [ses(1, 10)] });
  assert.equal(r1.racha, 1); assert.ok(r1.insignias_nuevas.some((i) => i.codigo === 'PRIMERA_SESION'));
  const r2 = await soc.registrarSesion(n, { ejercicios: [ses(1, 10)] });
  assert.equal(r2.racha, 2);
  await sequelize.query('UPDATE perfil_gamificacion SET racha_actual=6, ultima_actividad=:a WHERE estudiante_id=30', { replacements: { a: ayer } });
  const r3 = await soc.registrarSesion(n, { ejercicios: [ses(1, 10)] });
  assert.equal(r3.racha, 7);
  assert.ok(r3.desglose.some((d) => d.motivo === 'Racha de 7 dias' && d.xp === 100));
  assert.ok(r3.insignias_nuevas.some((i) => i.codigo === 'RACHA_7'));
  await xpOk();
});
test('sesion con fecha pasada (hasta 7 dias) se guarda sin alterar la racha vigente', async () => {
  const antes = await one('SELECT racha_actual,ultima_actividad FROM perfil_gamificacion WHERE estudiante_id=3');
  await soc.registrarSesion(S.ANA, { fecha: clock.addDays(clock.hoy(), -2), ejercicios: [ses(5, 8)] });
  const despues = await one('SELECT racha_actual,ultima_actividad FROM perfil_gamificacion WHERE estudiante_id=3');
  assert.deepEqual(despues, antes);
});
test('validaciones de sesion', async () => {
  const hoy = clock.hoy();
  await rechaza(soc.registrarSesion(S.ANA, { fecha: clock.addDays(hoy, 1), ejercicios: [ses(1, 5)] }), 'FECHA_FUTURA');
  await rechaza(soc.registrarSesion(S.ANA, { fecha: clock.addDays(hoy, -8), ejercicios: [ses(1, 5)] }), 'FECHA_MUY_ANTIGUA');
  await rechaza(soc.registrarSesion(S.ANA, { ejercicios: [] }), 'DATOS_INVALIDOS');
  await rechaza(soc.registrarSesion(S.ANA, { ejercicios: [ses(1, 0)] }), 'DATOS_INVALIDOS');
  await rechaza(soc.registrarSesion(S.ANA, { ejercicios: [ses(1, 201)] }), 'DATOS_INVALIDOS');
  await rechaza(soc.registrarSesion(S.ANA, { ejercicios: [ses(7, 30)] }), 'DATOS_INVALIDOS');          // plancha pide duracion
  await rechaza(soc.registrarSesion(S.ANA, { ejercicios: [ses(1, 5), ses(1, 5)] }), 'DATOS_INVALIDOS'); // repetido
  await rechaza(soc.registrarSesion(S.ANA, { ejercicios: [ses(999, 5)] }), 'EJERCICIO_INVALIDO');
  await rechaza(soc.registrarSesion(S.ANA, { ejercicios: [ses(3, { repeticiones: 5, fuente_conteo: 'camara' })] }), 'DATOS_INVALIDOS'); // peso muerto sin camara
  await rechaza(soc.registrarSesion(S.ANA, { ejercicios: [ses(1, ...Array(41).fill(5))] }), 'DATOS_INVALIDOS');
  await rechaza(soc.registrarSesion(S.DOCENTE, { ejercicios: [ses(1, 5)] }), 'PROHIBIDO');
  const ok = await soc.registrarSesion(S.ANA, { ejercicios: [ses(7, { duracion_seg: 60 })] });
  assert.ok(ok.sesion_id);
});
test('una sesion invalida no deja datos a medias (transaccion)', async () => {
  const antes = (await one('SELECT COUNT(*) AS n FROM sesiones_entrenamiento')).n;
  await rechaza(soc.registrarSesion(S.ANA, { ejercicios: [ses(1, 5), ses(2, 0)] }), 'DATOS_INVALIDOS');
  assert.equal((await one('SELECT COUNT(*) AS n FROM sesiones_entrenamiento')).n, antes);
});
test('ejercicio contraindicado por flag: se guarda pero devuelve ADVERTENCIA (Luis, rodilla)', async () => {
  const r = await soc.registrarSesion(S.LUIS, { ejercicios: [ses(1, 8), ses(5, 8)] });
  assert.equal(r.advertencias.length, 1);
  assert.equal(r.advertencias[0].ejercicio, 'Sentadilla'); assert.deepEqual(r.advertencias[0].motivos, ['LESION_RODILLA']);
});
test('dos sesiones simultaneas del mismo estudiante no corrompen XP ni racha', async () => {
  const [a, b] = await Promise.all([soc.registrarSesion(S.CAMILA, { ejercicios: [ses(1, 6)] }), soc.registrarSesion(S.CAMILA, { ejercicios: [ses(2, 6)] })]);
  assert.ok(a.sesion_id !== b.sesion_id);
  await xpOk();
});
test('historial de sesiones trae las series agrupadas', async () => {
  const h = await soc.historialSesiones(S.ANA, { limite: 3 });
  assert.equal(h.length, 3); assert.ok(h[0].series.length >= 3);
  assert.ok(h[0].fecha >= h[1].fecha);
});

// ---------- retos ----------
test('retos: docente crea, estudiante no; validaciones', async () => {
  const hoy = clock.hoy();
  const base = { titulo: 'Reto nuevo', descripcion: 'Descripcion', tipo: 'individual', metrica: 'sesiones', meta: 5, fecha_fin: clock.addDays(hoy, 10) };
  const r = await soc.crearReto(S.DOCENTE, base);
  assert.equal(r.meta, 5);
  await rechaza(soc.crearReto(S.ANA, base), 'PROHIBIDO');
  await rechaza(soc.crearReto(S.DOCENTE, { ...base, metrica: 'reps' }), 'DATOS_INVALIDOS');           // reps exige ejercicio
  await rechaza(soc.crearReto(S.DOCENTE, { ...base, meta: 0 }), 'DATOS_INVALIDOS');
  await rechaza(soc.crearReto(S.DOCENTE, { ...base, tipo: 'raro' }), 'DATOS_INVALIDOS');
  await rechaza(soc.crearReto(S.DOCENTE, { ...base, fecha_fin: clock.addDays(hoy, -1) }), 'DATOS_INVALIDOS');
  await rechaza(soc.crearReto(S.DOCENTE, { ...base, fecha_fin: clock.addDays(hoy, 200) }), 'DATOS_INVALIDOS');
});
test('listarRetos separa activos, disponibles y completados', async () => {
  const r = await soc.listarRetos(S.ANA);
  assert.ok(r.completados.some((x) => x.titulo === '7 días activos'));
  assert.ok(r.activos.every((x) => x.dias_restantes >= 0 && x.porcentaje <= 100));
  const sb = await soc.listarRetos(S.SEBAS);
  assert.ok(sb.disponibles.length >= 1);
});
test('unirse a reto: duplicado, finalizado y reto de squad sin squad', async () => {
  const u = await soc.unirseReto(S.CAMILA, 1);
  assert.equal(u.reto_id, 1); assert.ok(u.progreso >= 0);
  await rechaza(soc.unirseReto(S.CAMILA, 1), 'YA_PARTICIPA');
  await rechaza(soc.unirseReto(S.VALE, 4), 'RETO_FINALIZADO');
  const sinSquad = await nuevo(31);
  await rechaza(soc.unirseReto(sinSquad, 2), 'REQUIERE_SQUAD');
  await rechaza(soc.unirseReto(S.CAMILA, 999), 'NO_ENCONTRADO');
});
test('reto de squad: al llegar a la meta COLECTIVA se completa para todo el squad con su XP', async () => {
  await soc.registrarSesion(S.ANA, { ejercicios: [ses(2, 200, 200)] }); // 400 flexiones > meta 300
  const filas = await select('SELECT estudiante_id, completado_at FROM reto_participaciones WHERE reto_id=2 AND squad_id=1');
  assert.equal(filas.length, 4); assert.ok(filas.every((f) => f.completado_at));
  const xp = await select("SELECT estudiante_id FROM xp_movimientos WHERE motivo='reto_completado' AND referencia_tipo='reto' AND referencia_id=2");
  assert.deepEqual(xp.map((x) => x.estudiante_id).sort(), [3, 4, 5, 6]);
  await xpOk();
});

// ---------- squads ----------
test('squad: crear, unirse por codigo, limites y errores', async () => {
  const a = await nuevo(40), b = await nuevo(41), c = await nuevo(42);
  const s = await soc.crearSquad(a, { nombre: 'Los Nuevos' });
  assert.match(s.codigo_invitacion, /^[A-HJ-NP-Z2-9]{8}$/);
  assert.equal(s.insignia_nueva.codigo, 'SQUAD_FUNDADOR');
  await rechaza(soc.crearSquad(a, { nombre: 'Otro squad' }), 'YA_TIENE_SQUAD');
  await rechaza(soc.crearSquad(b, { nombre: 'x' }), 'DATOS_INVALIDOS');
  await rechaza(soc.unirseSquad(b, 'ZZZZZZZZ'), 'SQUAD_NO_ENCONTRADO');
  await rechaza(soc.unirseSquad(b, 'corto'), 'CODIGO_INVALIDO');
  const j = await soc.unirseSquad(b, s.codigo_invitacion.toLowerCase()); // tolera minusculas
  assert.equal(j.miembros, 2);
  await rechaza(soc.unirseSquad(S.ANA, s.codigo_invitacion), 'YA_TIENE_SQUAD');
  await sequelize.query('UPDATE squads SET max_miembros=2 WHERE id=:id', { replacements: { id: s.squad_id } });
  await rechaza(soc.unirseSquad(c, s.codigo_invitacion), 'SQUAD_LLENO');
});
test('squad: al salir el lider, el liderazgo pasa al miembro con mas XP; si queda vacio se disuelve', async () => {
  const antes = await one('SELECT lider_id FROM squads WHERE id=1');
  assert.equal(antes.lider_id, 3); // Ana, 800 XP
  const r = await soc.salirSquad(S.ANA);
  assert.equal(r.nuevo_lider_id, 4); // Luis tiene 550 XP, el mayor entre los restantes
  assert.equal((await one('SELECT lider_id FROM squads WHERE id=1')).lider_id, 4);
  assert.equal((await one("SELECT rol FROM squad_miembros WHERE estudiante_id=4")).rol, 'lider');
  await soc.salirSquad(S.SEBAS);
  const ult = await soc.salirSquad(S.VALE);
  assert.equal(ult.squad_disuelto, true);
  assert.equal(await one('SELECT id FROM squads WHERE id=2'), null);
  await rechaza(soc.salirSquad(S.VALE), 'SIN_SQUAD');
});
test('squad: detalle visible para miembros y docente del curso; el codigo solo para miembros', async () => {
  const m = await soc.detalleSquad(S.LUIS, 1);
  assert.equal(m.miembros.length, 4); assert.ok(m.codigo_invitacion);
  assert.equal(m.miembros[0].id, 3); // ordenados por XP
  assert.equal(m.miembros.find((x) => x.id === 6).racha, 0); // Andres tiene la racha rota
  assert.ok(m.feed.length > 0 && typeof m.feed[0].detalle === 'object');
  const d = await soc.detalleSquad(S.DOCENTE, 1);
  assert.equal(d.codigo_invitacion, undefined);
  await rechaza(soc.detalleSquad(S.VALE, 1), 'PROHIBIDO');
  await rechaza(soc.detalleSquad(S.ANA, 999), 'SQUAD_NO_ENCONTRADO');
  assert.equal((await soc.miSquad(S.VALE)).id, 2);
});
test('comparar miembros: solo dentro del squad y devuelve ganas/pierdes (para la mascota)', async () => {
  const r = await soc.compararMiembros(S.ANA, 4, 1);
  assert.equal(r.resultado, 'ganas'); assert.ok(r.yo.total > r.otro.total);
  const inv = await soc.compararMiembros(S.LUIS, 3, 1);
  assert.equal(inv.resultado, 'pierdes');
  await rechaza(soc.compararMiembros(S.ANA, 7, 1), 'PROHIBIDO'); // Valentina esta en otro squad
  await rechaza(soc.compararMiembros(S.ANA, 3, 1), 'DATOS_INVALIDOS');
});

// ---------- rankings y dashboard ----------
test('ranking XP: orden, puestos, es_yo y filtro por squad con permisos', async () => {
  const r = await soc.rankingXp(S.LUIS);
  assert.deepEqual(r.map((x) => x.puesto), [1, 2, 3, 4, 5, 6]);
  assert.equal(r[0].estudiante_id, 3); assert.equal(r.find((x) => x.es_yo).estudiante_id, 4);
  assert.equal(r.find((x) => x.estudiante_id === 6).racha, 0);
  const sq = await soc.rankingXp(S.ANA, { squadId: 1 });
  assert.equal(sq.length, 4);
  await rechaza(soc.rankingXp(S.VALE, { squadId: 1 }), 'PROHIBIDO');
  assert.equal((await soc.rankingXp(S.DOCENTE, { squadId: 1 })).length, 4);
});
test('ranking por ejercicio: ordena por total y calcula la tendencia semanal', async () => {
  const r = await soc.rankingEjercicio(S.ANA, 1);
  assert.equal(r.unidad, 'reps'); assert.equal(r.ranking[0].estudiante_id, 3);
  for (let i = 1; i < r.ranking.length; i++) assert.ok(r.ranking[i - 1].total >= r.ranking[i].total);
  for (const f of r.ranking) assert.equal(f.tendencia, f.semana_actual > f.semana_anterior ? 'sube' : f.semana_actual < f.semana_anterior ? 'baja' : 'igual');
  assert.equal((await soc.rankingEjercicio(S.ANA, 7)).unidad, 'segundos');
  await rechaza(soc.rankingEjercicio(S.ANA, 999), 'NO_ENCONTRADO');
});
test('dashboard: racha, semana, squad, reto en vivo e insignias', async () => {
  const d = await soc.dashboard(S.ANA);
  assert.equal(d.racha_actual, 12); assert.equal(d.puesto, 1); assert.equal(d.entreno_hoy, true);
  assert.equal(d.semana.length, 7); assert.equal(d.semana.filter((x) => x.es_hoy).length, 1);
  assert.equal(d.squad.lider.id, 3); assert.ok(d.reto_en_vivo); assert.ok(d.insignias.some((i) => i.codigo === 'RACHA_7'));
  assert.equal(d.xp_en_nivel + d.xp_para_siguiente, 300);
  assert.equal((await soc.dashboard(S.ANDRES)).racha_actual, 0);
  const n = await nuevo(50); // estudiante sin actividad: no debe fallar
  const dn = await soc.dashboard(n);
  assert.equal(dn.xp_total, 0); assert.equal(dn.squad, null); assert.equal(dn.reto_en_vivo, null);
});
