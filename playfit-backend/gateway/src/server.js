require('@playfit/shared/src/env').load();
const { trustProxy } = require('@playfit/shared/src/net');
const { createGateway, targetsDesdeEnv } = require('./app');

const puerto = Number(process.env.GATEWAY_PORT || 3000);
const host = process.env.GATEWAY_HOST || '0.0.0.0'; // 0.0.0.0 = accesible desde el emulador y desde el celular en tu red
const app = createGateway({
  targets: targetsDesdeEnv(),
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  limiteGlobal: Number(process.env.RATE_LIMIT_GLOBAL || 300),
  limiteAuth: Number(process.env.RATE_LIMIT_AUTH || 10),
  trustProxy: trustProxy(process.env.GATEWAY_TRUST_PROXY, false)
});
const server = app.listen(puerto, host, (err) => { if (!err) console.log(`[gateway] escuchando en http://${host}:${puerto}`); });
server.on('error', (e) => {
  console.error(`\n[gateway] NO PUDE ARRANCAR: ${e.code === 'EADDRINUSE' ? `el puerto ${puerto} ya esta en uso` : e.message}\n`);
  process.exit(1);
});
const cerrar = () => server.close(() => process.exit(0));
process.on('SIGINT', cerrar); process.on('SIGTERM', cerrar);
