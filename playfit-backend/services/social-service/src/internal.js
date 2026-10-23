// API INTERNA para n8n (automatizaciones). No pasa por el gateway (solo reenvia /api/*): n8n la llama dentro del
// cluster en http://social:3003/internal/... y una NetworkPolicy deja entrar solo al pod de n8n.
// Se autentica con la cabecera x-playfit-token = N8N_TOKEN. Sin N8N_TOKEN configurado, la API no existe (404).
// Solo entrega ids y numeros (nunca nombres, correos ni datos clinicos) y solo puede CREAR notificaciones.
const crypto = require('crypto');
const express = require('express');
const { one, select, insert, tx, E, clock, http } = require('@playfit/shared');

const TIPOS = ['racha_riesgo', 'resumen_semanal', 'soporte', 'pago', 'sistema'];
const MAX_DESTINATARIOS = 1000;

function tokenValido(recibido) {
  const esperado = process.env.N8N_TOKEN || '';
  if (esperado.length < 24 || typeof recibido !== 'string') return false;
  const a = crypto.createHash('sha256').update(recibido).digest();
  const b = crypto.createHash('sha256').update(esperado).digest();
  return crypto.timingSafeEqual(a, b);
}
function autenticarN8n(req, res, next) {
  if ((process.env.N8N_TOKEN || '').length < 24) return next(E.notFound('No existe'));
  if (!tokenValido(req.headers['x-playfit-token'])) return next(E.unauthorized('Token interno invalido', 'TOKEN_INVALIDO'));
  return next();
}

// Estudiantes que entrenaron ayer por ultima vez con racha >= 2: si hoy no entrenan, la pierden.
// Se excluye a quien ya recibio el aviso en las ultimas 20 horas (el flujo puede correr dos veces sin duplicar).
async function rachasEnRiesgo() {
  const hoy = clock.hoy();
  const filas = await select(
    `SELECT g.estudiante_id AS usuario_id, g.racha_actual AS racha
     FROM perfil_gamificacion g JOIN usuarios u ON u.id=g.estudiante_id AND u.activo=1
     WHERE g.racha_actual >= 2 AND g.ultima_actividad = :ayer
       AND NOT EXISTS (SELECT 1 FROM notificaciones n WHERE n.usuario_id=g.estudiante_id AND n.tipo='racha_riesgo'
                       AND n.created_at >= (UTC_TIMESTAMP() - INTERVAL 20 HOUR))
     ORDER BY g.estudiante_id`, { ayer: clock.addDays(hoy, -1) });
  return { fecha: hoy, total: filas.length, usuario_ids: filas.map((f) => f.usuario_id), usuarios: filas };
}

// Resumen de los ultimos 7 dias por squad (para el mensaje semanal a cada miembro).
async function resumenSemanal() {
  const hasta = clock.hoy(), desde = clock.addDays(hasta, -6);
  const squads = await select('SELECT id, nombre FROM squads ORDER BY id');
  const salida = [];
  for (const s of squads) {
    const miembros = (await select('SELECT estudiante_id FROM squad_miembros WHERE squad_id=:s', { s: s.id })).map((m) => m.estudiante_id);
    if (!miembros.length) continue;
    const r = await one(
      `SELECT COUNT(DISTINCT se.id) AS sesiones, COUNT(DISTINCT se.estudiante_id) AS activos, COALESCE(SUM(sr.repeticiones),0) AS reps
       FROM sesiones_entrenamiento se LEFT JOIN series_ejercicio sr ON sr.sesion_id=se.id
       WHERE se.estudiante_id IN (:m) AND se.fecha BETWEEN :d AND :h`, { m: miembros, d: desde, h: hasta });
    const retos = await one('SELECT COUNT(*) AS n FROM retos WHERE squad_id=:s AND activo=1 AND fecha_fin >= :h', { s: s.id, h: hasta });
    salida.push({
      squad_id: s.id, nombre: s.nombre, usuario_ids: miembros, miembros: miembros.length,
      activos: Number(r.activos), sesiones: Number(r.sesiones), reps: Number(r.reps), retos_vigentes: Number(retos.n)
    });
  }
  return { desde, hasta, squads: salida };
}

async function crearNotificaciones({ usuario_ids: ids, destino, tipo, titulo, cuerpo } = {}) {
  if (!TIPOS.includes(tipo)) throw E.badRequest(`tipo debe ser: ${TIPOS.join(', ')}`);
  const ti = typeof titulo === 'string' ? titulo.trim() : '';
  if (ti.length < 3 || ti.length > 100) throw E.badRequest('titulo: entre 3 y 100 caracteres');
  if (cuerpo !== undefined && cuerpo !== null && (typeof cuerpo !== 'string' || cuerpo.length > 255)) throw E.badRequest('cuerpo: maximo 255 caracteres');
  let destinatarios;
  if (destino === 'admins') {
    destinatarios = await select("SELECT u.id FROM usuarios u JOIN roles r ON r.id=u.rol_id WHERE r.nombre='admin' AND u.activo=1");
  } else {
    if (!Array.isArray(ids) || !ids.length || ids.length > MAX_DESTINATARIOS || !ids.every((i) => Number.isInteger(i) && i > 0)) {
      throw E.badRequest(`usuario_ids debe ser una lista de 1 a ${MAX_DESTINATARIOS} ids (o usa destino: "admins")`);
    }
    destinatarios = await select('SELECT id FROM usuarios WHERE id IN (:ids) AND activo=1', { ids: [...new Set(ids)] });
  }
  await tx(async (t) => {
    for (const d of destinatarios) {
      await insert('INSERT INTO notificaciones (usuario_id,tipo,titulo,cuerpo) VALUES (:u,:t,:ti,:c)', { u: d.id, t: tipo, ti, c: cuerpo ? cuerpo.trim() : null }, t);
    }
  });
  return { creadas: destinatarios.length };
}

function router() {
  const r = express.Router();
  const ah = http.asyncHandler;
  r.use(autenticarN8n);
  r.get('/rachas-en-riesgo', ah(async (req, res) => res.json(await rachasEnRiesgo())));
  r.get('/resumen-semanal', ah(async (req, res) => res.json(await resumenSemanal())));
  r.post('/notificaciones', ah(async (req, res) => res.status(201).json(await crearNotificaciones(req.body || {}))));
  return r;
}

module.exports = { router, rachasEnRiesgo, resumenSemanal, crearNotificaciones, tokenValido, TIPOS };
