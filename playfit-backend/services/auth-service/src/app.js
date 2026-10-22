const express = require('express');
const { http } = require('@playfit/shared');
const { E } = require('@playfit/shared');
const auth = require('./authService');
const { asyncHandler: ah, authenticate, requireRole, intParam, createServiceApp } = http;

function createApp() {
  return createServiceApp('auth-service', (app) => {
    const r = express.Router();
    const body = (req) => req.body || {};

    r.post('/register', ah(async (req, res) => res.status(201).json(await auth.registrarEstudiante(body(req), { ip: req.ip }))));
    r.post('/login', ah(async (req, res) => res.json(await auth.login(body(req).email, body(req).password, { ip: req.ip }))));
    r.post('/refresh', ah(async (req, res) => res.json(await auth.refrescar(body(req).refreshToken))));
    r.post('/logout', ah(async (req, res) => { await auth.logout(body(req).refreshToken); res.status(204).end(); }));

    r.get('/me', authenticate, ah(async (req, res) => res.json(await auth.perfil(req.actor))));
    r.post('/password', authenticate, ah(async (req, res) => {
      await auth.cambiarPassword(req.actor, body(req).actual, body(req).nueva);
      res.status(204).end();
    }));

    r.delete('/me', authenticate, requireRole('estudiante'), ah(async (req, res) => {
      await auth.eliminarCuenta(req.actor, body(req).password, { ip: req.ip });
      res.status(204).end();
    }));

    r.get('/consents', authenticate, ah(async (req, res) => res.json(await auth.listarConsentimientos(req.actor))));
    r.put('/consents/:tipo', authenticate, requireRole('estudiante'), ah(async (req, res) => {
      if (typeof body(req).aceptado !== 'boolean') throw E.badRequest('"aceptado" debe ser true o false');
      await auth.registrarConsentimiento(req.actor, req.params.tipo, body(req).aceptado);
      res.json(await auth.listarConsentimientos(req.actor));
    }));

    // administracion (solo admin)
    r.get('/users', authenticate, requireRole('admin'), ah(async (req, res) => res.json(await auth.listarUsuarios(req.actor))));
    r.post('/users', authenticate, requireRole('admin'), ah(async (req, res) => res.status(201).json(await auth.crearUsuarioStaff(req.actor, body(req)))));
    r.patch('/users/:id', authenticate, requireRole('admin'), ah(async (req, res) => {
      if (typeof body(req).activo !== 'boolean') throw E.badRequest('"activo" debe ser true o false');
      await auth.cambiarEstadoUsuario(req.actor, intParam(req.params.id), body(req).activo);
      res.status(204).end();
    }));

    app.use('/api/auth', r);
  });
}
module.exports = { createApp };
