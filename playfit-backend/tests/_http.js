// Arranca de verdad los 4 servicios + el gateway en puertos libres y ofrece un cliente HTTP para las pruebas.
const { createApp: authApp } = require('@playfit/auth-service/src/app');
const { createApp: clinicalApp } = require('@playfit/clinical-service/src/app');
const { createApp: socialApp } = require('@playfit/social-service/src/app');
const { createApp: contentApp } = require('@playfit/content-service/src/app');
const { createGateway } = require('@playfit/gateway/src/app');

const escuchar = (app) => new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
const url = (s) => `http://127.0.0.1:${s.address().port}`;
const cerrar = (s) => new Promise((ok) => { s.closeAllConnections?.(); s.close(() => ok()); });

// Modelo falso que registra lo que recibe
const crearLlmFalso = () => { const llamadas = []; return { llamadas, async generate(x) { llamadas.push(x); return 'Hazlo con control y sin dolor.'; } }; };

async function levantar({ llm = crearLlmFalso(), gateway = {} } = {}) {
  const servers = {
    auth: await escuchar(authApp()), clinical: await escuchar(clinicalApp()),
    social: await escuchar(socialApp()), content: await escuchar(contentApp({ llm }))
  };
  const targets = Object.fromEntries(Object.entries(servers).map(([k, s]) => [k, url(s)]));
  const gw = await escuchar(createGateway({ targets, limiteGlobal: 10000, limiteAuth: 10000, log: false, ...gateway }));
  return {
    llm, targets, base: url(gw), servers,
    levantarGateway: async (opts) => { const g = await escuchar(createGateway({ targets, log: false, ...opts })); return { base: url(g), cerrar: () => cerrar(g) }; },
    cerrar: async () => { await cerrar(gw); for (const s of Object.values(servers)) await cerrar(s); }
  };
}

// cliente: api(base)('GET', '/ruta', { token, body, headers }) -> { status, body, headers, text }
const api = (base) => async (metodo, ruta, { token, body, headers, raw } = {}) => {
  const res = await fetch(base + ruta, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* sin JSON */ }
  return { status: res.status, body: json, headers: res.headers, text };
};

module.exports = { levantar, api, crearLlmFalso, cerrar };
