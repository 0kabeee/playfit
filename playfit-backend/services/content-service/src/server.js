require('@playfit/shared/src/env').load();
const { http } = require('@playfit/shared');
const { ia } = require('./index');
const { createApp } = require('./app');

const llm = ia.crearClienteGemini(); // null si no hay GEMINI_API_KEY
if (!llm) console.warn('[content-service] AVISO: sin GEMINI_API_KEY, el asistente de IA responde 503 (lo demas funciona normal).');
http.startServer('content-service', createApp({ llm }), { puerto: Number(process.env.CONTENT_PORT || 3004) });
