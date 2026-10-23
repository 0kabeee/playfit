// Fase 12: retos creados dentro del squad, duelos 1 vs 1 y chat de soporte con transferencia a humano (pagos).
const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const S = require('./_setup');
const soc = require('@playfit/social-service');
const auth = require('@playfit/auth-service');
const adminSvc = require('@playfit/auth-service/src/admin');
const { ia } = require('@playfit/content-service');
const { one, select, sequelize, clock, soporte } = require('@playfit/shared');
const { sentencias } = require('@playfit/shared/src/migrate');

beforeEach(S.preparar); after(S.cerrar);
const rechaza = (p, code) => assert.rejects(p, (e) => { assert.equal(e.code, code, `esperaba ${code}, llego ${e.code}: ${e.message}`); return true; });
const sesion = (actor, ej, ...series) => soc.registrarSesion(actor, { ejercicios: [{ ejercicio_id: ej, series }] });
const xpOk = async () => {
  const mal = await select('SELECT g.estudiante_id FROM perfil_gamificacion g WHERE g.xp_total <> (SELECT COALESCE(SUM(puntos),0) FROM xp_movimientos x WHERE x.estudiante_id=g.estudiante_id)');
  assert.equal(mal.length, 0, 'XP descuadrado para: ' + mal.map((m) => m.estudiante_id));
};
const nuevoEnSquad = async (id, squadId) => {
  await sequelize.query('INSERT INTO usuarios (id,rol_id,nombre,apellido,email,password_hash) VALUES (:id,1,"Nuevo",:ap,:em,"x")', { replacements: { id, ap: `E${id}`, em: `n${id}@t.com` } });
  if (squadId) await sequelize.query("INSERT INTO squad_miembros (squad_id,estudiante_id,rol) VALUES (:s,:id,'miembro')", { replacements: { s: squadId, id } });
  return S.actor(id, 'estudiante');
};
const notifs = async (id, tipo) => Number((await one('SELECT COUNT(*) AS n FROM notificaciones WHERE usuario_id=:u AND tipo=:t', { u: id, t: tipo })).n);
const SENTADILLA = 1, PESO_MUERTO = 3, CURL = 8, PLANCHA = 7;

// ---------------------------------------------------------------- migracion
test('migracion 05: se parsea y deja las columnas y tablas nuevas', async () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'database', '05_fase12.sql'), 'utf8');
  assert.ok(sentencias(sql).length >= 8);
  const cols = await select("SELECT column_name AS c FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='retos'");
  assert.ok(cols.some((c) => c.c === 'squad_id'));
  for (const tabla of ['duelos', 'soporte_conversaciones', 'soporte_mensajes']) {
    const t = await one('SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=:t', { t: tabla });
    assert.equal(Number(t.n), 1, `falta la tabla ${tabla}`);
  }
});

// ---------------------------------------------------------------- retos de squad
test('reto de squad: lo crea un miembro, se inscribe solo, avisa al resto y otros squads no lo ven', async () => {
  const antesLuis = await notifs(4, 'reto');
  const r = await soc.crearRetoSquad(S.ANA, { titulo: 'Semana de sentadillas', metrica: 'reps', ejercicio_id: SENTADILLA, meta: 400, dias: 7 });
  assert.equal(r.squad_id, 1); assert.equal(r.tipo, 'squad'); assert.equal(r.xp_recompensa, soc.xpRetoSquad(7));
  assert.equal(r.fecha_fin, clock.addDays(clock.hoy(), 6));
  assert.ok(await one('SELECT 1 AS ok FROM reto_participaciones WHERE reto_id=:r AND estudiante_id=3', { r: r.id }), 'el creador queda inscrito');
  assert.equal(await notifs(4, 'reto'), antesLuis + 1, 'los demas miembros reciben aviso');
  assert.ok(await one("SELECT 1 AS ok FROM actividad_feed WHERE squad_id=1 AND tipo='reto_creado'"));

  const deLuis = await soc.listarRetos(S.LUIS);
  const visto = deLuis.disponibles.find((x) => x.id === r.id);
  assert.ok(visto && visto.de_squad && visto.creador === 'Ana');
  assert.equal(visto.puede_cancelar, false);
  // Valentina es de otro squad: el reto no existe para ella
  const deVale = await soc.listarRetos(S.VALE);
  assert.ok(![...deVale.activos, ...deVale.disponibles].some((x) => x.id === r.id));
  await rechaza(soc.detalleReto(S.VALE, r.id), 'NO_ENCONTRADO');
  await rechaza(soc.unirseReto(S.VALE, r.id), 'NO_ENCONTRADO');
  // Luis si puede unirse y ver el detalle con los companeros
  await soc.unirseReto(S.LUIS, r.id);
  const det = await soc.detalleReto(S.LUIS, r.id);
  assert.equal(det.de_squad, true); assert.equal(det.participantes.length, 2);
  // el admin lo ve en su panel con el nombre del squad
  const panel = await soc.listarRetosAdmin(S.ADMIN);
  assert.equal(panel.find((x) => x.id === r.id).squad, 'Los Titanes');
});

test('reto de squad: validaciones y anti-abuso (sin squad, duracion, metrica, meta, limite de 3 vigentes, admin)', async () => {
  const solo = await nuevoEnSquad(60, null);
  const base = { titulo: 'Reto valido', metrica: 'sesiones', meta: 3, dias: 5 };
  await rechaza(soc.crearRetoSquad(solo, base), 'REQUIERE_SQUAD');
  await rechaza(soc.crearRetoSquad(S.ADMIN, base), 'PROHIBIDO');
  await rechaza(soc.crearRetoSquad(S.ANA, { ...base, dias: 31 }), 'DATOS_INVALIDOS');
  await rechaza(soc.crearRetoSquad(S.ANA, { ...base, dias: 0 }), 'DATOS_INVALIDOS');
  await rechaza(soc.crearRetoSquad(S.ANA, { ...base, titulo: 'x' }), 'DATOS_INVALIDOS');
  await rechaza(soc.crearRetoSquad(S.ANA, { ...base, metrica: 'peso_maximo', ejercicio_id: PESO_MUERTO, meta: 80 }), 'METRICA_INVALIDA');
  await rechaza(soc.crearRetoSquad(S.ANA, { ...base, metrica: 'reps', meta: 100 }), 'DATOS_INVALIDOS');               // falta ejercicio
  await rechaza(soc.crearRetoSquad(S.ANA, { ...base, metrica: 'reps', ejercicio_id: PLANCHA, meta: 100 }), 'EJERCICIO_INVALIDO'); // se mide por tiempo
  await rechaza(soc.crearRetoSquad(S.ANA, { ...base, metrica: 'dias_activos', meta: 6, dias: 5 }), 'DATOS_INVALIDOS'); // mas dias activos que dias del reto
  await rechaza(soc.crearRetoSquad(S.ANA, { ...base, fecha_inicio: clock.addDays(clock.hoy(), 8) }), 'DATOS_INVALIDOS');
  await rechaza(soc.crearRetoSquad(S.ANA, { ...base, fecha_inicio: clock.addDays(clock.hoy(), -1) }), 'DATOS_INVALIDOS');
  // la XP la fija el servidor aunque el cliente mande otra
  const r0 = await soc.crearRetoSquad(S.ANA, { ...base, xp_recompensa: 1000 });
  assert.equal(r0.xp_recompensa, soc.xpRetoSquad(5));
  // ya hay 1 creado: 2 mas llegan al limite de 3 vigentes y el cuarto se rechaza
  await soc.crearRetoSquad(S.LUIS, base);
  await soc.crearRetoSquad(S.CAMILA, base);
  await rechaza(soc.crearRetoSquad(S.ANDRES, base), 'LIMITE_RETOS_SQUAD');
  // el otro squad tiene su propio cupo
  await soc.crearRetoSquad(S.VALE, base);
});

test('reto de squad con peso maximo: cada miembro debe levantarlo; se completa con la sesion real y da XP', async () => {
  const hoy = clock.hoy();
  const base = await soc.medir('peso_maximo', PESO_MUERTO, 3, hoy, hoy);
  const meta = base + 10;
  const r = await soc.crearRetoSquad(S.ANA, { titulo: 'Peso muerto pesado', tipo: 'individual', metrica: 'peso_maximo', ejercicio_id: PESO_MUERTO, meta, dias: 3 });
  assert.equal(r.tipo, 'individual');
  const res = await sesion(S.ANA, PESO_MUERTO, { repeticiones: 3, peso_kg: meta + 5 });
  assert.ok(res.retos_completados.some((x) => x.reto_id === r.id), 'el reto se completa para Ana');
  // en un reto individual del squad, Andres (que no levanto) no se completa
  await soc.unirseReto(S.ANDRES, r.id);
  const p = await one('SELECT completado_at FROM reto_participaciones WHERE reto_id=:r AND estudiante_id=6', { r: r.id });
  assert.equal(p.completado_at, null);
  await xpOk();
});

test('reto de squad: meta colectiva con sesiones reales de varios miembros completa para todos', async () => {
  const hoy = clock.hoy();
  const ya = (await Promise.all([3, 6].map((e) => soc.medir('reps', CURL, e, hoy, hoy)))).reduce((a, b) => a + b, 0);
  const r = await soc.crearRetoSquad(S.ANA, { titulo: 'Curl en equipo', metrica: 'reps', ejercicio_id: CURL, meta: ya + 60, dias: 2 });
  await soc.unirseReto(S.ANDRES, r.id);
  await sesion(S.ANDRES, CURL, { repeticiones: 30 });
  const antes = await one('SELECT completado_at FROM reto_participaciones WHERE reto_id=:r AND estudiante_id=3', { r: r.id });
  assert.equal(antes.completado_at, null);
  await sesion(S.ANA, CURL, { repeticiones: 30 });
  const fin = await select('SELECT estudiante_id, completado_at FROM reto_participaciones WHERE reto_id=:r', { r: r.id });
  assert.equal(fin.length, 2); assert.ok(fin.every((f) => f.completado_at), 'se completa para todo el squad');
  await xpOk();
});

test('reto de squad: cancelar (solo creador o lider), salir del squad y eliminar la cuenta del creador', async () => {
  const r1 = await soc.crearRetoSquad(S.LUIS, { titulo: 'Reto de Luis', metrica: 'sesiones', meta: 2, dias: 4 });
  await rechaza(soc.cancelarRetoSquad(S.CAMILA, r1.id), 'PROHIBIDO');      // ni creadora ni lider
  await rechaza(soc.cancelarRetoSquad(S.VALE, r1.id), 'NO_ENCONTRADO');    // de otro squad
  await soc.cancelarRetoSquad(S.ANA, r1.id);                                // Ana es la lider
  assert.ok(!(await soc.listarRetos(S.LUIS)).activos.some((x) => x.id === r1.id));

  // meta alta: Luis y Camila ya entrenaron hoy (seed) y con meta 2 el reto se completaria al unirse
  const r2 = await soc.crearRetoSquad(S.LUIS, { titulo: 'Otro de Luis', metrica: 'sesiones', meta: 20, dias: 4 });
  await soc.unirseReto(S.CAMILA, r2.id);
  await soc.salirSquad(S.CAMILA);
  assert.equal(await one('SELECT 1 AS ok FROM reto_participaciones WHERE reto_id=:r AND estudiante_id=5', { r: r2.id }), null, 'al salir se borra su participacion');
  // Luis elimina su cuenta: el reto queda a cargo de la lider del squad (antes fallaba por la llave foranea)
  await auth.eliminarCuenta(S.LUIS, 'PlayFit123!');
  const quedo = await one('SELECT creado_por FROM retos WHERE id=:id', { id: r2.id });
  assert.equal(quedo.creado_por, 3);
});

// ---------------------------------------------------------------- duelos
test('duelo: retar, aceptar, progreso en vivo y resolucion con XP al ganador (sin pagar dos veces)', async () => {
  const antes = await notifs(5, 'duelo');
  const d = await soc.crearDuelo(S.ANDRES, { rival_id: 5, metrica: 'reps', ejercicio_id: CURL, dias: 2 });
  assert.equal(d.estado, 'pendiente'); assert.equal(d.soy_retador, true); assert.equal(d.puede_cancelar, true);
  assert.equal(await notifs(5, 'duelo'), antes + 1);
  await rechaza(soc.crearDuelo(S.ANDRES, { rival_id: 5, metrica: 'sesiones', dias: 2 }), 'DUELO_YA_EXISTE');
  await rechaza(soc.crearDuelo(S.CAMILA, { rival_id: 6, metrica: 'sesiones', dias: 2 }), 'DUELO_YA_EXISTE'); // la misma pareja al reves
  await rechaza(soc.responderDuelo(S.ANDRES, d.id, true), 'PROHIBIDO');   // el retador no se responde a si mismo
  await rechaza(soc.responderDuelo(S.VALE, d.id, true), 'NO_ENCONTRADO');

  const ac = await soc.responderDuelo(S.CAMILA, d.id, true);
  assert.equal(ac.estado, 'activo'); assert.equal(ac.fecha_inicio, clock.hoy()); assert.equal(ac.fecha_fin, clock.addDays(clock.hoy(), 1));
  await rechaza(soc.cancelarDuelo(S.ANDRES, d.id), 'DUELO_NO_CANCELABLE');
  const hoy = clock.hoy();
  const baseA = await soc.medir('reps', CURL, 6, hoy, hoy), baseC = await soc.medir('reps', CURL, 5, hoy, hoy);
  await sesion(S.ANDRES, CURL, { repeticiones: baseC - baseA + 40 > 0 ? Math.min(200, baseC - baseA + 40) : 40 });
  const vivo = (await soc.listarDuelos(S.ANDRES)).activos.find((x) => x.id === d.id);
  assert.ok(vivo.mi_progreso > vivo.su_progreso, 'progreso en vivo desde las sesiones reales');

  const xpAntes = await one("SELECT COALESCE(SUM(puntos),0) AS n FROM xp_movimientos WHERE estudiante_id=6 AND motivo='duelo'");
  clock.set(clock.addDays(hoy, 2)); // ya termino la ventana de 2 dias
  const l = await soc.listarDuelos(S.CAMILA);
  const fin = l.historial.find((x) => x.id === d.id);
  assert.equal(fin.estado, 'finalizado'); assert.equal(fin.resultado, 'perdi');
  await soc.listarDuelos(S.ANDRES); await soc.resolverVencidos(); // resolver otra vez no vuelve a pagar
  const xpDespues = await one("SELECT COALESCE(SUM(puntos),0) AS n FROM xp_movimientos WHERE estudiante_id=6 AND motivo='duelo'");
  assert.equal(Number(xpDespues.n) - Number(xpAntes.n), soc.DUELO.XP_GANADOR);
  assert.equal((await soc.listarDuelos(S.ANDRES)).historial.find((x) => x.id === d.id).resultado, 'gane');
  await xpOk();
});

test('duelo: rechazar, cancelar, vencer sin respuesta, empate sin entrenar y limites', async () => {
  await rechaza(soc.crearDuelo(S.ANA, { rival_id: 7, metrica: 'sesiones', dias: 2 }), 'PROHIBIDO');      // otro squad
  await rechaza(soc.crearDuelo(S.ANA, { rival_id: 3, metrica: 'sesiones', dias: 2 }), 'DATOS_INVALIDOS'); // a si misma
  await rechaza(soc.crearDuelo(S.ANA, { rival_id: 4, metrica: 'sesiones', dias: 8 }), 'DATOS_INVALIDOS');
  await rechaza(soc.crearDuelo(S.ANA, { rival_id: 4, metrica: 'reps', dias: 2 }), 'DATOS_INVALIDOS');    // falta ejercicio
  await rechaza(soc.crearDuelo(S.ANA, { rival_id: 4, metrica: 'dias_activos', dias: 2 }), 'DATOS_INVALIDOS');

  const a = await soc.crearDuelo(S.ANA, { rival_id: 4, metrica: 'sesiones', dias: 1 });
  const r = await soc.responderDuelo(S.LUIS, a.id, false);
  assert.equal(r.estado, 'rechazado');
  await rechaza(soc.responderDuelo(S.LUIS, a.id, true), 'DUELO_NO_PENDIENTE');

  const b = await soc.crearDuelo(S.ANA, { rival_id: 4, metrica: 'sesiones', dias: 1 });
  await soc.cancelarDuelo(S.ANA, b.id);
  assert.equal((await one('SELECT estado FROM duelos WHERE id=:id', { id: b.id })).estado, 'cancelado');

  const c = await soc.crearDuelo(S.ANA, { rival_id: 4, metrica: 'sesiones', dias: 1 });
  await sequelize.query('UPDATE duelos SET created_at = NOW() - INTERVAL 4 DAY WHERE id=:id', { replacements: { id: c.id } });
  assert.equal((await soc.listarDuelos(S.ANA)).historial.find((x) => x.id === c.id).estado, 'expirado');

  // empate entre dos que no entrenan: sin XP
  const e1 = await nuevoEnSquad(61, 2), e2 = await nuevoEnSquad(62, 2);
  const d = await soc.crearDuelo(e1, { rival_id: 62, metrica: 'sesiones', dias: 1 });
  await soc.responderDuelo(e2, d.id, true);
  clock.set(clock.addDays(clock.hoy(), 1));
  const fin = (await soc.listarDuelos(e1)).historial.find((x) => x.id === d.id);
  assert.equal(fin.resultado, 'empate');
  assert.equal(Number((await one("SELECT COUNT(*) AS n FROM xp_movimientos WHERE motivo='duelo' AND estudiante_id IN (61,62)")).n), 0);
  clock.set(clock.addDays(clock.hoy(), -1));

  // limite: maximo 3 duelos abiertos por persona
  const x1 = await nuevoEnSquad(63, 1), x2 = await nuevoEnSquad(64, 1);
  await soc.crearDuelo(S.ANA, { rival_id: 4, metrica: 'sesiones', dias: 1 });
  await soc.crearDuelo(S.ANA, { rival_id: 5, metrica: 'sesiones', dias: 1 });
  await soc.crearDuelo(S.ANA, { rival_id: 63, metrica: 'sesiones', dias: 1 });
  await rechaza(soc.crearDuelo(S.ANA, { rival_id: 64, metrica: 'sesiones', dias: 1 }), 'LIMITE_DUELOS');
  await rechaza(soc.crearDuelo(x2, { rival_id: 3, metrica: 'sesiones', dias: 1 }), 'LIMITE_DUELOS'); // el rival (Ana) esta lleno
  assert.ok(x1);
});

// ---------------------------------------------------------------- soporte
test('soporte: deteccion de pagos y de "hablar con un asesor"', () => {
  for (const t of ['Quiero pagar el Premium', 'tengo un problema con mi pago', '¿Cuánto cuesta el plan?', 'me cobraron dos veces', 'Quiero suscribirme', 'pague por PSE y no llego'])
    assert.equal(soporte.detectarPago(t), true, t);
  for (const t of ['Que rutina de piernas me recomiendas?', 'voy a apagar el celular', 'como subo mi racha', 'hola'])
    assert.equal(soporte.detectarPago(t), false, t);
  assert.equal(soporte.detectarHumano('Quiero hablar con un asesor'), true);
  assert.equal(soporte.detectarHumano('hablar con una persona por favor'), true);
  assert.equal(soporte.detectarHumano('cuantas personas hay en mi squad'), false);
});

test('soporte: el bot responde; al hablar de pago transfiere a humano; el admin atiende, responde y cierra', async () => {
  const r1 = await soc.enviarMensajeUsuario(S.ANA, 'Hola, ¿cómo funciona la racha?');
  assert.equal(r1.transferida, false); assert.equal(r1.conversacion.estado, 'bot');
  assert.equal(r1.conversacion.mensajes.length, 2); assert.equal(r1.conversacion.mensajes[1].autor, 'bot');
  assert.match(r1.conversacion.mensajes[1].contenido, /racha/i);
  // mientras esta con el bot, el admin NO la ve (es privada del usuario)
  assert.equal((await soc.bandeja(S.ADMIN)).conversaciones.length, 0);
  await rechaza(soc.verConversacionAdmin(S.ADMIN, r1.conversacion.id), 'NO_ENCONTRADO');

  const r2 = await soc.enviarMensajeUsuario(S.ANA, 'Quiero pagar el Premium');
  assert.equal(r2.transferida, true);
  assert.equal(r2.conversacion.estado, 'pendiente'); assert.equal(r2.conversacion.motivo, 'pago'); assert.equal(r2.conversacion.con_humano, true);
  assert.equal(r2.conversacion.mensajes.at(-1).contenido, soporte.MSG_TRANSFERENCIA);

  const b = await soc.bandeja(S.ADMIN);
  assert.equal(b.pendientes, 1); assert.equal(b.conversaciones[0].email, 'ana@playfit.test');
  assert.equal(b.conversaciones[0].motivo, 'pago');
  assert.equal((await adminSvc.metricas(S.ADMIN)).soporte_pendientes, 1);
  const v = await soc.verConversacionAdmin(S.ADMIN, r2.conversacion.id, { ip: '10.0.0.1' });
  assert.equal(v.mensajes.length, 4);
  assert.ok(await one("SELECT 1 AS ok FROM auditoria_accesos WHERE recurso='soporte_conversacion' AND usuario_id=1 AND accion='leer'"), 'queda auditado');

  const antes = await notifs(3, 'soporte');
  await soc.responderAdmin(S.ADMIN, r2.conversacion.id, 'Hola Ana, te envio el enlace de pago en un momento.');
  assert.equal(await notifs(3, 'soporte'), antes + 1);
  const mio = await soc.miSoporte(S.ANA);
  assert.equal(mio.conversacion.estado, 'atendiendo'); assert.equal(mio.conversacion.mensajes.at(-1).autor, 'admin');
  // con un humano atendiendo, el bot ya no contesta
  const r3 = await soc.enviarMensajeUsuario(S.ANA, 'Gracias, quedo atenta');
  assert.equal(r3.conversacion.mensajes.at(-1).autor, 'usuario');

  await soc.cerrarAdmin(S.ADMIN, r2.conversacion.id);
  assert.equal((await soc.miSoporte(S.ANA)).conversacion, null);
  await rechaza(soc.responderAdmin(S.ADMIN, r2.conversacion.id, 'hola'), 'CONVERSACION_CERRADA');
  assert.equal((await soc.bandeja(S.ADMIN, { estado: 'cerrada' })).conversaciones.length, 1);
  // un mensaje nuevo abre otra conversacion con el bot
  const r4 = await soc.enviarMensajeUsuario(S.ANA, 'Quiero hablar con un asesor');
  assert.notEqual(r4.conversacion.id, r2.conversacion.id);
  assert.equal(r4.transferida, true); assert.equal(r4.conversacion.motivo, 'general');
});

test('soporte: permisos, validaciones y limite de mensajes', async () => {
  await rechaza(soc.bandeja(S.ANA), 'PROHIBIDO');
  await rechaza(soc.responderAdmin(S.ANA, 1, 'x'), 'PROHIBIDO');
  await rechaza(soc.enviarMensajeUsuario(S.ADMIN, 'hola'), 'PROHIBIDO');
  await rechaza(soc.enviarMensajeUsuario(S.ANA, '   '), 'DATOS_INVALIDOS');
  await rechaza(soc.enviarMensajeUsuario(S.ANA, 'x'.repeat(1001)), 'DATOS_INVALIDOS');
  await rechaza(soc.bandeja(S.ADMIN, { estado: 'raro' }), 'DATOS_INVALIDOS');
  await rechaza(soc.cerrarMiSoporte(S.LUIS), 'NO_ENCONTRADO');
  // cada usuario solo ve lo suyo
  await soc.enviarMensajeUsuario(S.ANA, 'mensaje privado de Ana');
  assert.equal((await soc.miSoporte(S.LUIS)).conversacion, null);
  for (let i = 0; i < 30; i++) await soc.enviarMensajeUsuario(S.ANDRES, `pregunta ${i}`);
  await rechaza(soc.enviarMensajeUsuario(S.ANDRES, 'una mas'), 'LIMITE_SOPORTE');
});

test('asistente de IA: un mensaje sobre pagos NO va al modelo, no gasta cuota y llega a la bandeja del admin', async () => {
  const llm = { async generate() { throw new Error('no deberia llamarse al modelo'); } };
  const usoAntes = await one('SELECT COALESCE(SUM(solicitudes),0) AS n FROM ia_uso_diario WHERE estudiante_id=7');
  const r = await ia.chat(S.VALE, { mensaje: 'Tengo un problema con mi pago del Premium' }, { llm });
  assert.equal(r.transferido_a_soporte, true); assert.equal(r.respuesta, soporte.MSG_TRANSFERENCIA);
  const usoDespues = await one('SELECT COALESCE(SUM(solicitudes),0) AS n FROM ia_uso_diario WHERE estudiante_id=7');
  assert.equal(Number(usoDespues.n), Number(usoAntes.n));
  const conv = await one('SELECT * FROM soporte_conversaciones WHERE id=:id', { id: r.soporte_conversacion_id });
  assert.equal(conv.usuario_id, 7); assert.equal(conv.estado, 'pendiente'); assert.equal(conv.motivo, 'pago');
  const msgs = await select('SELECT autor, contenido FROM soporte_mensajes WHERE conversacion_id=:c ORDER BY id', { c: conv.id });
  assert.equal(msgs[0].autor, 'usuario'); assert.match(msgs[0].contenido, /pago/);
  // el historial del chat de IA tambien muestra el aviso
  const h = await ia.verConversacion(S.VALE, r.conversacion_id);
  assert.equal(h.mensajes.at(-1).contenido, soporte.MSG_TRANSFERENCIA);
  // una senal de alarma de salud tiene prioridad sobre la palabra "pago"
  const llm2 = { async generate() { return 'x'; } };
  const a = await ia.chat(S.VALE, { mensaje: 'Siento dolor en el pecho, ¿lo cubre el Premium?' }, { llm: llm2 });
  assert.equal(a.alerta_salud, true); assert.equal(a.transferido_a_soporte, false);
});
