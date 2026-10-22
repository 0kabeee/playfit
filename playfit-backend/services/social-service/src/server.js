require('@playfit/shared/src/env').load();
const { http } = require('@playfit/shared');
const { createApp } = require('./app');
http.startServer('social-service', createApp(), { puerto: Number(process.env.SOCIAL_PORT || 3003) });
