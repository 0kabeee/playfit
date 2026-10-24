// Agente de IA (Fase 13): funciones que Gemini puede llamar ("function calling") y memoria del usuario.
//
// REGLAS:
//  - Las acciones que cambian datos (registrar sesion, crear reto de squad) NO se ejecutan aqui: se guardan como
//    PROPUESTA en ia_acciones y la app muestra una tarjeta con "Confirmar". Al confirmar, la app llama a los
//    endpoints normales (mismas validaciones, XP y anti-abuso que si lo hiciera a mano).
//  - Una sola propuesta por mensaje (la tarjeta va pegada a la respuesta del modelo).
//  - La memoria solo guarda preferencias ESTRUCTURADAS (listas cerradas o numeros). Nada de texto libre ni salud:
//    las restricciones de salud siguen llegando al modelo unicamente como codigos de flags.
//  - Lo que devuelven las funciones al modelo nunca incluye nombres, correos ni texto clinico.
const { one, select, run, clock } = require('@playfit/shared');

// ---------------------------------------------------------------- memoria
const MEMORIA = {
  objetivo: { etiqueta: 'Objetivo', valores: ['fuerza', 'hipertrofia', 'resistencia', 'perdida_grasa', 'movilidad', 'salud_general'] },
  nivel: { etiqueta: 'Experiencia', valores: ['principiante', 'intermedio', 'avanzado'] },
  dias_semana: { etiqueta: 'Dias por semana', rango: [1, 7] },
  horario: { etiqueta: 'Horario preferido', valores: ['manana', 'mediodia', 'tarde', 'noche'] },
  minutos_sesion: { etiqueta: 'Minutos por sesion', rango: [10, 180] },
  equipo: { etiqueta: 'Equipo disponible', valores: ['ninguno', 'mancuernas', 'bandas', 'gimnasio_completo'] }
};

function validarMemoria(clave, valor) {
  const def = MEMORIA[clave];
  if (!def) return { error: `clave desconocida. Usa una de: ${Object.keys(MEMORIA).join(', ')}` };
  if (def.valores) {
    const v = String(valor ?? '').trim().toLowerCase();
    return def.valores.includes(v) ? { valor: v } : { error: `valor invalido para ${clave}. Opciones: ${def.valores.join(', ')}` };
  }
  const n = Number(valor);
  const [min, max] = def.rango;
  return Number.isInteger(n) && n >= min && n <= max ? { valor: String(n) } : { error: `${clave} debe ser un entero entre ${min} y ${max}` };
}

const leerMemoria = (estudianteId) => select('SELECT clave, valor, updated_at FROM ia_memoria WHERE estudiante_id=:e ORDER BY clave', { e: estudianteId });
const guardarMemoria = (estudianteId, clave, valor) =>
  run('INSERT INTO ia_memoria (estudiante_id,clave,valor) VALUES (:e,:c,:v) ON DUPLICATE KEY UPDATE valor=VALUES(valor)', { e: estudianteId, c: clave, v: valor });

// ---------------------------------------------------------------- catalogo
// Catalogo de ejercicios activos marcando los contraindicados por los flags del estudiante.
async function catalogoPara(estudianteId) {
  const ejercicios = await select('SELECT id, slug, nombre, grupo_muscular, mide_reps FROM ejercicios WHERE activo=1 ORDER BY id');
  const contra = await select(
    `SELECT ec.ejercicio_id, GROUP_CONCAT(ec.flag_codigo ORDER BY ec.flag_codigo) AS flags
     FROM ejercicio_contraindicaciones ec JOIN estudiante_flags ef ON ef.flag_codigo=ec.flag_codigo AND ef.estudiante_id=:e
     GROUP BY ec.ejercicio_id`, { e: estudianteId });
  const evitar = Object.fromEntries(contra.map((c) => [c.ejercicio_id, c.flags.split(',')]));
  return ejercicios.map((e) => ({ ...e, mide_reps: !!e.mide_reps, evitar: evitar[e.id] || [] }));
}

const normalizar = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
function buscarEjercicio(catalogo, texto) {
  const t = normalizar(texto).replace(/\s+/g, '-');
  return catalogo.find((e) => e.slug === t || normalizar(e.nombre).replace(/\s+/g, '-') === t) || null;
}

// ---------------------------------------------------------------- declaraciones para Gemini
const FUNCIONES = [
  {
    name: 'consultar_progreso',
    description: 'Devuelve el progreso real del usuario: racha, XP, nivel, sesiones de los ultimos 7 dias y retos vigentes de su squad. Usala antes de opinar sobre su progreso o sugerir retos.',
    parameters: { type: 'OBJECT', properties: {} }
  },
  {
    name: 'registrar_sesion',
    description: 'PROPONE registrar una sesion de entrenamiento que el usuario YA hizo. No la guarda: la app le muestra una tarjeta y solo se registra si el usuario toca Confirmar. Usala solo cuando el usuario diga que entreno y tengas ejercicio y series.',
    parameters: {
      type: 'OBJECT',
      properties: {
        fecha: { type: 'STRING', description: 'YYYY-MM-DD. Omitir si fue hoy. Maximo 7 dias atras.' },
        ejercicios: {
          type: 'ARRAY',
          description: 'Entre 1 y 8 ejercicios distintos del catalogo.',
          items: {
            type: 'OBJECT',
            properties: {
              ejercicio: { type: 'STRING', description: 'slug del catalogo, p. ej. sentadilla' },
              series: {
                type: 'ARRAY',
                description: 'Una entrada por serie (1 a 10).',
                items: {
                  type: 'OBJECT',
                  properties: {
                    repeticiones: { type: 'INTEGER', description: 'Para ejercicios por repeticiones (1-200)' },
                    peso_kg: { type: 'NUMBER', description: 'Opcional, 0-500' },
                    duracion_seg: { type: 'INTEGER', description: 'Para ejercicios por tiempo como la plancha (5-3600)' }
                  }
                }
              }
            },
            required: ['ejercicio', 'series']
          }
        }
      },
      required: ['ejercicios']
    }
  },
  {
    name: 'crear_reto_squad',
    description: 'PROPONE crear un reto para el squad del usuario. No lo crea: la app muestra un resumen y solo se crea si el usuario toca Confirmar. Muestra el resumen en tu respuesta.',
    parameters: {
      type: 'OBJECT',
      properties: {
        titulo: { type: 'STRING', description: '3 a 100 caracteres' },
        metrica: { type: 'STRING', enum: ['reps', 'sesiones', 'dias_activos', 'peso_maximo'] },
        meta: { type: 'INTEGER', description: 'reps 10-5000, sesiones 1-60, dias_activos 1-30 (y no mas que los dias), peso_maximo 1-300 kg' },
        dias: { type: 'INTEGER', description: 'Duracion, 1 a 30 dias' },
        ejercicio: { type: 'STRING', description: 'slug del catalogo; obligatorio para reps y peso_maximo' },
        modalidad: { type: 'STRING', enum: ['squad', 'individual'], description: 'squad = meta sumando entre todos; individual = cada uno debe cumplirla. peso_maximo siempre individual.' }
      },
      required: ['titulo', 'metrica', 'meta', 'dias']
    }
  },
  {
    name: 'guardar_preferencia',
    description: 'Recuerda una preferencia que el usuario te dijo explicitamente (para personalizar futuras respuestas). Nunca guardes datos de salud.',
    parameters: {
      type: 'OBJECT',
      properties: {
        clave: { type: 'STRING', enum: Object.keys(MEMORIA) },
        valor: { type: 'STRING', description: 'objetivo: fuerza|hipertrofia|resistencia|perdida_grasa|movilidad|salud_general; nivel: principiante|intermedio|avanzado; dias_semana: 1-7; horario: manana|mediodia|tarde|noche; minutos_sesion: 10-180; equipo: ninguno|mancuernas|bandas|gimnasio_completo' }
      },
      required: ['clave', 'valor']
    }
  },
  {
    name: 'transferir_a_humano',
    description: 'Pasa la conversacion al equipo humano de PlayFit (chat de Soporte). Usala si el usuario pide una persona, tiene un problema con su cuenta que no puedes resolver o pregunta por pagos.',
    parameters: { type: 'OBJECT', properties: { motivo: { type: 'STRING', enum: ['general', 'pago'] } } }
  }
];

// ---------------------------------------------------------------- preparacion de propuestas
const fmtSerie = (s) => (s.duracion_seg ? `${s.duracion_seg} s` : `${s.repeticiones}${s.peso_kg ? ` x ${s.peso_kg} kg` : ''}`);

function prepararSesion(args, catalogo, hoy) {
  const fecha = args.fecha || hoy;
  if (!clock.esFecha(fecha)) return { error: 'fecha invalida, usa YYYY-MM-DD' };
  if (fecha > hoy) return { error: 'no se pueden registrar sesiones futuras' };
  if (clock.diffDays(hoy, fecha) > 7) return { error: 'solo se pueden registrar sesiones de los ultimos 7 dias' };
  const lista = Array.isArray(args.ejercicios) ? args.ejercicios : [];
  if (lista.length < 1 || lista.length > 8) return { error: 'indica entre 1 y 8 ejercicios' };
  const ejercicios = [], partes = [];
  for (const item of lista) {
    const ej = buscarEjercicio(catalogo, item && item.ejercicio);
    if (!ej) return { error: `no existe el ejercicio "${item && item.ejercicio}". Usa un slug del catalogo` };
    if (ejercicios.some((e) => e.ejercicio_id === ej.id)) return { error: `${ej.nombre} esta repetido: junta sus series` };
    const series = Array.isArray(item.series) ? item.series : [];
    if (series.length < 1 || series.length > 10) return { error: `${ej.nombre}: indica entre 1 y 10 series` };
    const limpias = [];
    for (const s of series) {
      if (ej.mide_reps) {
        const reps = Number(s && s.repeticiones);
        if (!Number.isInteger(reps) || reps < 1 || reps > 200) return { error: `${ej.nombre}: cada serie necesita repeticiones (1-200). Preguntale al usuario` };
        const serie = { repeticiones: reps };
        if (s.peso_kg !== undefined && s.peso_kg !== null && Number(s.peso_kg) > 0) {
          const p = Math.round(Number(s.peso_kg) * 10) / 10;
          if (!(p <= 500)) return { error: `${ej.nombre}: peso_kg entre 0 y 500` };
          serie.peso_kg = p;
        }
        limpias.push(serie);
      } else {
        const d = Number(s && s.duracion_seg);
        if (!Number.isInteger(d) || d < 5 || d > 3600) return { error: `${ej.nombre} se mide por tiempo: cada serie necesita duracion_seg (5-3600)` };
        limpias.push({ duracion_seg: d });
      }
    }
    ejercicios.push({ ejercicio_id: ej.id, series: limpias });
    partes.push(`${ej.nombre}: ${limpias.map(fmtSerie).join(', ')}${ej.evitar.length ? ' (ojo: contraindicado por tu perfil)' : ''}`);
  }
  const cuando = fecha === hoy ? 'hoy' : fecha;
  return { datos: { fecha, ejercicios }, resumen: `Sesion de ${cuando}. ${partes.join('; ')}`.slice(0, 255) };
}

const LIMITES_META = { reps: [10, 5000], sesiones: [1, 60], dias_activos: [1, 30], peso_maximo: [1, 300] };
const UNIDAD = { reps: 'repeticiones', sesiones: 'sesiones', dias_activos: 'dias activos', peso_maximo: 'kg' };

function prepararReto(args, catalogo, squad) {
  if (!squad) return { error: 'el usuario no tiene squad: primero debe crear uno o unirse con un codigo' };
  const titulo = String(args.titulo || '').trim();
  if (titulo.length < 3 || titulo.length > 100) return { error: 'el titulo debe tener entre 3 y 100 caracteres' };
  const metrica = args.metrica;
  if (!LIMITES_META[metrica]) return { error: 'metrica invalida' };
  const dias = Number(args.dias), meta = Number(args.meta);
  if (!Number.isInteger(dias) || dias < 1 || dias > 30) return { error: 'dias debe ser un entero entre 1 y 30' };
  const [min, max] = LIMITES_META[metrica];
  const tope = metrica === 'dias_activos' ? Math.min(max, dias) : max;
  if (!Number.isInteger(meta) || meta < min || meta > tope) return { error: `meta debe ser un entero entre ${min} y ${tope}` };
  const tipo = metrica === 'peso_maximo' ? 'individual' : (args.modalidad === 'individual' ? 'individual' : 'squad');
  const datos = { titulo, metrica, meta, dias, tipo };
  let ejNombre = null;
  if (metrica === 'reps' || metrica === 'peso_maximo') {
    const ej = buscarEjercicio(catalogo, args.ejercicio);
    if (!ej) return { error: 'para reps o peso_maximo indica un ejercicio del catalogo' };
    if (metrica === 'peso_maximo' && !ej.mide_reps) return { error: `${ej.nombre} no se mide con peso` };
    datos.ejercicio_id = ej.id;
    ejNombre = ej.nombre;
  }
  const que = `${meta} ${UNIDAD[metrica]}${ejNombre ? ` de ${ejNombre}` : ''}`;
  const quien = tipo === 'squad' ? 'entre todos' : 'cada uno';
  return { datos, resumen: `Reto para ${squad.nombre}: "${titulo}". ${que} ${quien} en ${dias} dias.`.slice(0, 255) };
}

// ---------------------------------------------------------------- progreso (solo datos propios, sin nombres)
async function progreso(estudianteId, hoy) {
  const g = await one('SELECT xp_total, nivel, racha_actual, racha_maxima, ultima_actividad FROM perfil_gamificacion WHERE estudiante_id=:e', { e: estudianteId });
  const semana = await select(
    `SELECT s.fecha, GROUP_CONCAT(DISTINCT e.slug) AS ejercicios FROM sesiones_entrenamiento s
     JOIN series_ejercicio sr ON sr.sesion_id=s.id JOIN ejercicios e ON e.id=sr.ejercicio_id
     WHERE s.estudiante_id=:e AND s.fecha >= :desde GROUP BY s.id ORDER BY s.fecha`, { e: estudianteId, desde: clock.addDays(hoy, -6) });
  const sq = await one('SELECT s.id, s.nombre FROM squad_miembros sm JOIN squads s ON s.id=sm.squad_id WHERE sm.estudiante_id=:e', { e: estudianteId });
  const retos = sq ? await select('SELECT titulo, metrica, meta, fecha_fin FROM retos WHERE squad_id=:s AND activo=1 AND fecha_fin >= :h ORDER BY fecha_fin', { s: sq.id, h: hoy }) : [];
  return {
    hoy,
    xp_total: g ? g.xp_total : 0, nivel: g ? g.nivel : 1,
    racha_actual: g ? g.racha_actual : 0, racha_maxima: g ? g.racha_maxima : 0, ultimo_entreno: g ? g.ultima_actividad : null,
    sesiones_ultimos_7_dias: semana.map((s) => ({ fecha: s.fecha, ejercicios: s.ejercicios.split(',') })),
    squad: sq ? { nombre: sq.nombre, retos_vigentes: retos, cupos_para_retos: Math.max(0, 3 - retos.length) } : null
  };
}

// ---------------------------------------------------------------- ejecutor
// Crea el ejecutor de funciones para UN mensaje. Lo que hay que guardar en la BD (propuesta, transferencia)
// queda en `estado` y lo escribe ia.chat() en su transaccion final.
function crearEjecutor(actor, { catalogo, hoy }) {
  const estado = { propuesta: null, transferir: null, memoria: [], llamadas: [] };
  const ejecutar = async (nombre, args = {}) => {
    estado.llamadas.push(nombre);
    if (estado.llamadas.length > 6) return { ok: false, error: 'demasiadas llamadas en un solo mensaje; responde ya al usuario' };
    switch (nombre) {
      case 'consultar_progreso':
        return { ok: true, ...(await progreso(actor.id, hoy)) };
      case 'registrar_sesion':
      case 'crear_reto_squad': {
        if (estado.propuesta) return { ok: false, error: 'ya hay una propuesta en este mensaje; pide al usuario que la confirme primero' };
        const squad = nombre === 'crear_reto_squad'
          ? await one('SELECT s.nombre FROM squad_miembros sm JOIN squads s ON s.id=sm.squad_id WHERE sm.estudiante_id=:e', { e: actor.id }) : null;
        const p = nombre === 'registrar_sesion' ? prepararSesion(args, catalogo, hoy) : prepararReto(args, catalogo, squad);
        if (p.error) return { ok: false, error: p.error };
        estado.propuesta = { tipo: nombre, datos: p.datos, resumen: p.resumen };
        return { ok: true, pendiente_de_confirmacion: true, resumen: p.resumen, instruccion: 'Muestra el resumen y pidele que toque Confirmar en la tarjeta. NO digas que ya quedo hecho.' };
      }
      case 'guardar_preferencia': {
        const v = validarMemoria(args.clave, args.valor);
        if (v.error) return { ok: false, error: v.error };
        await guardarMemoria(actor.id, args.clave, v.valor);
        estado.memoria.push({ clave: args.clave, etiqueta: MEMORIA[args.clave].etiqueta, valor: v.valor });
        return { ok: true, guardado: { [args.clave]: v.valor } };
      }
      case 'transferir_a_humano':
        estado.transferir = args.motivo === 'pago' ? 'pago' : 'general';
        return { ok: true, instruccion: 'Dile que un asistente humano le respondera en el chat de Soporte.' };
      default:
        return { ok: false, error: `la funcion ${nombre} no existe` };
    }
  };
  return { ejecutar, estado };
}

module.exports = {
  MEMORIA, FUNCIONES, validarMemoria, leerMemoria, guardarMemoria, catalogoPara, buscarEjercicio,
  prepararSesion, prepararReto, progreso, crearEjecutor
};
