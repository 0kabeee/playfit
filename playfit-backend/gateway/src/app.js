// API Gateway: unico punto de entrada publico. Aplica CORS, cabeceras de seguridad, limites de peticiones
// y reenvia cada prefijo /api/* al microservicio correspondiente. NO lee los cuerpos de las peticiones.
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { rateLimit } = require('express-rate-limit');
const { createProxyMiddleware } = require('http-proxy-middleware');

const SERVICIOS = [
  { nombre: 'auth', prefijo: '/api/auth' },
  { nombre: 'clinical', prefijo: '/api/clinical' },
  { nombre: 'social', prefijo: '/api/social' },
  { nombre: 'content', prefijo: '/api/content' }
];
const error = (res, status, code, message) => res.status(status).json({ error: { code, message } });

function createGateway({
  targets,                         // { auth: 'http://127.0.0.1:3001', clinical: ..., social: ..., content: ... }
  corsOrigins = [],                // lista de origenes web permitidos (la app movil no necesita CORS)
  limiteGlobal = 300,              // peticiones por minuto y por IP
  limiteAuth = 10,                 // intentos de login/registro/refresh por ventana y por IP
  ventanaAuthMs = 15 * 60 * 1000,
  timeoutMs = 15000,
  trustProxy = false,              // en la nube va detras de Caddy (HTTPS): 1 = confiar en ese unico salto
  log = process.env.LOG_HTTP !== '0'
}) {
  const app = express();
  app.disable('x-powered-by');
  // Detras de un proxy (Caddy en Kubernetes) todas las peticiones llegarian con la IP del proxy y los limites
  // por IP serian compartidos por TODOS los usuarios: con trust proxy = 1 se usa la IP real (X-Forwarded-For).
  app.set('trust proxy', trustProxy);
  app.use(helmet());
  app.use(cors({ origin: corsOrigins.length ? corsOrigins : false, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'], maxAge: 600 }));

  app.use((req, res, next) => { // id de peticion para rastrear un error entre gateway y servicios
    const id = crypto.randomUUID();
    req.headers['x-request-id'] = id;
    res.setHeader('X-Request-Id', id);
    if (log) {
      const t = Date.now();
      res.on('finish', () => console.log(`[gateway] ${id.slice(0, 8)} ${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${Date.now() - t}ms`));
    }
    next();
  });

  // ---- salud agregada ----
  app.get('/health', async (req, res) => {
    const servicios = {};
    await Promise.all(SERVICIOS.map(async ({ nombre }) => {
      try {
        const r = await fetch(`${targets[nombre]}/health`, { signal: AbortSignal.timeout(2000) });
        servicios[nombre] = r.ok ? 'ok' : `error_${r.status}`;
      } catch { servicios[nombre] = 'caido'; }
    }));
    const ok = Object.values(servicios).every((s) => s === 'ok');
    res.status(ok ? 200 : 503).json({ gateway: 'ok', estado: ok ? 'ok' : 'degradado', servicios });
  });

  // ---- limites de peticiones ----
  const limitador = (limit, windowMs, code, message, extra = {}) => rateLimit({
    windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false, ...extra,
    handler: (req, res) => error(res, 429, code, message)
  });
  app.use('/api', limitador(limiteGlobal, 60 * 1000, 'LIMITE_EXCEDIDO', 'Demasiadas peticiones. Espera un momento.'));
  const MSG_AUTH = 'Demasiados intentos. Espera unos minutos antes de volver a intentar.';
  // Login: solo cuentan los intentos FALLIDOS (varios estudiantes en la misma WiFi no se bloquean entre si al entrar bien).
  // el login (con o sin 2FA), el codigo de 2FA y la recuperacion de contrasena comparten el mismo tipo de limite
  app.post(['/api/auth/login', '/api/auth/login/2fa', '/api/auth/login/2fa/confirm'], limitador(limiteAuth, ventanaAuthMs, 'DEMASIADOS_INTENTOS', MSG_AUTH, { skipSuccessfulRequests: true }));
  for (const ruta of ['/api/auth/register', '/api/auth/refresh', '/api/auth/password/forgot', '/api/auth/password/reset', '/api/auth/login/2fa/setup']) app.post(ruta, limitador(limiteAuth, ventanaAuthMs, 'DEMASIADOS_INTENTOS', MSG_AUTH));

  // ---- proxys (se montan en la raiz con pathFilter para conservar la ruta completa /api/...) ----
  for (const { nombre, prefijo } of SERVICIOS) {
    app.use(createProxyMiddleware({
      target: targets[nombre],
      pathFilter: prefijo,
      xfwd: true,                  // el servicio ve la IP real del cliente (auditoria)
      proxyTimeout: timeoutMs,
      timeout: timeoutMs,
      on: {
        error: (err, req, res) => {
          if (typeof res.writeHead !== 'function' || res.headersSent) return;
          const timeout = err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT';
          res.writeHead(timeout ? 504 : 502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { code: timeout ? 'SERVICIO_LENTO' : 'SERVICIO_NO_DISPONIBLE', message: `El servicio "${nombre}" no esta disponible en este momento.` } }));
        }
      }
    }));
  }

  app.use((req, res) => error(res, 404, 'RUTA_NO_ENCONTRADA', `No existe ${req.method} ${req.path}`));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[gateway] error:', err);
    if (!res.headersSent) error(res, 500, 'ERROR_INTERNO', 'Ocurrio un error interno. Intenta de nuevo.');
  });
  return app;
}

// Lee la configuracion del entorno (.env)
function targetsDesdeEnv(env = process.env) {
  return {
    auth: env.AUTH_URL || `http://127.0.0.1:${env.AUTH_PORT || 3001}`,
    clinical: env.CLINICAL_URL || `http://127.0.0.1:${env.CLINICAL_PORT || 3002}`,
    social: env.SOCIAL_URL || `http://127.0.0.1:${env.SOCIAL_PORT || 3003}`,
    content: env.CONTENT_URL || `http://127.0.0.1:${env.CONTENT_PORT || 3004}`
  };
}
module.exports = { createGateway, targetsDesdeEnv };
