// Notificaciones push con Firebase Cloud Messaging (API HTTP v1). Gratis y sin SDK: se firma un JWT con la
// cuenta de servicio de Firebase (RS256), se cambia por un token de acceso de Google y se llama a FCM.
//
// Funciona como "bandeja de salida": helpers.notificar() solo inserta en `notificaciones` (push_estado='pendiente')
// dentro de la transaccion de negocio; procesarPendientes() las toma DESPUES del commit y las envia. Asi nunca se
// manda un push de algo que se deshizo, y varias replicas del servicio no envian la misma notificacion dos veces.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { one, select, run } = require('./db');

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const MAX_DISPOSITIVOS = 5;
const TOKEN_VALIDO = /^[A-Za-z0-9:_\-.]{20,512}$/;

// FCM_SERVICE_ACCOUNT = el JSON de la cuenta de servicio (tal cual o en base64). Sin el, push queda apagado.
function leerCuentaServicio(valor = process.env.FCM_SERVICE_ACCOUNT) {
  if (!valor || !valor.trim()) return null;
  let texto = valor.trim();
  if (!texto.startsWith('{')) texto = Buffer.from(texto, 'base64').toString('utf8');
  let c;
  try { c = JSON.parse(texto); } catch { throw new Error('FCM_SERVICE_ACCOUNT no es un JSON valido (pega el archivo de la cuenta de servicio o su base64)'); }
  if (!c.project_id || !c.client_email || !c.private_key) throw new Error('FCM_SERVICE_ACCOUNT no tiene project_id, client_email y private_key');
  return { projectId: c.project_id, clientEmail: c.client_email, privateKey: c.private_key };
}

function crearClienteFcm({ cuenta = leerCuentaServicio(), fetchFn = fetch, ahora = () => Date.now() } = {}) {
  if (!cuenta) return null;
  let cache = null; // { token, venceMs }

  async function tokenDeAcceso() {
    if (cache && cache.venceMs - 60_000 > ahora()) return cache.token;
    const iat = Math.floor(ahora() / 1000);
    const assertion = jwt.sign({ iss: cuenta.clientEmail, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 }, cuenta.privateKey, { algorithm: 'RS256' });
    const res = await fetchFn(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString()
    });
    if (!res.ok) throw new Error(`Google rechazo la cuenta de servicio de FCM (HTTP ${res.status})`);
    const data = await res.json();
    cache = { token: data.access_token, venceMs: ahora() + Number(data.expires_in || 3600) * 1000 };
    return cache.token;
  }

  // Devuelve 'ok', 'token_invalido' (el celular ya no existe: hay que borrarlo) o 'error'.
  async function enviar(token, { titulo, cuerpo, datos = {} }) {
    const res = await fetchFn(`https://fcm.googleapis.com/v1/projects/${cuenta.projectId}/messages:send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await tokenDeAcceso()}` },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: titulo, ...(cuerpo ? { body: cuerpo } : {}) },
          data: Object.fromEntries(Object.entries(datos).map(([k, v]) => [k, String(v)])), // FCM solo acepta textos
          android: { priority: 'HIGH' }
        }
      })
    });
    if (res.ok) return 'ok';
    if (res.status === 404) return 'token_invalido';
    if (res.status === 400) {
      const cuerpoErr = await res.text().catch(() => '');
      if (/UNREGISTERED|registration token/i.test(cuerpoErr)) return 'token_invalido';
    }
    return 'error';
  }
  return { enviar, tokenDeAcceso, projectId: cuenta.projectId };
}

// ---------- registro de celulares ----------
async function registrarDispositivo(usuarioId, token) {
  if (typeof token !== 'string' || !TOKEN_VALIDO.test(token)) {
    const { E } = require('./errors');
    throw E.badRequest('token de notificaciones invalido');
  }
  // Si el token era de otra cuenta (otro usuario inicio sesion en el mismo celular), pasa a esta.
  await run(`INSERT INTO dispositivos_push (usuario_id,token) VALUES (:u,:t)
             ON DUPLICATE KEY UPDATE usuario_id=VALUES(usuario_id), ultimo_uso_at=UTC_TIMESTAMP()`, { u: usuarioId, t: token });
  const sobran = await select('SELECT id FROM dispositivos_push WHERE usuario_id=:u ORDER BY ultimo_uso_at DESC, id DESC LIMIT 100 OFFSET :n',
    { u: usuarioId, n: MAX_DISPOSITIVOS });
  if (sobran.length) await run('DELETE FROM dispositivos_push WHERE id IN (:ids)', { ids: sobran.map((s) => s.id) });
}
const quitarDispositivo = (usuarioId, token) =>
  run('DELETE FROM dispositivos_push WHERE usuario_id=:u AND token=:t', { u: usuarioId, t: String(token || '') });

// ---------- bandeja de salida ----------
// Toma un lote de notificaciones pendientes (de las ultimas 24 h; las mas viejas ya no tiene sentido enviarlas),
// las marca con un id de lote para que otra replica no las tome y las envia a todos los celulares del usuario.
async function procesarPendientes(cliente, { limite = 50 } = {}) {
  if (!cliente) return { enviadas: 0 };
  await run(`UPDATE notificaciones SET push_estado='omitida' WHERE push_estado='pendiente' AND created_at < (UTC_TIMESTAMP() - INTERVAL 1 DAY)`);
  const lote = crypto.randomUUID();
  await run(`UPDATE notificaciones SET push_estado='enviando', push_lote=:l WHERE push_estado='pendiente' ORDER BY id LIMIT :n`, { l: lote, n: limite });
  const notifs = await select('SELECT id,usuario_id,tipo,titulo,cuerpo FROM notificaciones WHERE push_lote=:l AND push_estado=\'enviando\'', { l: lote });
  let enviadas = 0;
  for (const n of notifs) {
    const tokens = await select('SELECT id,token FROM dispositivos_push WHERE usuario_id=:u', { u: n.usuario_id });
    let estado = tokens.length ? 'error' : 'sin_dispositivo';
    for (const d of tokens) {
      let r;
      try { r = await cliente.enviar(d.token, { titulo: n.titulo, cuerpo: n.cuerpo, datos: { tipo: n.tipo, notificacion_id: n.id } }); }
      catch (e) { console.error(`[push] no pude enviar la notificacion ${n.id}: ${e.message}`); r = 'error'; }
      if (r === 'ok') estado = 'enviada';
      else if (r === 'token_invalido') await run('DELETE FROM dispositivos_push WHERE id=:id', { id: d.id });
    }
    if (estado === 'enviada') enviadas++;
    await run('UPDATE notificaciones SET push_estado=:e WHERE id=:id', { e: estado, id: n.id });
  }
  return { enviadas, procesadas: notifs.length };
}

// Arranca el envio periodico (lo llama el social-service). Devuelve una funcion para detenerlo.
function iniciarEnvioPeriodico({ cliente, cadaMs = Number(process.env.PUSH_INTERVALO_SEG || 10) * 1000 } = {}) {
  if (cliente === undefined) {
    try { cliente = crearClienteFcm(); }
    catch (e) { console.error(`[push] ${e.message}. Las notificaciones push quedan apagadas.`); return () => {}; }
  }
  if (!cliente) {
    console.warn('[push] AVISO: sin FCM_SERVICE_ACCOUNT las notificaciones solo se ven dentro de la app (no llegan al celular).');
    return () => {};
  }
  console.log(`[push] notificaciones push activas (proyecto Firebase "${cliente.projectId}")`);
  let ocupado = false;
  const timer = setInterval(async () => {
    if (ocupado) return;
    ocupado = true;
    try { await procesarPendientes(cliente); }
    catch (e) { console.error(`[push] error procesando la bandeja de salida: ${e.message}`); }
    finally { ocupado = false; }
  }, cadaMs);
  timer.unref();
  return () => clearInterval(timer);
}

const contarDispositivos = async (usuarioId) => Number((await one('SELECT COUNT(*) AS n FROM dispositivos_push WHERE usuario_id=:u', { u: usuarioId })).n);

module.exports = {
  leerCuentaServicio, crearClienteFcm, registrarDispositivo, quitarDispositivo, procesarPendientes, iniciarEnvioPeriodico, contarDispositivos, MAX_DISPOSITIVOS
};
