require('@playfit/shared/src/env').load();
const { http, push } = require('@playfit/shared');
const { createApp } = require('./app');
http.startServer('social-service', createApp(), { puerto: Number(process.env.SOCIAL_PORT || 3003) })
  .then(() => push.iniciarEnvioPeriodico()); // envia por FCM las notificaciones nuevas (si FCM_SERVICE_ACCOUNT esta configurada)
