const express = require('express');
const { http } = require('@playfit/shared');
const { E } = require('@playfit/shared');
const auth = require('./authService');
const seg = require('./seguridad');
const admin = require('./admin');
const textos = require('./consentTexts');
const { asyncHandler: ah, authenticate, requireRole, intParam, createServiceApp } = http;

function createApp() {
  return createServiceApp('auth-service', (app) => {
    const r = express.Router();
    const body = (req) => req.body || {};

    r.post('/register', ah(async (req, res) => res.status(201).json(await auth.registrarEstudiante(body(req), { ip: req.ip }))));
    r.post('/login', ah(async (req, res) => res.json(await auth.login(body(req).email, body(req).password, { ip: req.ip }))));
    r.post('/login/2fa', ah(async (req, res) => res.json(await seg.loginConCodigo(body(req).desafio, body(req).codigo, { ip: req.ip }))));
    // admin sin 2FA: lo configura (y entra) con el desafio que devolvio /login
    r.post('/login/2fa/setup', ah(async (req, res) => res.json(await seg.iniciarConfiguracionInicial(body(req).desafio))));
    r.post('/login/2fa/confirm', ah(async (req, res) => res.json(await seg.confirmarConfiguracionInicial(body(req).desafio, body(req).codigo, { ip: req.ip }))));
    r.post('/password/forgot', ah(async (req, res) => res.status(202).json(await seg.solicitarRecuperacion(body(req).email, { ip: req.ip }))));
    r.post('/password/reset', ah(async (req, res) => res.json(await seg.restablecerPassword(body(req).email, body(req).codigo, body(req).nueva, { ip: req.ip }))));
    r.get('/consent-texts', (req, res) => res.json(textos.publico()));
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
      await auth.registrarConsentimiento(req.actor, req.params.tipo, body(req).aceptado, { ip: req.ip });
      res.json(await auth.listarConsentimientos(req.actor));
    }));

    // verificacion en dos pasos (usuario autenticado)
    r.get('/2fa', authenticate, ah(async (req, res) => res.json(await seg.estado2fa(req.actor))));
    r.post('/2fa/setup', authenticate, ah(async (req, res) => res.json(await seg.configurar2fa(req.actor))));
    r.post('/2fa/enable', authenticate, ah(async (req, res) => res.json(await seg.activar2fa(req.actor, body(req).codigo, { ip: req.ip }))));
    r.post('/2fa/disable', authenticate, ah(async (req, res) => { await seg.desactivar2fa(req.actor, body(req).password, body(req).codigo, { ip: req.ip }); res.status(204).end(); }));
    r.post('/2fa/backup-codes', authenticate, ah(async (req, res) => res.json(await seg.regenerarRespaldo(req.actor, body(req).codigo, { ip: req.ip }))));

    // administracion (solo admin)
    r.get('/admin/audit', authenticate, requireRole('admin'), ah(async (req, res) =>
      res.json(await admin.auditoria(req.actor, { limite: req.query.limite, recurso: req.query.recurso, usuarioId: req.query.usuario_id }))));
    r.get('/admin/metrics', authenticate, requireRole('admin'), ah(async (req, res) => res.json(await admin.metricas(req.actor))));
    r.post('/users/:id/2fa/reset', authenticate, requireRole('admin'), ah(async (req, res) => {
      await seg.restablecer2faDe(req.actor, intParam(req.params.id), { ip: req.ip });
      res.status(204).end();
    }));
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
