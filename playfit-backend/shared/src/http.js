// Piezas HTTP comunes a los 4 microservicios: app base, autenticacion JWT, manejo de errores, arranque seguro.
const express = require('express');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const { AppError, E } = require('./errors');
const db = require('./db');

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- autenticacion: cada servicio valida el JWT por su cuenta (no confia ciegamente en el gateway) ----------
function secretoJwt() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) throw new Error('JWT_SECRET no esta configurado (minimo 16 caracteres). Corre "npm run setup".');
  return s;
}
// Ademas de la firma del JWT se consulta la BD: una cuenta desactivada o eliminada pierde el acceso
// de inmediato (no hay que esperar a que venza el token de 15 min) y el rol vigente es el de la BD.
async function authenticate(req, res, next) {
  const m = /^Bearer (.+)$/i.exec(req.headers.authorization || '');
  if (!m) return next(E.unauthorized('Falta el token de acceso', 'NO_AUTENTICADO'));
  let p;
  try {
    p = jwt.verify(m[1], secretoJwt(), { algorithms: ['HS256'] });
  } catch (e) {
    const expirado = e.name === 'TokenExpiredError';
    return next(E.unauthorized(expirado ? 'Sesion expirada' : 'Token invalido', expirado ? 'TOKEN_EXPIRADO' : 'TOKEN_INVALIDO'));
  }
  try {
    const u = await db.one('SELECT u.activo, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = :id', { id: Number(p.sub) });
    if (!u) return next(E.unauthorized('La cuenta ya no existe', 'TOKEN_INVALIDO'));
    if (!u.activo) return next(E.unauthorized('Cuenta desactivada', 'CUENTA_INACTIVA'));
    req.actor = { id: Number(p.sub), rol: u.rol };
    return next();
  } catch (e) {
    return next(e); // p. ej. base de datos caida: lo traduce errorHandler a un 503 claro
  }
}
const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.actor && req.actor.rol) ? next() : next(E.forbidden('Tu rol no puede usar este recurso'));

// ---------- parametros ----------
function intParam(v, nombre = 'id') {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw E.badRequest(`${nombre} invalido`);
  return n;
}
// En las rutas /students/:id se acepta "me" como atajo del usuario autenticado.
const idOrMe = (req, nombre = 'id') => (req.params[nombre] === 'me' ? req.actor.id : intParam(req.params[nombre], nombre));
const optInt = (v, nombre) => (v === undefined || v === '' ? undefined : intParam(v, nombre));

// ---------- errores ----------
const notFound = (req, res, next) => next(new AppError(404, 'RUTA_NO_ENCONTRADA', `No existe ${req.method} ${req.path}`));
// MariaDB apagada, puerto equivocado, credenciales rechazadas o pool agotado: no es un bug nuestro, es un 503.
function esErrorDeConexionBD(err) {
  const n = String((err && err.name) || '');
  const code = (err && ((err.parent && err.parent.code) || err.code)) || '';
  return /^Sequelize(Connection|ConnectionRefused|ConnectionTimedOut|HostNotFound|HostNotReachable|AccessDenied|InvalidConnection|ConnectionAcquireTimeout)/.test(n)
    || ['ECONNREFUSED', 'PROTOCOL_CONNECTION_LOST', 'ETIMEDOUT', 'ER_CON_COUNT_ERROR'].includes(code);
}
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'JSON_INVALIDO', message: 'El cuerpo no es un JSON valido' } });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: { code: 'CUERPO_DEMASIADO_GRANDE', message: 'El cuerpo de la peticion es demasiado grande' } });
  if (esErrorDeConexionBD(err)) {
    console.error(`[error] ${req.method} ${req.originalUrl}: base de datos no disponible (${err.message})`);
    return res.status(503).json({ error: { code: 'BASE_DE_DATOS_NO_DISPONIBLE', message: 'El servidor no puede acceder a la base de datos en este momento. Intenta de nuevo en unos minutos.' } });
  }
  // Cualquier otro error es nuestro: se registra en el servidor y al cliente NO se le filtran detalles.
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
  return res.status(500).json({ error: { code: 'ERROR_INTERNO', message: 'Ocurrio un error interno. Intenta de nuevo.' } });
}

// ---------- app base ----------
function createServiceApp(nombre, registrar) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback'); // el unico que nos llama es el gateway local
  app.use(helmet());
  if (process.env.LOG_HTTP !== '0') {
    app.use((req, res, next) => { // log minimo: jamas cuerpos ni tokens (hay datos de salud)
      const t = Date.now();
      res.on('finish', () => console.log(`[${nombre}] ${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${Date.now() - t}ms`));
      next();
    });
  }
  app.use(express.json({ limit: '100kb' }));
  app.get('/health', asyncHandler(async (req, res) => {
    try { await db.select('SELECT 1 AS ok'); res.json({ servicio: nombre, estado: 'ok' }); }
    catch { res.status(503).json({ servicio: nombre, estado: 'sin_base_de_datos' }); }
  }));
  registrar(app);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

// ---------- arranque con verificaciones que explican el problema en vez de fallar callado ----------
async function verificarEntorno({ clinico = false } = {}) {
  secretoJwt();
  if (clinico && !/^[0-9a-f]{64}$/i.test(process.env.CLINICAL_KEY || '')) {
    throw new Error('CLINICAL_KEY debe tener 64 caracteres hexadecimales. Corre "npm run setup".');
  }
  try { await db.select('SELECT 1 AS ok'); }
  catch (e) {
    const host = process.env.DB_HOST || 'localhost', port = process.env.DB_PORT || 3306;
    throw new Error(`No pude conectarme a MariaDB en ${host}:${port} (base "${process.env.DB_NAME || 'playfit_dev'}", usuario "${process.env.DB_USER || 'playfit_app'}"): ${e.message}\n` +
      '  -> Verifica que MariaDB este encendida y que DB_PORT / DB_USER / DB_PASS de tu archivo .env sean correctos.\n' +
      '     (Para ver en que puerto escucha tu MariaDB, entra al cliente y ejecuta:  SELECT @@port;)');
  }
}

async function startServer(nombre, app, { puerto, host = '127.0.0.1', clinico = false, migrar = false } = {}) {
  try { await verificarEntorno({ clinico }); if (migrar) await require('./migrate').aplicar(); }
  catch (e) { console.error(`\n[${nombre}] NO PUDE ARRANCAR\n${e.message}\n`); process.exit(1); }
  const server = app.listen(puerto, host, (err) => { if (!err) console.log(`[${nombre}] escuchando en http://${host}:${puerto}`); }); // Express 5 llama este callback tambien si falla
  server.on('error', (e) => {
    console.error(`\n[${nombre}] NO PUDE ARRANCAR: ${e.code === 'EADDRINUSE' ? `el puerto ${puerto} ya esta en uso` : e.message}\n`);
    process.exit(1);
  });
  const cerrar = () => server.close(() => db.sequelize.close().finally(() => process.exit(0)));
  process.on('SIGINT', cerrar); process.on('SIGTERM', cerrar);
  return server;
}

module.exports = { asyncHandler, authenticate, requireRole, intParam, idOrMe, optInt, notFound, errorHandler, createServiceApp, startServer, verificarEntorno };
