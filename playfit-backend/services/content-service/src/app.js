const express = require('express');
const { http, E } = require('@playfit/shared');
const content = require('./index');
const { ia } = content;
const { asyncHandler: ah, authenticate, intParam, createServiceApp } = http;

// `llm` se inyecta: en produccion es el cliente de Gemini; en pruebas, un modelo falso.
function createApp({ llm = null } = {}) {
  return createServiceApp('content-service', (app) => {
    const r = express.Router();
    r.use(authenticate);
    const body = (req) => req.body || {};
    const num = (v, nombre) => {
      if (v === undefined || v === '') return undefined;
      const n = Number(v);
      if (!Number.isFinite(n)) throw E.badRequest(`${nombre} debe ser un numero`);
      return n;
    };

    r.get('/exercises', ah(async (req, res) => res.json(await content.listarEjercicios({ grupo: req.query.group || null }))));
    r.get('/exercises/:id', ah(async (req, res) => res.json(await content.detalleEjercicio(intParam(req.params.id)))));
    r.get('/exercises/:id/tip', ah(async (req, res) => res.json({ tip: await content.tipPostSerie(intParam(req.params.id)) })));
    r.get('/nutrition', ah(async (req, res) => res.json(await content.listarNutricion({ categoria: req.query.category || null }))));

    // Mensaje de la mascota segun datos reales. Devuelve { mensaje: null } cuando la mascota NO debe aparecer.
    r.get('/mascot', ah(async (req, res) => {
      if (!req.query.context) throw E.badRequest('Indica ?context=bienvenida|racha|ranking|reto|comparacion|descanso|post_serie');
      const datos = { racha: num(req.query.racha, 'racha'), puesto: num(req.query.puesto, 'puesto'), estado: req.query.estado };
      const mensaje = await content.elegirMensaje(String(req.query.context), datos, { pantalla: req.query.pantalla || 'inicio', rol: req.actor.rol });
      res.json({ mensaje });
    }));

    // Asistente de IA (solo estudiantes con consentimiento; la logica aplica cuota y filtros de seguridad)
    r.post('/ai/chat', ah(async (req, res) => res.json(await ia.chat(req.actor, { conversacionId: body(req).conversacionId, mensaje: body(req).mensaje }, { llm }))));
    r.get('/ai/conversations', ah(async (req, res) => res.json(await ia.listarConversaciones(req.actor))));
    r.get('/ai/conversations/:id', ah(async (req, res) => res.json(await ia.verConversacion(req.actor, intParam(req.params.id)))));
    // propuestas del agente: la app avisa si el usuario las confirmo (y ya se ejecutaron) o las cancelo
    r.post('/ai/actions/:id', ah(async (req, res) => res.json(await ia.resolverAccion(req.actor, intParam(req.params.id), body(req)))));
    // memoria del agente: el usuario ve lo que recuerda y lo borra cuando quiera
    r.get('/ai/memory', ah(async (req, res) => res.json(await ia.verMemoria(req.actor))));
    r.delete('/ai/memory', ah(async (req, res) => { await ia.borrarMemoria(req.actor); res.status(204).end(); }));
    r.delete('/ai/memory/:clave', ah(async (req, res) => { await ia.borrarMemoria(req.actor, String(req.params.clave)); res.status(204).end(); }));

    app.use('/api/content', r);
  });
}
module.exports = { createApp };
