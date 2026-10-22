// Registro de sesiones de entrenamiento: valida, guarda series y dispara XP, racha, records, insignias y retos.
const { one, select, insert, run, tx, E, rbac, clock } = require('@playfit/shared');
const H = require('./helpers');
const G = require('./gamification');
const { actualizarRetosDelEstudiante } = require('./retos');

const MAX_EJERCICIOS = 8, MAX_SERIES = 40, MAX_DIAS_ATRAS = 7;

async function validarEntrada(entrada, hoy) {
  const { fecha, ejercicios } = entrada;
  const f = fecha || hoy;
  if (!clock.esFecha(f)) throw E.badRequest('fecha invalida (YYYY-MM-DD)');
  if (f > hoy) throw E.badRequest('No puedes registrar sesiones en el futuro', 'FECHA_FUTURA');
  if (clock.diffDays(hoy, f) > MAX_DIAS_ATRAS) throw E.badRequest(`Solo puedes registrar sesiones de los ultimos ${MAX_DIAS_ATRAS} dias`, 'FECHA_MUY_ANTIGUA');
  if (!Array.isArray(ejercicios) || ejercicios.length < 1 || ejercicios.length > MAX_EJERCICIOS) throw E.badRequest(`Indica entre 1 y ${MAX_EJERCICIOS} ejercicios`);
  const ids = ejercicios.map((e) => Number(e.ejercicio_id));
  if (new Set(ids).size !== ids.length) throw E.badRequest('Un ejercicio no puede repetirse en la misma sesion');
  const cat = await select('SELECT * FROM ejercicios WHERE id IN (:ids) AND activo=1', { ids });
  if (cat.length !== ids.length) throw E.badRequest('Algun ejercicio no existe o esta inactivo', 'EJERCICIO_INVALIDO');
  const porId = Object.fromEntries(cat.map((c) => [c.id, c]));
  let total = 0;
  for (const e of ejercicios) {
    const ej = porId[Number(e.ejercicio_id)];
    if (!Array.isArray(e.series) || e.series.length < 1) throw E.badRequest(`${ej.nombre}: indica al menos una serie`);
    total += e.series.length;
    for (const s of e.series) {
      if (ej.mide_reps) {
        if (!Number.isInteger(s.repeticiones) || s.repeticiones < 1 || s.repeticiones > 200) throw E.badRequest(`${ej.nombre}: repeticiones debe ser un entero entre 1 y 200`);
        if (s.peso_kg !== undefined && s.peso_kg !== null && !(Number(s.peso_kg) >= 0 && Number(s.peso_kg) <= 500)) throw E.badRequest(`${ej.nombre}: peso_kg debe estar entre 0 y 500`);
      } else if (!Number.isInteger(s.duracion_seg) || s.duracion_seg < 5 || s.duracion_seg > 3600) {
        throw E.badRequest(`${ej.nombre}: duracion_seg debe ser un entero entre 5 y 3600`);
      }
      if (s.fuente_conteo && !['manual', 'camara'].includes(s.fuente_conteo)) throw E.badRequest('fuente_conteo invalida');
      if (s.fuente_conteo === 'camara' && !ej.soporta_camara) throw E.badRequest(`${ej.nombre} no admite conteo con camara`);
    }
  }
  if (total > MAX_SERIES) throw E.badRequest(`Maximo ${MAX_SERIES} series por sesion`);
  return { f, porId };
}

async function registrarSesion(actor, entrada = {}) {
  rbac.requirePermiso(actor, 'sesion:crear_propia');
  const hoy = clock.hoy();
  const { f, porId } = await validarEntrada(entrada, hoy);
  if (entrada.notas && String(entrada.notas).length > 255) throw E.badRequest('notas: maximo 255 caracteres');

  return tx(async (t) => {
    await H.ensurePerfil(actor.id, t);
    const perfil = await H.lockPerfil(actor.id, t); // bloquea al estudiante: evita carreras entre sesiones simultaneas
    const nivelAntes = G.nivelDesdeXp(perfil.xp_total);
    const sesionesDia = Number((await one('SELECT COUNT(*) AS n FROM sesiones_entrenamiento WHERE estudiante_id=:e AND fecha=:f', { e: actor.id, f }, t)).n);
    const sesionesPrevias = Number((await one('SELECT COUNT(*) AS n FROM sesiones_entrenamiento WHERE estudiante_id=:e', { e: actor.id }, t)).n);

    // marcas personales ANTES de guardar esta sesion
    const records = [];
    for (const e of entrada.ejercicios) {
      const ej = porId[Number(e.ejercicio_id)];
      const prev = await one(
        `SELECT COALESCE(MAX(sr.repeticiones),0) AS reps, COALESCE(MAX(sr.peso_kg),0) AS peso, COALESCE(MAX(sr.duracion_seg),0) AS dur
         FROM series_ejercicio sr JOIN sesiones_entrenamiento s ON s.id=sr.sesion_id WHERE s.estudiante_id=:e AND sr.ejercicio_id=:ej`,
        { e: actor.id, ej: ej.id }, t);
      const nuevo = {
        reps: Math.max(0, ...e.series.map((s) => s.repeticiones || 0)),
        peso: Math.max(0, ...e.series.map((s) => Number(s.peso_kg) || 0)),
        dur: Math.max(0, ...e.series.map((s) => s.duracion_seg || 0))
      };
      // la primera vez que haces un ejercicio no cuenta como record (no hay marca previa que superar)
      if (Number(prev.reps) > 0 && nuevo.reps > Number(prev.reps)) records.push({ ejercicio: ej.nombre, tipo: 'repeticiones', anterior: Number(prev.reps), nuevo: nuevo.reps });
      else if (Number(prev.peso) > 0 && nuevo.peso > Number(prev.peso)) records.push({ ejercicio: ej.nombre, tipo: 'peso_kg', anterior: Number(prev.peso), nuevo: nuevo.peso });
      else if (Number(prev.dur) > 0 && nuevo.dur > Number(prev.dur)) records.push({ ejercicio: ej.nombre, tipo: 'duracion_seg', anterior: Number(prev.dur), nuevo: nuevo.dur });
    }

    const inicio = f === hoy ? 'UTC_TIMESTAMP()' : "TIMESTAMP(:f,'12:00:00')";
    const sesionId = await insert(
      `INSERT INTO sesiones_entrenamiento (estudiante_id,fecha,inicio_at,fin_at,notas) VALUES (:e,:f,${inicio},${inicio},:n)`,
      { e: actor.id, f, n: entrada.notas || null }, t);
    let orden = 0;
    for (const e of entrada.ejercicios) for (const s of e.series) {
      orden++;
      await insert(
        `INSERT INTO series_ejercicio (sesion_id,ejercicio_id,orden,repeticiones,peso_kg,duracion_seg,fuente_conteo) VALUES (:s,:ej,:o,:r,:p,:d,:fu)`,
        { s: sesionId, ej: Number(e.ejercicio_id), o: orden, r: s.repeticiones ?? null, p: s.peso_kg ?? null, d: s.duracion_seg ?? null, fu: s.fuente_conteo || 'manual' }, t);
    }

    // ---- XP ----
    const desglose = [];
    const dar = async (pts, motivo, refTipo, refId, etiqueta) => { await H.otorgarXp(actor.id, pts, motivo, refTipo, refId, t); desglose.push({ motivo: etiqueta, xp: pts }); };
    if (sesionesDia < G.XP.MAX_SESIONES_CON_XP_DIA) await dar(G.XP.SESION, 'sesion', 'sesion', sesionId, 'Sesion de entrenamiento');
    for (const r of records) await dar(G.XP.RECORD, 'record', 'sesion', sesionId, `Record en ${r.ejercicio}`);

    // ---- racha ----
    const ultima = perfil.ultima_actividad;
    const rachaPrev = G.rachaVigente(ultima, perfil.racha_actual, f);
    const rachaNueva = G.calcularRacha(ultima, perfil.racha_actual, f);
    const bono = G.bonoRacha(rachaPrev, rachaNueva);
    if (bono) await dar(bono, 'racha', 'sesion', sesionId, `Racha de ${rachaNueva} dias`);
    await run(
      `UPDATE perfil_gamificacion SET racha_actual=:r, racha_maxima=GREATEST(racha_maxima,:r),
       ultima_actividad=CASE WHEN ultima_actividad IS NULL OR ultima_actividad < :f THEN :f ELSE ultima_actividad END WHERE estudiante_id=:e`,
      { r: rachaNueva, f, e: actor.id }, t);

    // ---- insignias ----
    const insignias = [];
    const nueva = async (cod) => { const i = await H.otorgarInsignia(actor.id, cod, t); if (i) insignias.push(i); };
    if (sesionesPrevias === 0) await nueva('PRIMERA_SESION');
    if (rachaNueva >= 7) await nueva('RACHA_7');
    if (rachaNueva >= 14) await nueva('RACHA_14');
    const ids = entrada.ejercicios.map((e) => Number(e.ejercicio_id));
    const acum = await select(
      `SELECT sr.ejercicio_id, SUM(sr.repeticiones) AS n FROM series_ejercicio sr JOIN sesiones_entrenamiento s ON s.id=sr.sesion_id
       WHERE s.estudiante_id=:e AND sr.ejercicio_id IN (:ids) GROUP BY sr.ejercicio_id`, { e: actor.id, ids }, t);
    if (acum.some((a) => Number(a.n) >= 100)) await nueva('CIEN_REPS');

    // ---- retos (pueden dar XP extra) ----
    const retosCompletados = await actualizarRetosDelEstudiante(actor.id, f, t);
    const propios = retosCompletados.filter((r) => r.estudiante_id === actor.id);
    for (const r of propios) desglose.push({ motivo: `Reto completado: ${r.titulo}`, xp: r.xp });

    // ---- nivel, feed y notificaciones ----
    const despues = await one('SELECT xp_total, nivel, racha_actual FROM perfil_gamificacion WHERE estudiante_id=:e', { e: actor.id }, t);
    const subioNivel = despues.nivel > nivelAntes;
    if (subioNivel) await H.notificar(actor.id, 'nivel', `Subiste al nivel ${despues.nivel}`, null, t);
    for (const i of insignias) await H.notificar(actor.id, 'insignia', `Nueva insignia: ${i.nombre}`, i.descripcion, t);
    await H.publicarFeed(actor.id, 'sesion', { sesion_id: sesionId, ejercicios: entrada.ejercicios.map((e) => porId[Number(e.ejercicio_id)].nombre) }, t);
    for (const r of records) await H.publicarFeed(actor.id, 'record', r, t);
    if (bono) await H.publicarFeed(actor.id, 'racha', { dias: rachaNueva }, t);
    for (const i of insignias) await H.publicarFeed(actor.id, 'insignia', { codigo: i.codigo, nombre: i.nombre }, t);

    // ---- advertencias clinicas (solo flags derivados) ----
    const adv = await select(
      `SELECT e.nombre AS ejercicio, GROUP_CONCAT(DISTINCT ec.flag_codigo) AS motivos
       FROM ejercicio_contraindicaciones ec JOIN estudiante_flags ef ON ef.flag_codigo=ec.flag_codigo AND ef.estudiante_id=:e
       JOIN ejercicios e ON e.id=ec.ejercicio_id WHERE ec.ejercicio_id IN (:ids) GROUP BY e.id`, { e: actor.id, ids }, t);

    return {
      sesion_id: sesionId, fecha: f,
      xp_ganado: desglose.reduce((a, d) => a + d.xp, 0), desglose,
      xp_total: despues.xp_total, nivel_anterior: nivelAntes, nivel: despues.nivel, subio_nivel: subioNivel,
      racha: despues.racha_actual, records, insignias_nuevas: insignias,
      retos_completados: propios,
      advertencias: adv.map((a) => ({ ejercicio: a.ejercicio, motivos: a.motivos.split(',') }))
    };
  });
}

async function historialSesiones(actor, { limite = 10 } = {}) {
  await H.exigirEstudiante(actor);
  const lim = Math.min(Math.max(parseInt(limite, 10) || 10, 1), 50);
  const ses = await select('SELECT id,fecha,inicio_at,notas FROM sesiones_entrenamiento WHERE estudiante_id=:e ORDER BY fecha DESC, id DESC LIMIT :l', { e: actor.id, l: lim });
  if (!ses.length) return [];
  const series = await select(
    `SELECT sr.sesion_id, e.nombre AS ejercicio, sr.orden, sr.repeticiones, sr.peso_kg, sr.duracion_seg
     FROM series_ejercicio sr JOIN ejercicios e ON e.id=sr.ejercicio_id WHERE sr.sesion_id IN (:ids) ORDER BY sr.sesion_id, sr.orden`,
    { ids: ses.map((s) => s.id) });
  return ses.map((s) => ({ ...s, series: series.filter((x) => x.sesion_id === s.id) }));
}

module.exports = { registrarSesion, historialSesiones };
