// Prueba de humo contra el sistema YA levantado (npm run dev): npm run smoke
// Usa los usuarios de ejemplo de la base playfit_dev.
require('@playfit/shared/src/env').load();
const base = `http://127.0.0.1:${process.env.GATEWAY_PORT || 3000}`;
let fallos = 0;

async function llamar(metodo, ruta, { token, body } = {}) {
  const r = await fetch(base + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const texto = await r.text();
  let json = null; try { json = JSON.parse(texto); } catch { /* sin cuerpo */ }
  return { status: r.status, json };
}
function paso(nombre, ok, detalle = '') {
  if (!ok) fallos++;
  console.log(`${ok ? '  OK ' : ' FALLO'}  ${nombre}${detalle ? '  -> ' + detalle : ''}`);
}

(async () => {
  console.log(`Probando ${base}\n`);
  // Los servicios tardan unos segundos en conectarse a la BD al arrancar: se espera hasta 30 s.
  let h = await llamar('GET', '/health');
  for (let i = 0; i < 30 && h.status !== 200; i++) { await new Promise((r) => setTimeout(r, 1000)); h = await llamar('GET', '/health'); }
  paso('Salud de los 5 procesos', h.status === 200, JSON.stringify(h.json && h.json.servicios));
  if (h.status !== 200) { console.log('\nEl sistema no esta completo. Revisa la terminal de "npm run dev".'); process.exit(1); }

  const bad = await llamar('POST', '/api/auth/login', { body: { email: 'ana@playfit.test', password: 'incorrecta' } });
  paso('Login con contrasena mala se rechaza', bad.status === 401, bad.json && bad.json.error.code);

  const login = await llamar('POST', '/api/auth/login', { body: { email: 'ana@playfit.test', password: 'PlayFit123!' } });
  paso('Login de Ana', login.status === 200 && login.json.accessToken, login.json && login.json.usuario && login.json.usuario.nombre);
  const t = login.json && login.json.accessToken;
  if (!t) process.exit(1);

  const sin = await llamar('GET', '/api/social/dashboard');
  paso('Dashboard sin token se rechaza', sin.status === 401, sin.json && sin.json.error.code);
  const dash = await llamar('GET', '/api/social/dashboard', { token: t });
  paso('Dashboard de Ana', dash.status === 200, dash.json && `XP ${dash.json.xp_total}, racha ${dash.json.racha_actual}`);
  const rank = await llamar('GET', '/api/social/rankings/xp', { token: t });
  paso('Ranking por XP', rank.status === 200 && rank.json.length > 0, rank.json && `lider: ${rank.json[0].nombre}`);
  const ej = await llamar('GET', '/api/content/exercises', { token: t });
  paso('Catalogo de ejercicios', ej.status === 200 && ej.json.length > 0, ej.json && `${ej.json.length} ejercicios`);
  const masc = await llamar('GET', '/api/content/mascot?context=racha&racha=12', { token: t });
  paso('Mensaje de la mascota', masc.status === 200 && masc.json.mensaje, masc.json && masc.json.mensaje && masc.json.mensaje.mensaje);
  const hist = await llamar('GET', '/api/clinical/students/3/history', { token: t });
  paso('Ana lee su propio historial clinico', hist.status === 200);
  const login2 = await llamar('POST', '/api/auth/login', { body: { email: 'luis@playfit.test', password: 'PlayFit123!' } });
  const ajeno = await llamar('GET', '/api/clinical/students/3/history', { token: login2.json.accessToken });
  paso('Luis NO puede leer el historial de Ana', ajeno.status === 403, ajeno.json && ajeno.json.error.code);

  console.log(fallos ? `\n${fallos} prueba(s) fallaron.` : '\nTodo en orden: el backend completo funciona.');
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('No pude conectarme al gateway:', e.message, '\n¿Esta corriendo "npm run dev"?'); process.exit(1); });
