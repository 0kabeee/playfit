// Chatbot con Gemini (free tier). REGLAS NO NEGOCIABLES:
//  1) Al modelo solo llegan CODIGOS de flags derivados (nunca texto clinico crudo, nunca nombres/correos).
//  2) Requiere consentimiento 'ia_chatbot' vigente.
//  3) Cuota diaria por estudiante para no agotar el free tier.
//  4) Mensajes con senales de alarma NO se envian al modelo: se responde con un aviso fijo.
const { one, select, insert, run, tx, E, AppError, rbac } = require('@playfit/shared');

const MAX_MENSAJE = 1000;
const limiteDiario = () => Number(process.env.IA_LIMITE_DIARIO || 20);

const SENALES_ALARMA = /dolor (fuerte )?(en el )?pecho|dolor de pecho|desmay|mareo (fuerte|intenso)|falta de aire|no puedo respirar|palpitaciones|vision borrosa|me duele (mucho|demasiado)|lesion grave/;
const normalizar = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const detectarEmergencia = (texto) => SENALES_ALARMA.test(normalizar(texto));
const MENSAJE_ALARMA = 'Lo que describes puede ser una senal de alerta. Deten el ejercicio, descansa y consulta con tu docente o un profesional de salud antes de seguir entrenando. Si es una emergencia, llama a la linea 123.';

async function construirSystemPrompt(estudianteId) {
  const flags = await select(
    `SELECT f.codigo, f.descripcion FROM estudiante_flags ef JOIN flags_clinicos f ON f.codigo=ef.flag_codigo
     WHERE ef.estudiante_id=:e AND f.codigo<>'SIN_RESTRICCIONES' ORDER BY f.codigo`, { e: estudianteId });
  const lineas = [
    'Eres el asistente de PlayFit, una app de entrenamiento para estudiantes universitarios.',
    'Das consejos generales de tecnica, rutinas basicas y habitos saludables, en espanol, en tono cercano y breve (maximo 120 palabras).',
    'No eres medico: nunca diagnostiques, no recomiendes medicamentos ni dietas extremas. Si el estudiante menciona dolor persistente, sugiere hablar con su docente o un profesional de salud.',
    'No inventes datos personales del estudiante.'
  ];
  if (flags.length) {
    lineas.push('Restricciones de seguridad del estudiante (respetalas SIEMPRE al recomendar ejercicios):');
    for (const f of flags) lineas.push(`- ${f.codigo}: ${f.descripcion}`);
  } else lineas.push('El estudiante no tiene restricciones registradas.');
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

  // Cuota atomica: se reserva ANTES de llamar al modelo; si el modelo falla se devuelve.
  await run('INSERT INTO ia_uso_diario (estudiante_id,fecha,solicitudes) VALUES (:e,CURDATE(),0) ON DUPLICATE KEY UPDATE solicitudes=solicitudes', { e: actor.id });
  const reserva = await run('UPDATE ia_uso_diario SET solicitudes=solicitudes+1 WHERE estudiante_id=:e AND fecha=CURDATE() AND solicitudes < :l', { e: actor.id, l: limiteDiario() });
  const afectadas = reserva[0]?.affectedRows ?? reserva[1]?.affectedRows ?? reserva[1];
  if (!afectadas) throw E.tooMany(`Alcanzaste el limite de ${limiteDiario()} mensajes al asistente por hoy. Vuelve manana.`, 'CUOTA_IA_AGOTADA');
  const devolverCuota = () => run('UPDATE ia_uso_diario SET solicitudes=GREATEST(solicitudes-1,0) WHERE estudiante_id=:e AND fecha=CURDATE()', { e: actor.id });

  let respuesta, flagsAplicados = [];
  const alarma = detectarEmergencia(mensaje);
  try {
    if (alarma) respuesta = MENSAJE_ALARMA;
    else {
      if (!llm) throw new AppError(503, 'IA_NO_CONFIGURADA', 'El asistente de IA no esta configurado en el servidor');
      const system = await construirSystemPrompt(actor.id);
      flagsAplicados = (await select(`SELECT flag_codigo FROM estudiante_flags WHERE estudiante_id=:e AND flag_codigo<>'SIN_RESTRICCIONES'`, { e: actor.id })).map((f) => f.flag_codigo);
      const historial = conv ? (await select('SELECT rol,contenido FROM mensajes_ia WHERE conversacion_id=:c ORDER BY id DESC LIMIT 10', { c: conv.id })).reverse() : [];
      respuesta = await llm.generate({ system, history: historial.map((h) => ({ role: h.rol, text: h.contenido })), userMessage: mensaje.trim() });
      if (typeof respuesta !== 'string' || !respuesta.trim()) throw E.badRequest('El asistente no pudo responder, intenta de nuevo', 'IA_RESPUESTA_VACIA');
    }
  } catch (err) {
    await devolverCuota();
    throw err;
  }

  return tx(async (t) => {
    const convId = conv ? conv.id : await insert('INSERT INTO conversaciones_ia (estudiante_id,titulo) VALUES (:e,:t)', { e: actor.id, t: mensaje.trim().slice(0, 100) }, t);
    await insert(`INSERT INTO mensajes_ia (conversacion_id,rol,contenido) VALUES (:c,'usuario',:m)`, { c: convId, m: mensaje.trim() }, t);
    await insert(`INSERT INTO mensajes_ia (conversacion_id,rol,contenido,flags_aplicados) VALUES (:c,'modelo',:m,:f)`,
      { c: convId, m: respuesta, f: flagsAplicados.length ? JSON.stringify(flagsAplicados) : null }, t);
    const uso = await one('SELECT solicitudes FROM ia_uso_diario WHERE estudiante_id=:e AND fecha=CURDATE()', { e: actor.id }, t);
    return { conversacion_id: convId, respuesta, alerta_salud: alarma, restantes_hoy: Math.max(0, limiteDiario() - Number(uso.solicitudes)) };
  });
}

async function listarConversaciones(actor) {
  rbac.requirePermiso(actor, 'ia:usar');
  return select('SELECT id,titulo,created_at FROM conversaciones_ia WHERE estudiante_id=:e ORDER BY id DESC LIMIT 30', { e: actor.id });
}
async function verConversacion(actor, id) {
  rbac.requirePermiso(actor, 'ia:usar');
  const c = await one('SELECT id,titulo FROM conversaciones_ia WHERE id=:id AND estudiante_id=:e', { id, e: actor.id });
  if (!c) throw E.notFound('Conversacion no encontrada');
  return { ...c, mensajes: await select('SELECT rol,contenido,created_at FROM mensajes_ia WHERE conversacion_id=:id ORDER BY id', { id }) };
}

// Cliente real de Gemini (REST). Se inyecta en chat() para poder probar con un modelo falso.
function crearClienteGemini({ apiKey = process.env.GEMINI_API_KEY, modelo = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite', fetchFn = fetch } = {}) {
  if (!apiKey) return null;
  return {
    async generate({ system, history, userMessage }) {
      const contents = [...history.map((h) => ({ role: h.role === 'modelo' ? 'model' : 'user', parts: [{ text: h.text }] })), { role: 'user', parts: [{ text: userMessage }] }];
      const res = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { maxOutputTokens: 400, temperature: 0.6 } })
      });
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
      return data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
    }
  };
}

module.exports = { chat, listarConversaciones, verConversacion, crearClienteGemini, construirSystemPrompt, detectarEmergencia, MENSAJE_ALARMA };
