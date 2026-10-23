const express = require('express');
const { http } = require('@playfit/shared');
const clin = require('./clinicalService');
const { asyncHandler: ah, authenticate, requireRole, idOrMe, createServiceApp } = http;

function createApp() {
  return createServiceApp('clinical-service', (app) => {
    const r = express.Router();
    r.use(authenticate); // TODO el servicio clinico exige sesion
    const body = (req) => req.body || {};

    // :id puede ser un numero o "me" (el propio estudiante)
    r.get('/students/:id/history', ah(async (req, res) => res.json(await clin.leerHistorial(req.actor, idOrMe(req), { ip: req.ip }))));
    r.put('/students/:id/history', ah(async (req, res) => res.json(await clin.guardarHistorial(req.actor, idOrMe(req), body(req), { ip: req.ip }))));

    r.get('/students/:id/flags', ah(async (req, res) => res.json(await clin.obtenerFlags(req.actor, idOrMe(req), { ip: req.ip }))));

    r.get('/students/:id/measurements', ah(async (req, res) => res.json(await clin.listarMediciones(req.actor, idOrMe(req), { ip: req.ip }))));
    r.post('/students/:id/measurements', ah(async (req, res) => res.status(201).json(await clin.registrarMedicion(req.actor, idOrMe(req), body(req)))));

    // ejercicios permitidos / restringidos para el estudiante autenticado (solo devuelve datos derivados)
    r.get('/me/exercises', requireRole('estudiante'), ah(async (req, res) => res.json(await clin.ejerciciosParaEstudiante(req.actor.id))));

    app.use('/api/clinical', r);
  });
}
module.exports = { createApp };
