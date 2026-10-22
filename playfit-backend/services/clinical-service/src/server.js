require('@playfit/shared/src/env').load();
const { http } = require('@playfit/shared');
const { createApp } = require('./app');
http.startServer('clinical-service', createApp(), { puerto: Number(process.env.CLINICAL_PORT || 3002), clinico: true });
