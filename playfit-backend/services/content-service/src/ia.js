// Chatbot con Gemini (free tier). REGLAS NO NEGOCIABLES:
//  1) Al modelo solo llegan CODIGOS de flags derivados (nunca texto clinico crudo, nunca nombres/correos).
//  2) Requiere consentimiento 'ia_chatbot' vigente.
//  3) Cuota diaria por estudiante para no agotar el free tier.
//  4) Mensajes con senales de alarma NO se envian al modelo: se responde con un aviso fijo.
//  5) Mensajes sobre PAGOS / Premium tampoco van al modelo: se transfieren a un humano (chat de Soporte, Fase 12).
//  6) (Fase 13) El modelo es un AGENTE: puede llamar funciones (ver agente.js). Las que cambian datos solo quedan
//     como PROPUESTA hasta que el usuario toca Confirmar en la app.
//  7) (Fase 14) PlayFit Premium: la MEMORIA del agente y un cupo diario mayor son Premium. Sin Premium el modelo no
//     recibe la funcion guardar_preferencia ni lo guardado (lo guardado no se borra: vuelve si renueva).
const { one, select, insert, run, tx, E, AppError, rbac, soporte, eventos, clock, premium: PREM } = require('@playfit/shared');
const agente = require('./agente');

const MAX_MENSAJE = 1000;
const limiteDiario = (esPremium = false) => (esPremium
  ? Number(process.env.IA_LIMITE_PREMIUM || 60)
  : Number(process.env.IA_LIMITE_DIARIO || 20));

const SENALES_ALARMA = /dolor (fuerte )?(en el )?pecho|dolor de pecho|desmay|mareo (fuerte|intenso)|falta de aire|no puedo respirar|palpitaciones|vision borrosa|me duele (mucho|demasiado)|lesion grave/;
const normalizar = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const detectarEmergencia = (texto) => SENALES_ALARMA.test(normalizar(texto));

// Red de seguridad: si el modelo dice que YA hizo algo que cambia datos pero no llamo a ninguna funcion que lo haga,
// se corrige la respuesta (el servidor sabe lo que realmente paso, el modelo no siempre dice la verdad).
const PROMESA_HECHA = /\b(ya|he|hemos|acabo de)\s+(lo\s+|la\s+|te\s+)?(registr|cre[eo]|elimin|borr|cambi|actualiz|envi|reset|restabl|desactiv|activ|cancel|acept|aprob|asign|sume|otorg)/;
function corregirPromesas(respuesta, estado) {
  if (typeof respuesta !== 'string' || !PROMESA_HECHA.test(normalizar(respuesta))) return respuesta;
  const e = estado || {};
  if (e.propuesta) return `${respuesta}\n\n(Ojo: todavia no esta guardado. Toca Confirmar en la tarjeta para que quede.)`;
  if (e.memoria && e.memoria.length) return respuesta; // guardar preferencias si lo hace de verdad
  if (e.transferir) return respuesta;
  return `${respuesta}\n\n(Ojo: desde el chat no hice ningun cambio. Lo que puedo hacer es proponerte registrar una sesion o crear un reto del squad, guardar tus preferencias o pasarte con una persona del equipo.)`;
}
const MENSAJE_ALARMA = 'Lo que describes puede ser una senal de alerta. Deten el ejercicio, descansa y consulta con un profesional de salud antes de seguir entrenando. Si es una emergencia, llama a la linea 123.';

const VALOR_LEGIBLE = (v) => String(v).replace(/_/g, ' ');

async function construirSystemPrompt(estudianteId, { hoy = clock.hoy(), catalogo = null, memoria = null, acciones = [], premium = true } = {}) {
  const flags = await select(
    `SELECT f.codigo, f.descripcion FROM estudiante_flags ef JOIN flags_clinicos f ON f.codigo=ef.flag_codigo
     WHERE ef.estudiante_id=:e AND f.codigo<>'SIN_RESTRICCIONES' ORDER BY f.codigo`, { e: estudianteId });
  const cat = catalogo || await agente.catalogoPara(estudianteId);
  const mem = premium ? (memoria || await agente.leerMemoria(estudianteId)) : [];
  const lineas = [
    'Eres el asistente de PlayFit, una app de entrenamiento para estudiantes universitarios.',
    'Das consejos generales de tecnica, rutinas basicas y habitos saludables, en espanol, en tono cercano y breve (maximo 120 palabras).',
    'No eres medico: nunca diagnostiques, no recomiendes medicamentos ni dietas extremas. Si el usuario menciona dolor persistente, sugiere hablar con un profesional de salud.',
    'No inventes datos personales del estudiante.',
    `Hoy es ${hoy}.`,
    '',
    'Puedes usar funciones:',
    '- registrar_sesion y crear_reto_squad solo PROPONEN: la app muestra una tarjeta y el usuario decide. Nunca digas que algo ya quedo registrado o creado.',
    '- Si te falta un dato (series, repeticiones, meta, dias), pregunta antes de proponer.',
    '- consultar_progreso para hablar de su racha, XP, sesiones o retos con datos reales.',
    premium
      ? '- guardar_preferencia cuando el usuario te diga su objetivo, experiencia, dias, horario, minutos por sesion o equipo.'
      : '- El usuario NO es Premium: no puedes recordar sus preferencias entre conversaciones. Si te pide que recuerdes algo, dile que la memoria del asistente es parte de PlayFit Premium (se pide en Perfil > PlayFit Premium) y responde con lo que te diga en este chat.',
    '- Para rutinas usa SOLO ejercicios del catalogo y nunca los marcados EVITAR. Adapta la rutina a lo que recuerdas del usuario.',
    '- transferir_a_humano si pide una persona o tiene un problema de cuenta que no puedes resolver.',
    '',
    'LIMITES (obligatorios):',
    '- Solo puedes hacer lo que hacen las funciones de arriba. No tienes ninguna otra capacidad.',
    '- NO puedes: cambiar o recuperar contrasenas, borrar o modificar cuentas, unirte o sacar a alguien de un squad, crear o aceptar duelos, tocar el ranking, dar o quitar XP o insignias, procesar pagos, activar el Premium ni ver datos de otras personas.',
    '- Si piden algo que no puedes hacer, dilo con claridad ("eso no lo puedo hacer desde el chat") e indica donde se hace en la app (Squad, Retos, Perfil > Cuenta) o ofrece transferir a una persona con transferir_a_humano. NUNCA finjas haberlo hecho.',
    '- Nunca digas que hiciste algo si no llamaste a la funcion correspondiente. Registrar sesiones y crear retos solo se proponen: dilo asi.',
    '- Si no sabes algo o esta fuera de entrenamiento, nutricion basica y habitos saludables, di que no tienes esa informacion en lugar de inventarla. No inventes cifras, nombres, fechas ni funciones de la app.',
    '',
    'Catalogo de ejercicios (slug: nombre, grupo, como se mide):'
  ];
  for (const e of cat) {
    lineas.push(`- ${e.slug}: ${e.nombre}, ${e.grupo_muscular}, ${e.mide_reps ? 'repeticiones' : 'tiempo'}${e.evitar.length ? ` - EVITAR (${e.evitar.join(', ')})` : ''}`);
  }
  if (flags.length) {
    lineas.push('Restricciones de seguridad del estudiante (respetalas SIEMPRE al recomendar ejercicios):');
    for (const f of flags) lineas.push(`- ${f.codigo}: ${f.descripcion}`);
  } else lineas.push('El estudiante no tiene restricciones registradas.');
  if (!premium) {
    // sin memoria: no se le pide al modelo que pregunte para guardar
  } else if (mem.length) {
    lineas.push('Lo que el usuario te conto de si mismo (preferencias guardadas):');
    for (const m of mem) lineas.push(`- ${agente.MEMORIA[m.clave] ? agente.MEMORIA[m.clave].etiqueta : m.clave}: ${VALOR_LEGIBLE(m.valor)}`);
  } else lineas.push('Aun no sabes sus preferencias; si es natural, preguntale su objetivo y con cuantos dias cuenta.');
  if (acciones.length) {
    lineas.push('Propuestas recientes en esta conversacion:');
    for (const a of acciones) lineas.push(`- ${a.resumen} -> ${a.estado === 'propuesta' ? 'sin confirmar todavia' : a.estado}`);
  }
  return lineas.join('\n');
}

async function chat(actor, { conversacionId = null, mensaje } = {}, { llm } = {}) {
  rbac.requirePermiso(actor, 'ia:usar');
  if (typeof mensaje !== 'string' || mensaje.trim().length === 0) throw E.badRequest('Escribe un mensaje');
  if (mensaje.length > MAX_MENSAJE) throw E.badRequest(`El mensaje no puede superar ${MAX_MENSAJE} caracteres`);
  const c = await one(`SELECT aceptado FROM consentimientos WHERE usuario_id=:u AND tipo='ia_chatbot' ORDER BY id DESC LIMIT 1`, { u: actor.id });
  if (!c || !c.aceptado) throw E.forbidden('Debes aceptar el uso del asistente de IA para usarlo', 'CONSENTIMIENTO_REQUERIDO');

  let conv = null;
  if (conversacionId) {
    conv = await one('SELECT id FROM conversaciones_ia WHERE id=:id AND estudiante_id=:e', { id: conversacionId, e: actor.id });
    if (!conv) throw E.notFound('Conversacion no encontrada');
  }

  const esPremium = await PREM.esPremium(actor.id);
  const limite = limiteDiario(esPremium);

  // Pagos: "Un momento, ya te transfiero a un asistente humano" -> la conversacion llega a la bandeja del admin.
  // No gasta cuota ni se envia nada al modelo.
  if (!detectarEmergencia(mensaje) && soporte.detectarPago(mensaje)) {
    return tx(async (t) => {
      const convId = conv ? conv.id : await insert('INSERT INTO conversaciones_ia (estudiante_id,titulo) VALUES (:e,:t)', { e: actor.id, t: mensaje.trim().slice(0, 100) }, t);
      await insert(`INSERT INTO mensajes_ia (conversacion_id,rol,contenido) VALUES (:c,'usuario',:m)`, { c: convId, m: mensaje.trim() }, t);
      await insert(`INSERT INTO mensajes_ia (conversacion_id,rol,contenido) VALUES (:c,'modelo',:m)`, { c: convId, m: soporte.MSG_TRANSFERENCIA }, t);
      const sop = await soporte.transferirDesdeIa(actor.id, mensaje.trim(), 'pago', t);
      const uso = await one('SELECT solicitudes FROM ia_uso_diario WHERE estudiante_id=:e AND fecha=CURDATE()', { e: actor.id }, t);
      return {
        conversacion_id: convId, respuesta: soporte.MSG_TRANSFERENCIA, alerta_salud: false,
        transferido_a_soporte: true, soporte_conversacion_id: sop.id, accion: null, memoria_actualizada: [],
        restantes_hoy: Math.max(0, limite - Number(uso ? uso.solicitudes : 0)), premium: esPremium,
        _aviso: sop.transferida ? sop.id : null
      };
    }).then(avisarTransferencia('pago'));
  }

  // Cuota atomica: se reserva ANTES de llamar al modelo; si el modelo falla se devuelve.
  await run('INSERT INTO ia_uso_diario (estudiante_id,fecha,solicitudes) VALUES (:e,CURDATE(),0) ON DUPLICATE KEY UPDATE solicitudes=solicitudes', { e: actor.id });
  const reserva = await run('UPDATE ia_uso_diario SET solicitudes=solicitudes+1 WHERE estudiante_id=:e AND fecha=CURDATE() AND solicitudes < :l', { e: actor.id, l: limite });
  const afectadas = reserva[0]?.affectedRows ?? reserva[1]?.affectedRows ?? reserva[1];
  if (!afectadas) {
    throw E.tooMany(`Alcanzaste el limite de ${limite} mensajes al asistente por hoy. Vuelve manana${esPremium ? '' : ' o hazte Premium para tener mas'}.`, 'CUOTA_IA_AGOTADA');
  }
  const devolverCuota = () => run('UPDATE ia_uso_diario SET solicitudes=GREATEST(solicitudes-1,0) WHERE estudiante_id=:e AND fecha=CURDATE()', { e: actor.id });

  let respuesta, flagsAplicados = [], ejecutor = null;
  const alarma = detectarEmergencia(mensaje);
  try {
    if (alarma) respuesta = MENSAJE_ALARMA;
    else {
      if (!llm) throw new AppError(503, 'IA_NO_CONFIGURADA', 'El asistente de IA no esta configurado en el servidor');
      const hoy = clock.hoy();
      const catalogo = await agente.catalogoPara(actor.id);
      const acciones = conv ? await select('SELECT resumen, estado FROM ia_acciones WHERE conversacion_id=:c ORDER BY id DESC LIMIT 3', { c: conv.id }) : [];
      const system = await construirSystemPrompt(actor.id, { hoy, catalogo, acciones: acciones.reverse(), premium: esPremium });
      flagsAplicados = (await select(`SELECT flag_codigo FROM estudiante_flags WHERE estudiante_id=:e AND flag_codigo<>'SIN_RESTRICCIONES'`, { e: actor.id })).map((f) => f.flag_codigo);
      const historial = conv ? (await select('SELECT rol,contenido FROM mensajes_ia WHERE conversacion_id=:c ORDER BY id DESC LIMIT 10', { c: conv.id })).reverse() : [];
      ejecutor = agente.crearEjecutor(actor, { catalogo, hoy, premium: esPremium });
      respuesta = await llm.generate({
        system, history: historial.map((h) => ({ role: h.rol, text: h.contenido })), userMessage: mensaje.trim(),
        tools: agente.funcionesPara(esPremium), ejecutarFuncion: ejecutor.ejecutar
      });
      if (typeof respuesta === 'string' && respuesta.trim()) respuesta = corregirPromesas(respuesta, ejecutor.estado);
      if (typeof respuesta !== 'string' || !respuesta.trim()) {
        // el modelo pudo quedarse solo con la llamada a la funcion: se responde con el resumen
        const e = ejecutor.estado;
        if (e.propuesta) respuesta = `${e.propuesta.resumen}\n\n¿Lo confirmas?`;
        else if (e.transferir) respuesta = soporte.MSG_TRANSFERENCIA;
        else throw E.badRequest('El asistente no pudo responder, intenta de nuevo', 'IA_RESPUESTA_VACIA');
      }
    }
  } catch (err) {
    await devolverCuota();
    throw err;
  }
  const est = ejecutor ? ejecutor.estado : { propuesta: null, transferir: null, memoria: [] };

  return tx(async (t) => {
    const convId = conv ? conv.id : await insert('INSERT INTO conversaciones_ia (estudiante_id,titulo) VALUES (:e,:t)', { e: actor.id, t: mensaje.trim().slice(0, 100) }, t);
    await insert(`INSERT INTO mensajes_ia (conversacion_id,rol,contenido) VALUES (:c,'usuario',:m)`, { c: convId, m: mensaje.trim() }, t);
    let accion = null;
    if (est.propuesta) {
      const id = await insert('INSERT INTO ia_acciones (conversacion_id,estudiante_id,tipo,datos,resumen) VALUES (:c,:e,:t,:d,:r)',
        { c: convId, e: actor.id, t: est.propuesta.tipo, d: JSON.stringify(est.propuesta.datos), r: est.propuesta.resumen }, t);
      accion = { id, tipo: est.propuesta.tipo, resumen: est.propuesta.resumen, datos: est.propuesta.datos, estado: 'propuesta' };
    }
    await insert(`INSERT INTO mensajes_ia (conversacion_id,rol,contenido,flags_aplicados,accion_id) VALUES (:c,'modelo',:m,:f,:a)`,
      { c: convId, m: respuesta, f: flagsAplicados.length ? JSON.stringify(flagsAplicados) : null, a: accion ? accion.id : null }, t);
    let sop = null;
    if (est.transferir) sop = await soporte.transferirDesdeIa(actor.id, mensaje.trim(), est.transferir, t);
    const uso = await one('SELECT solicitudes FROM ia_uso_diario WHERE estudiante_id=:e AND fecha=CURDATE()', { e: actor.id }, t);
    return {
      conversacion_id: convId, respuesta, alerta_salud: alarma,
      transferido_a_soporte: !!sop, ...(sop ? { soporte_conversacion_id: sop.id } : {}),
      accion, memoria_actualizada: est.memoria,
      restantes_hoy: Math.max(0, limite - Number(uso.solicitudes)), premium: esPremium,
      _aviso: sop && sop.transferida ? sop.id : null
    };
  }).then(avisarTransferencia(est.transferir));
}

// Despues del commit: avisa a los admins (via n8n o respaldo) y quita el campo interno de la respuesta.
const avisarTransferencia = (motivo) => async (r) => {
  const { _aviso, ...resto } = r;
  if (_aviso) await eventos.soporteTransferida(_aviso, motivo);
  return resto;
};

// ---------------------------------------------------------------- acciones propuestas
const accionPublica = (a) => ({
  id: a.id, tipo: a.tipo, resumen: a.resumen, estado: a.estado, resultado_id: a.resultado_id,
  datos: typeof a.datos === 'string' ? JSON.parse(a.datos) : a.datos
});

// La app informa el resultado: 'confirmada' (despues de ejecutar el endpoint normal con exito) o 'cancelada'.
async function resolverAccion(actor, id, { estado, resultado_id: resultadoId = null } = {}) {
  rbac.requirePermiso(actor, 'ia:usar');
  if (!['confirmada', 'cancelada'].includes(estado)) throw E.badRequest('estado debe ser "confirmada" o "cancelada"');
  if (resultadoId !== null && resultadoId !== undefined && !(Number.isInteger(resultadoId) && resultadoId > 0)) throw E.badRequest('resultado_id invalido');
  return tx(async (t) => {
    const a = await one('SELECT * FROM ia_acciones WHERE id=:id AND estudiante_id=:e FOR UPDATE', { id, e: actor.id }, t);
    if (!a) throw E.notFound('Accion no encontrada');
    if (a.estado !== 'propuesta') throw E.conflict('Esta propuesta ya fue resuelta', 'ACCION_YA_RESUELTA');
    await run('UPDATE ia_acciones SET estado=:s, resultado_id=:r, resuelta_at=UTC_TIMESTAMP() WHERE id=:id',
      { s: estado, r: estado === 'confirmada' ? resultadoId || null : null, id }, t);
    return accionPublica(await one('SELECT * FROM ia_acciones WHERE id=:id', { id }, t));
  });
}

// ---------------------------------------------------------------- memoria (el usuario la ve y la borra)
async function verMemoria(actor) {
  rbac.requirePermiso(actor, 'ia:usar');
  const filas = await agente.leerMemoria(actor.id);
  return filas.map((m) => ({ clave: m.clave, etiqueta: agente.MEMORIA[m.clave] ? agente.MEMORIA[m.clave].etiqueta : m.clave, valor: m.valor, updated_at: m.updated_at }));
}
async function borrarMemoria(actor, clave = null) {
  rbac.requirePermiso(actor, 'ia:usar');
  if (clave === null) await run('DELETE FROM ia_memoria WHERE estudiante_id=:e', { e: actor.id });
  else {
    if (!agente.MEMORIA[clave]) throw E.notFound('Preferencia no encontrada');
    await run('DELETE FROM ia_memoria WHERE estudiante_id=:e AND clave=:c', { e: actor.id, c: clave });
  }
}

async function listarConversaciones(actor) {
  rbac.requirePermiso(actor, 'ia:usar');
  return select('SELECT id,titulo,created_at FROM conversaciones_ia WHERE estudiante_id=:e ORDER BY id DESC LIMIT 30', { e: actor.id });
}
async function verConversacion(actor, id) {
  rbac.requirePermiso(actor, 'ia:usar');
  const c = await one('SELECT id,titulo FROM conversaciones_ia WHERE id=:id AND estudiante_id=:e', { id, e: actor.id });
  if (!c) throw E.notFound('Conversacion no encontrada');
  const mensajes = await select('SELECT rol,contenido,accion_id,created_at FROM mensajes_ia WHERE conversacion_id=:id ORDER BY id', { id });
  const acciones = await select('SELECT * FROM ia_acciones WHERE conversacion_id=:id', { id });
  const porId = Object.fromEntries(acciones.map((a) => [a.id, accionPublica(a)]));
  return { ...c, mensajes: mensajes.map(({ accion_id: aid, ...m }) => ({ ...m, accion: aid ? porId[aid] || null : null })) };
}

// Cliente real de Gemini (REST). Se inyecta en chat() para poder probar con un modelo falso.
// Con `tools` hace el ciclo de function calling: si el modelo pide funciones se ejecutan con `ejecutarFuncion`
// y se le devuelven los resultados, hasta MAX_RONDAS; la ultima vuelta se pide sin funciones para forzar texto.
// Las partes del modelo se reenvian TAL CUAL (los modelos Gemini 3 exigen devolver su "thought signature").
const MAX_RONDAS = 3;
function crearClienteGemini({ apiKey = process.env.GEMINI_API_KEY, modelo = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite', fetchFn = fetch } = {}) {
  if (!apiKey) return null;

  async function llamar(body) {
    let res;
    try {
      res = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000)   // si Gemini no responde en 20 s se corta (el mensaje sigue siendo valido)
      });
    } catch (e) {
      if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw new AppError(504, 'IA_LENTA', 'El asistente tardo demasiado en responder. Intenta de nuevo.');
      throw e;
    }
    if (res.status === 429) throw E.tooMany('El asistente esta saturado, intenta en un minuto', 'IA_SATURADA');
    // Problemas de configuracion del servidor (no del estudiante): se registran en la consola y se avisa con claridad.
    if (res.status === 404) {
      console.error(`[ia] el modelo "${modelo}" ya no existe en la API de Gemini: cambia GEMINI_MODEL en el .env (ver README)`);
      throw new AppError(503, 'IA_MODELO_NO_DISPONIBLE', 'El modelo de IA configurado ya no esta disponible. Avisa al administrador del sistema.');
    }
    if (res.status === 401 || res.status === 403) {
      console.error(`[ia] Gemini rechazo la clave (HTTP ${res.status}): revisa GEMINI_API_KEY en el .env`);
      throw new AppError(503, 'IA_CLAVE_INVALIDA', 'El asistente de IA no esta bien configurado. Avisa al administrador del sistema.');
    }
    if (!res.ok) throw E.badRequest(`El servicio de IA respondio con error ${res.status}`, 'IA_ERROR');
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts || [];
  }
  const texto = (parts) => parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('');

  return {
    async generate({ system, history, userMessage, tools = null, ejecutarFuncion = null }) {
      const contents = [...history.map((h) => ({ role: h.role === 'modelo' ? 'model' : 'user', parts: [{ text: h.text }] })), { role: 'user', parts: [{ text: userMessage }] }];
      const base = { systemInstruction: { parts: [{ text: system }] }, generationConfig: { maxOutputTokens: 400, temperature: 0.6 } };
      const conFunciones = !!(tools && tools.length && ejecutarFuncion);
      for (let ronda = 0; ; ronda++) {
        const ultima = !conFunciones || ronda >= MAX_RONDAS;
        const body = { ...base, contents };
        if (conFunciones) {
          body.tools = [{ functionDeclarations: tools }];
          if (ultima) body.toolConfig = { functionCallingConfig: { mode: 'NONE' } };
        }
        const parts = await llamar(body);
        const llamadas = parts.filter((p) => p.functionCall);
        if (ultima || !llamadas.length) return texto(parts);
        contents.push({ role: 'model', parts });
        const respuestas = [];
        for (const p of llamadas) {
          const { name, args } = p.functionCall;
          let resultado;
          try { resultado = await ejecutarFuncion(name, args || {}); }
          catch (e) { console.error(`[ia] la funcion ${name} fallo: ${e.message}`); resultado = { ok: false, error: 'error interno al ejecutar la funcion' }; }
          respuestas.push({ functionResponse: { name, response: resultado } });
        }
        contents.push({ role: 'user', parts: respuestas });
      }
    }
  };
}

module.exports = {
  chat, listarConversaciones, verConversacion, resolverAccion, verMemoria, borrarMemoria,
  crearClienteGemini, construirSystemPrompt, detectarEmergencia, corregirPromesas, MENSAJE_ALARMA
};
