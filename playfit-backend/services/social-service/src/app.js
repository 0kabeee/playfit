const express = require('express');
const { http } = require('@playfit/shared');
const { E } = require('@playfit/shared');
const soc = require('./index');
const { asyncHandler: ah, authenticate, intParam, optInt, createServiceApp } = http;

function createApp() {
  return createServiceApp('social-service', (app) => {
    const r = express.Router();
    r.use(authenticate);
    const body = (req) => req.body || {};

    // pantalla principal y sesiones
    r.get('/dashboard', ah(async (req, res) => res.json(await soc.dashboard(req.actor))));
    r.post('/sessions', ah(async (req, res) => res.status(201).json(await soc.registrarSesion(req.actor, body(req)))));
    r.get('/sessions', ah(async (req, res) => res.json(await soc.historialSesiones(req.actor, { limite: req.query.limit }))));

    // retos
    r.get('/challenges', ah(async (req, res) => res.json(await soc.listarRetos(req.actor))));
    r.post('/challenges', ah(async (req, res) => res.status(201).json(await soc.crearReto(req.actor, body(req)))));
    r.get('/challenges/:id', ah(async (req, res) => res.json(await soc.detalleReto(req.actor, intParam(req.params.id)))));
    r.post('/challenges/:id/join', ah(async (req, res) => res.json(await soc.unirseReto(req.actor, intParam(req.params.id)))));

    // notificaciones, insignias y marcas personales
    r.get('/notifications', ah(async (req, res) => res.json(await soc.listarNotificaciones(req.actor))));
    r.post('/notifications/read', ah(async (req, res) => { await soc.marcarNotificacionesLeidas(req.actor); res.status(204).end(); }));
    r.get('/badges', ah(async (req, res) => res.json(await soc.catalogoInsignias(req.actor))));
    r.get('/records', ah(async (req, res) => {
      const q = req.query.student;
      res.json(await soc.marcasPersonales(req.actor, !q || q === 'me' ? req.actor.id : intParam(q, 'student')));
    }));

    // squads (las rutas fijas van ANTES de /squads/:id)
    r.post('/squads', ah(async (req, res) => res.status(201).json(await soc.crearSquad(req.actor, body(req)))));
    r.post('/squads/join', ah(async (req, res) => res.json(await soc.unirseSquad(req.actor, body(req).codigo))));
    r.post('/squads/leave', ah(async (req, res) => res.json(await soc.salirSquad(req.actor))));
    r.get('/squads/me', ah(async (req, res) => res.json({ squad: await soc.miSquad(req.actor) })));
    r.get('/squads/compare', ah(async (req, res) => {
      if (!req.query.with || !req.query.exercise) throw E.badRequest('Indica ?with=<id del companero>&exercise=<id del ejercicio>');
      res.json(await soc.compararMiembros(req.actor, intParam(req.query.with, 'with'), intParam(req.query.exercise, 'exercise')));
    }));
    r.get('/squads/:id', ah(async (req, res) => res.json(await soc.detalleSquad(req.actor, intParam(req.params.id)))));

    // rankings
    r.get('/rankings/xp', ah(async (req, res) => res.json(await soc.rankingXp(req.actor, { limite: req.query.limit, squadId: optInt(req.query.squad, 'squad') }))));
    r.get('/rankings/exercises/:id', ah(async (req, res) => res.json(await soc.rankingEjercicio(req.actor, intParam(req.params.id), { limite: req.query.limit }))));

    app.use('/api/social', r);
  });
}
module.exports = { createApp };
