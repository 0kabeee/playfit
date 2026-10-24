const express = require('express');
const { http, push } = require('@playfit/shared');
const { E } = require('@playfit/shared');
const soc = require('./index');
const internal = require('./internal');
const pagos = require('./pagos');
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
    // retos creados por los miembros dentro de su squad
    r.post('/squads/me/challenges', ah(async (req, res) => res.status(201).json(await soc.crearRetoSquad(req.actor, body(req)))));
    r.delete('/challenges/:id', ah(async (req, res) => { await soc.cancelarRetoSquad(req.actor, intParam(req.params.id)); res.status(204).end(); }));

    // duelos 1 vs 1 dentro del squad
    r.get('/duels', ah(async (req, res) => res.json(await soc.listarDuelos(req.actor))));
    r.post('/duels', ah(async (req, res) => res.status(201).json(await soc.crearDuelo(req.actor, body(req)))));
    r.post('/duels/:id/respond', ah(async (req, res) => res.json(await soc.responderDuelo(req.actor, intParam(req.params.id), body(req).aceptar))));
    r.post('/duels/:id/cancel', ah(async (req, res) => { await soc.cancelarDuelo(req.actor, intParam(req.params.id)); res.status(204).end(); }));

    // soporte (usuario) y bandeja de soporte (admin)
    r.get('/support', ah(async (req, res) => res.json(await soc.miSoporte(req.actor))));
    r.post('/support/messages', ah(async (req, res) => res.status(201).json(await soc.enviarMensajeUsuario(req.actor, body(req).mensaje))));
    r.post('/support/close', ah(async (req, res) => { await soc.cerrarMiSoporte(req.actor); res.status(204).end(); }));
    r.get('/admin/support', ah(async (req, res) => res.json(await soc.bandeja(req.actor, { estado: req.query.estado || 'abiertas' }))));
    r.get('/admin/support/:id', ah(async (req, res) => res.json(await soc.verConversacionAdmin(req.actor, intParam(req.params.id), { ip: req.ip }))));
    r.post('/admin/support/:id/messages', ah(async (req, res) => res.status(201).json(await soc.responderAdmin(req.actor, intParam(req.params.id), body(req).mensaje, { ip: req.ip }))));
    r.post('/admin/support/:id/close', ah(async (req, res) => { await soc.cerrarAdmin(req.actor, intParam(req.params.id), { ip: req.ip }); res.status(204).end(); }));
    // Fase 14: el admin envia el enlace de pago de Wompi desde la conversacion de Soporte
    r.post('/admin/support/:id/payment-link', ah(async (req, res) => res.status(201).json(await pagos.enviarEnlacePago(req.actor, intParam(req.params.id), { ip: req.ip }))));

    // PlayFit Premium (Fase 14)
    r.get('/premium', ah(async (req, res) => res.json(await pagos.miPremium(req.actor))));
    r.get('/admin/payments', ah(async (req, res) => res.json(await pagos.listarPagosAdmin(req.actor))));
    r.post('/admin/users/:id/premium', ah(async (req, res) => res.status(201).json(await pagos.darCortesia(req.actor, intParam(req.params.id), body(req), { ip: req.ip }))));
    r.delete('/admin/users/:id/premium', ah(async (req, res) => { await pagos.revocarPremium(req.actor, intParam(req.params.id), body(req), { ip: req.ip }); res.status(204).end(); }));

    // administracion de retos oficiales (solo admin: el servicio lo valida por permiso)
    r.get('/admin/challenges', ah(async (req, res) => res.json(await soc.listarRetosAdmin(req.actor))));
    r.patch('/admin/challenges/:id', ah(async (req, res) => { await soc.cambiarEstadoReto(req.actor, intParam(req.params.id), body(req).activo); res.status(204).end(); }));

    // notificaciones, insignias y marcas personales
    r.get('/notifications', ah(async (req, res) => res.json(await soc.listarNotificaciones(req.actor))));
    r.post('/notifications/read', ah(async (req, res) => { await soc.marcarNotificacionesLeidas(req.actor); res.status(204).end(); }));
    // celulares para notificaciones push (FCM): la app registra su token al entrar y lo quita al cerrar sesion
    r.post('/devices', ah(async (req, res) => { await push.registrarDispositivo(req.actor.id, body(req).token); res.status(204).end(); }));
    r.delete('/devices', ah(async (req, res) => { await push.quitarDispositivo(req.actor.id, body(req).token); res.status(204).end(); }));
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

    // Wompi (SIN token de PlayFit): el webhook se valida con la FIRMA del evento y el retorno consulta a Wompi.
    // Van antes del router autenticado.
    const pub = express.Router();
    pub.post('/events', ah(async (req, res) => { const r2 = await pagos.recibirEvento(req.body); res.status(r2.status).json(r2.body); }));
    pub.get('/return', ah(async (req, res) => {
      const r2 = await pagos.retornoCheckout(typeof req.query.id === 'string' ? req.query.id : '');
      res.status(200).type('html').send(pagos.paginaRetorno(r2.resultado));
    }));
    app.use('/api/social/payments/wompi', pub);

    app.use('/api/social', r);
    // API interna para n8n (no la expone el gateway; ver internal.js)
    app.use('/internal', internal.router());
  });
}
module.exports = { createApp };
