require('@playfit/shared/src/env').load(); // debe ir ANTES de cargar la conexion a la BD
const { http } = require('@playfit/shared');
const { createApp } = require('./app');
http.startServer('auth-service', createApp(), { puerto: Number(process.env.AUTH_PORT || 3001), migrar: true });
