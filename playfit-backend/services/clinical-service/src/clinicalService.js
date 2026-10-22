// clinical-service · historial clinico cifrado, flags derivados, mediciones, ejercicios seguros.
// PRINCIPIO: el texto clinico crudo NUNCA sale de este servicio hacia IA ni hacia otros modulos; solo los flags.
const { one, select, insert, run, tx, E, rbac, audit, crypto, clock } = require('@playfit/shared');

// ---------- reglas de derivacion de flags (palabra clave -> flag) ----------
// Criterio conservador: ante la duda se marca el flag (un falso positivo es mas seguro que un falso negativo).
// El docente puede corregir/confirmar con fijarFlagsDocente().
const REGLAS_FLAGS = [
  { flag: 'LESION_RODILLA', re: /rodilla|menisco|ligamento cruzado|\blca\b|rotula|condromalacia/ },
  { flag: 'LESION_HOMBRO', re: /hombro|manguito|luxacion de hombro|clavicula/ },
  { flag: 'LESION_ESPALDA_BAJA', re: /lumbar|espalda baja|hernia|columna|escoliosis|ciatica/ },
  { flag: 'HIPERTENSION', re: /hipertension|presion alta|tension alta|arritmia|cardiopatia|problema (del )?corazon/ },
  { flag: 'ASMA_EJERCICIO', re: /asma|broncoespasmo|bronquitis|dificultad para respirar/ },
  { flag: 'RESTRICCION_IMPACTO', re: /tobillo|esguince|fractura|cadera|osteoporosis|cirugia reciente|tendinitis|fascitis/ }
];
const normalizar = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function derivarFlags(...textos) {
  const t = normalizar(textos.filter(Boolean).join(' | '));
  const flags = REGLAS_FLAGS.filter((r) => r.re.test(t)).map((r) => r.flag);
  return flags.length ? flags : ['SIN_RESTRICCIONES'];
}

// ---------- autorizacion ----------
// Acceso a datos de un estudiante: el propio estudiante, o un docente que tenga a ese estudiante en alguno de sus cursos.
// El admin NO accede a datos clinicos.
async function autorizar(actor, estudianteId, { escribir = false } = {}) {
  if (!actor) throw E.unauthorized();
  if (actor.rol === 'estudiante') {
    if (actor.id !== estudianteId) throw E.forbidden('Solo puedes acceder a tu propia informacion clinica');
    rbac.requirePermiso(actor, escribir ? 'clinico:escribir_propio' : 'clinico:leer_propio');
    return;
  }
  if (actor.rol === 'docente') {
    rbac.requirePermiso(actor, escribir ? 'clinico:escribir_curso' : 'clinico:leer_curso');
    const ok = await one(
      `SELECT 1 AS ok FROM cursos c JOIN curso_estudiantes ce ON ce.curso_id=c.id
       WHERE c.docente_id=:d AND ce.estudiante_id=:e AND c.activo=1 LIMIT 1`, { d: actor.id, e: estudianteId });
    if (!ok) throw E.forbidden('Ese estudiante no pertenece a tus cursos');
    return;
  }
  throw E.forbidden('Tu rol no tiene acceso a datos clinicos');
}

async function exigirConsentimientoSalud(estudianteId) {
  const c = await one(
    `SELECT aceptado FROM consentimientos WHERE usuario_id=:u AND tipo='datos_salud' ORDER BY id DESC LIMIT 1`, { u: estudianteId });
  if (!c || !c.aceptado) {
    throw E.forbidden('Falta el consentimiento para tratar datos de salud', 'CONSENTIMIENTO_REQUERIDO');
  }
}
async function existeEstudiante(id) {
  const u = await one(`SELECT u.id FROM usuarios u JOIN roles r ON r.id=u.rol_id WHERE u.id=:id AND r.nombre='estudiante'`, { id });
  if (!u) throw E.notFound('Estudiante no encontrado');
}

// ---------- historial clinico ----------
function validarTexto(v, campo) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || v.length > 1000) throw E.badRequest(`${campo}: texto invalido (maximo 1000 caracteres)`, 'DATOS_INVALIDOS');
  return v.trim();
}

async function guardarHistorial(actor, estudianteId, { fecha_nacimiento = null, condiciones, lesiones, medicamentos } = {}, { ip } = {}) {
  await existeEstudiante(estudianteId);
  await autorizar(actor, estudianteId, { escribir: true });
  await exigirConsentimientoSalud(estudianteId);
  const cond = validarTexto(condiciones, 'condiciones');
  const les = validarTexto(lesiones, 'lesiones');
  const med = validarTexto(medicamentos, 'medicamentos');
  if (fecha_nacimiento !== null && !clock.esFecha(fecha_nacimiento)) throw E.badRequest('fecha_nacimiento invalida', 'DATOS_INVALIDOS');
  const flags = derivarFlags(cond, les, med);

  return tx(async (t) => {
    await run(
      `INSERT INTO historiales_clinicos (estudiante_id,fecha_nacimiento,condiciones_cifrado,lesiones_cifrado,medicamentos_cifrado,actualizado_por)
       VALUES (:e,:fn,:c,:l,:m,:a)
       ON DUPLICATE KEY UPDATE fecha_nacimiento=COALESCE(VALUES(fecha_nacimiento),fecha_nacimiento),
         condiciones_cifrado=VALUES(condiciones_cifrado), lesiones_cifrado=VALUES(lesiones_cifrado),
         medicamentos_cifrado=VALUES(medicamentos_cifrado), actualizado_por=VALUES(actualizado_por)`,
      { e: estudianteId, fn: fecha_nacimiento, c: crypto.encrypt(cond), l: crypto.encrypt(les), m: crypto.encrypt(med), a: actor.id }, t);
    // Se recalculan los flags 'sistema'; los fijados por un docente se conservan.
    await run(`DELETE FROM estudiante_flags WHERE estudiante_id=:e AND origen IN ('sistema','estudiante')`, { e: estudianteId }, t);
    const origen = actor.rol === 'estudiante' ? 'estudiante' : 'sistema';
    for (const f of flags) {
      await run('INSERT IGNORE INTO estudiante_flags (estudiante_id,flag_codigo,origen) VALUES (:e,:f,:o)', { e: estudianteId, f, o: origen }, t);
    }
    // Si ya hay flags de docente con restricciones reales, SIN_RESTRICCIONES se quita para no contradecirlos.
    await limpiarSinRestricciones(estudianteId, t);
    await audit.registrar(actor, 'actualizar', 'historial_clinico', estudianteId, { ip, t });
    return { estudiante_id: estudianteId, flags: await flagsDe(estudianteId, t) };
  });
}

async function limpiarSinRestricciones(estudianteId, t) {
  const f = (await select('SELECT flag_codigo FROM estudiante_flags WHERE estudiante_id=:e', { e: estudianteId }, t)).map((x) => x.flag_codigo);
  if (f.length > 1 && f.includes('SIN_RESTRICCIONES')) {
    await run(`DELETE FROM estudiante_flags WHERE estudiante_id=:e AND flag_codigo='SIN_RESTRICCIONES'`, { e: estudianteId }, t);
  }
}

async function leerHistorial(actor, estudianteId, { ip } = {}) {
  await existeEstudiante(estudianteId);
  await autorizar(actor, estudianteId);
  const h = await one('SELECT * FROM historiales_clinicos WHERE estudiante_id=:e', { e: estudianteId });
  await audit.registrar(actor, 'leer', 'historial_clinico', estudianteId, { ip });
  if (!h) return { estudiante_id: estudianteId, fecha_nacimiento: null, condiciones: null, lesiones: null, medicamentos: null, flags: await flagsDe(estudianteId) };
  return {
    estudiante_id: estudianteId, fecha_nacimiento: h.fecha_nacimiento,
    condiciones: crypto.decrypt(h.condiciones_cifrado), lesiones: crypto.decrypt(h.lesiones_cifrado),
    medicamentos: crypto.decrypt(h.medicamentos_cifrado), flags: await flagsDe(estudianteId)
  };
}

// ---------- flags (lo unico que ve el resto del sistema) ----------
const flagsDe = async (estudianteId, t) =>
  (await select('SELECT flag_codigo AS codigo, origen FROM estudiante_flags WHERE estudiante_id=:e ORDER BY flag_codigo', { e: estudianteId }, t));

async function obtenerFlags(actor, estudianteId, { ip } = {}) {
  await autorizar(actor, estudianteId);
  await audit.registrar(actor, 'leer', 'flags_clinicos', estudianteId, { ip });
  return flagsDe(estudianteId);
}

// Uso interno entre servicios (IA, social): devuelve SOLO codigos de flags.
async function obtenerCodigosFlagsInterno(estudianteId) {
  return (await flagsDe(estudianteId)).map((f) => f.codigo);
}

async function fijarFlagsDocente(actor, estudianteId, codigos, { ip } = {}) {
  if (!actor || actor.rol !== 'docente') throw E.forbidden('Solo un docente puede fijar flags manualmente');
  await autorizar(actor, estudianteId, { escribir: true });
  if (!Array.isArray(codigos) || codigos.length === 0) throw E.badRequest('Indica al menos un flag', 'DATOS_INVALIDOS');
  const validos = (await select('SELECT codigo FROM flags_clinicos')).map((f) => f.codigo);
  const malos = codigos.filter((c) => !validos.includes(c));
  if (malos.length) throw E.badRequest(`Flags desconocidos: ${malos.join(', ')}`, 'FLAG_INVALIDO');
  return tx(async (t) => {
    // La decision del docente reemplaza lo derivado automaticamente.
    await run('DELETE FROM estudiante_flags WHERE estudiante_id=:e', { e: estudianteId }, t);
    for (const f of new Set(codigos)) {
      await run(`INSERT INTO estudiante_flags (estudiante_id,flag_codigo,origen) VALUES (:e,:f,'docente')`, { e: estudianteId, f }, t);
    }
    await limpiarSinRestricciones(estudianteId, t);
    await audit.registrar(actor, 'actualizar', 'flags_clinicos', estudianteId, { ip, t });
    return flagsDe(estudianteId, t);
  });
}

// ---------- mediciones corporales ----------
const categoriaIMC = (imc) => (imc < 18.5 ? 'bajo_peso' : imc < 25 ? 'normal' : imc < 30 ? 'sobrepeso' : 'obesidad');

async function registrarMedicion(actor, estudianteId, { peso_kg, estatura_cm, fecha } = {}) {
  await existeEstudiante(estudianteId);
  await autorizar(actor, estudianteId, { escribir: true });
  const peso = Number(peso_kg), est = Number(estatura_cm);
  if (!(peso >= 30 && peso <= 250)) throw E.badRequest('peso_kg debe estar entre 30 y 250', 'DATOS_INVALIDOS');
  if (!(est >= 120 && est <= 230)) throw E.badRequest('estatura_cm debe estar entre 120 y 230', 'DATOS_INVALIDOS');
  const f = fecha || clock.hoy();
  if (!clock.esFecha(f) || f > clock.hoy()) throw E.badRequest('fecha invalida (no puede ser futura)', 'DATOS_INVALIDOS');
  const id = await insert('INSERT INTO mediciones_corporales (estudiante_id,fecha,peso_kg,estatura_cm) VALUES (:e,:f,:p,:s)',
    { e: estudianteId, f, p: peso, s: est });
  await audit.registrar(actor, 'crear', 'medicion', id);
  const m = await one('SELECT * FROM mediciones_corporales WHERE id=:id', { id });
  return { ...m, categoria_imc: categoriaIMC(Number(m.imc)) };
}

async function listarMediciones(actor, estudianteId, { ip } = {}) {
  await autorizar(actor, estudianteId);
  const filas = await select('SELECT * FROM mediciones_corporales WHERE estudiante_id=:e ORDER BY fecha ASC, id ASC', { e: estudianteId });
  await audit.registrar(actor, 'leer', 'medicion', estudianteId, { ip });
  return filas.map((m, i) => ({
    ...m, categoria_imc: categoriaIMC(Number(m.imc)),
    cambio_peso_kg: i === 0 ? null : Math.round((Number(m.peso_kg) - Number(filas[i - 1].peso_kg)) * 100) / 100
  }));
}

// ---------- ejercicios seguros segun flags ----------
async function ejerciciosParaEstudiante(estudianteId) {
  const codigos = await obtenerCodigosFlagsInterno(estudianteId);
  const todos = await select('SELECT id,slug,nombre,grupo_muscular,nivel FROM ejercicios WHERE activo=1 ORDER BY id');
  const contra = await select('SELECT ejercicio_id, flag_codigo FROM ejercicio_contraindicaciones');
  const permitidos = [], restringidos = [];
  for (const e of todos) {
    const motivos = contra.filter((c) => c.ejercicio_id === e.id && codigos.includes(c.flag_codigo)).map((c) => c.flag_codigo);
    if (motivos.length) restringidos.push({ ...e, motivos }); else permitidos.push(e);
  }
  return { flags: codigos, permitidos, restringidos };
}

module.exports = {
  derivarFlags, categoriaIMC, guardarHistorial, leerHistorial, obtenerFlags, obtenerCodigosFlagsInterno,
  fijarFlagsDocente, registrarMedicion, listarMediciones, ejerciciosParaEstudiante, REGLAS_FLAGS
};
