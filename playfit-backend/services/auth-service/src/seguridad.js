// auth-service · seguridad de la cuenta: segundo factor (TOTP), codigos de respaldo y recuperacion de contrasena por correo.
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { one, select, insert, run, tx, E, audit } = require('@playfit/shared');
const A = require('./authService');
const totp = require('./totp');
const mailer = require('./mailer');

const DESAFIO_TTL = { login: '5m', setup: '15m' };
const CODIGO_RECUP_MIN = 15;          // vigencia del codigo de recuperacion
const MAX_INTENTOS_RECUP = 5;         // intentos por codigo
const MAX_CODIGOS_POR_HORA = 3;       // correos de recuperacion por cuenta y hora
const N_RESPALDO = 8;

// El 2FA del admin es obligatorio salvo que se apague EXPLICITAMENTE (solo para desarrollo / pruebas).
const admin2faObligatorio = () => process.env.ADMIN_2FA_OBLIGATORIO !== '0';

// ---------- desafio: prueba de que la contrasena ya se verifico (NO sirve como access token) ----------
// Se firma con una clave derivada distinta a la del access token: authenticate() lo rechaza por firma.
const claveDesafio = () => crypto.createHmac('sha256', A.secreto()).update('playfit-desafio-2fa').digest('hex');
function firmarDesafio(usuarioId, proposito) {
  return jwt.sign({ sub: usuarioId, p: proposito }, claveDesafio(), { expiresIn: DESAFIO_TTL[proposito], algorithm: 'HS256' });
}
function leerDesafio(token, proposito) {
  try {
    const p = jwt.verify(String(token || ''), claveDesafio(), { algorithms: ['HS256'] });
    if (p.p !== proposito) throw new Error('proposito');
    return Number(p.sub);
  } catch {
    throw E.unauthorized('La verificacion expiro. Inicia sesion de nuevo.', 'DESAFIO_INVALIDO');
  }
}
const usuarioPorId = (id, t) => one('SELECT u.*, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id=u.rol_id WHERE u.id=:id', { id }, t);

// Los intentos fallidos de codigo se cuentan en intentos_login con la llave "2fa:<id>" (mismo bloqueo temporal que la contrasena).
const llave2fa = (id) => `2fa:${id}`;
async function exigirSinBloqueo2fa(id) {
  if (await A.fallosRecientes(llave2fa(id)) >= A.MAX_FALLOS_LOGIN) {
    throw E.tooMany(`Demasiados codigos incorrectos. Espera ${A.VENTANA_FALLOS_MIN} minutos.`, 'CUENTA_BLOQUEADA_TEMPORAL');
  }
}
const registrarFallo2fa = (id, ip) =>
  insert('INSERT INTO intentos_login (email,ip,creado_at) VALUES (:e,:ip,UTC_TIMESTAMP())', { e: llave2fa(id), ip: ip ? String(ip).slice(0, 45) : null });

// ---------- codigos de respaldo ----------
const hashRespaldo = (c) => A.sha256(`respaldo:${String(c).toUpperCase().replace(/[^A-Z0-9]/g, '')}`);
function nuevoCodigoRespaldo() {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const p = () => Array.from({ length: 5 }, () => alfabeto[crypto.randomInt(alfabeto.length)]).join('');
  return `${p()}-${p()}`;
}
async function generarCodigosRespaldo(usuarioId, t) {
  await run('DELETE FROM codigos_respaldo_2fa WHERE usuario_id=:u', { u: usuarioId }, t);
  const codigos = Array.from({ length: N_RESPALDO }, nuevoCodigoRespaldo);
  for (const c of codigos) await insert('INSERT INTO codigos_respaldo_2fa (usuario_id,codigo_hash) VALUES (:u,:h)', { u: usuarioId, h: hashRespaldo(c) }, t);
  return codigos;
}
async function consumirRespaldo(usuarioId, codigo) {
  return tx(async (t) => {
    const f = await one('SELECT id FROM codigos_respaldo_2fa WHERE usuario_id=:u AND codigo_hash=:h AND usado_at IS NULL FOR UPDATE',
      { u: usuarioId, h: hashRespaldo(codigo) }, t);
    if (!f) return false;
    await run('UPDATE codigos_respaldo_2fa SET usado_at=UTC_TIMESTAMP() WHERE id=:id', { id: f.id }, t);
    return true;
  });
}

// Verifica un codigo TOTP de 6 digitos o un codigo de respaldo. Devuelve true/false (y guarda el paso para que no se reutilice).
async function verificarSegundoFactor(u, codigo) {
  const texto = String(codigo || '').trim();
  if (/^\d{3}\s?\d{3}$/.test(texto) && u.totp_secreto_cifrado) {
    const paso = totp.verificar(totp.descifrar(u.totp_secreto_cifrado), texto, { ultimoPaso: u.totp_ultimo_paso });
    if (paso === null) return false;
    // UPDATE condicional: si dos peticiones usan el mismo codigo a la vez, solo una gana
    await run('UPDATE usuarios SET totp_ultimo_paso=:p WHERE id=:id AND (totp_ultimo_paso IS NULL OR totp_ultimo_paso < :p2)', { p: paso, p2: paso, id: u.id });
    const f = await one('SELECT totp_ultimo_paso AS p FROM usuarios WHERE id=:id', { id: u.id });
    return Number(f.p) === paso;
  }
  if (/^[A-Za-z0-9]{5}-?[A-Za-z0-9]{5}$/.test(texto)) return consumirRespaldo(u.id, texto);
  return false;
}

// ---------- login en dos pasos ----------
async function loginConCodigo(desafio, codigo, { ip } = {}) {
  const id = leerDesafio(desafio, 'login');
  await exigirSinBloqueo2fa(id);
  const u = await usuarioPorId(id);
  if (!u || !u.activo || !u.totp_activo) throw E.unauthorized('La verificacion expiro. Inicia sesion de nuevo.', 'DESAFIO_INVALIDO');
  if (!(await verificarSegundoFactor(u, codigo))) {
    await registrarFallo2fa(id, ip);
    throw E.unauthorized('Codigo incorrecto', 'CODIGO_2FA_INVALIDO');
  }
  await run('DELETE FROM intentos_login WHERE email=:e', { e: llave2fa(id) });
  return A.completarLogin(u);
}

// ---------- configuracion de 2FA ----------
async function prepararSecreto(u) {
  const secreto = totp.generarSecreto();
  await run('UPDATE usuarios SET totp_pendiente_cifrado=:s WHERE id=:id', { s: totp.cifrar(secreto), id: u.id });
  return { secreto, otpauth_uri: totp.otpauthUri(secreto, u.email) };
}
async function confirmarSecreto(u, codigo, ip) {
  await exigirSinBloqueo2fa(u.id);
  if (!u.totp_pendiente_cifrado) throw E.badRequest('Primero genera el codigo QR', 'DATOS_INVALIDOS');
  const paso = totp.verificar(totp.descifrar(u.totp_pendiente_cifrado), codigo);
  if (paso === null) { await registrarFallo2fa(u.id, ip); throw E.unauthorized('Codigo incorrecto', 'CODIGO_2FA_INVALIDO'); }
  return tx(async (t) => {
    await run('UPDATE usuarios SET totp_secreto_cifrado=totp_pendiente_cifrado, totp_pendiente_cifrado=NULL, totp_activo=1, totp_ultimo_paso=:p WHERE id=:id', { p: paso, id: u.id }, t);
    const codigos = await generarCodigosRespaldo(u.id, t);
    await audit.registrar({ id: u.id }, 'actualizar', 'seguridad_2fa', u.id, { ip, t });
    return codigos;
  });
}

// Admin SIN 2FA: configura con el desafio de "setup" y entra en el mismo paso (nunca tiene sesion sin segundo factor).
async function iniciarConfiguracionInicial(desafio) {
  const u = await usuarioPorId(leerDesafio(desafio, 'setup'));
  if (!u || !u.activo || u.totp_activo) throw E.unauthorized('La verificacion expiro. Inicia sesion de nuevo.', 'DESAFIO_INVALIDO');
  return prepararSecreto(u);
}
async function confirmarConfiguracionInicial(desafio, codigo, { ip } = {}) {
  const u = await usuarioPorId(leerDesafio(desafio, 'setup'));
  if (!u || !u.activo || u.totp_activo) throw E.unauthorized('La verificacion expiro. Inicia sesion de nuevo.', 'DESAFIO_INVALIDO');
  const codigos_respaldo = await confirmarSecreto(u, codigo, ip);
  const sesion = await A.completarLogin(await usuarioPorId(u.id));
  return { ...sesion, codigos_respaldo };
}

// Usuario ya autenticado (opcional para usuarios; el admin tambien puede regenerar).
const estado2fa = async (actor) => {
  const u = await usuarioPorId(actor.id);
  const libres = await one('SELECT COUNT(*) AS n FROM codigos_respaldo_2fa WHERE usuario_id=:u AND usado_at IS NULL', { u: actor.id });
  return { activo: !!u.totp_activo, obligatorio: u.rol === 'admin' && admin2faObligatorio(), codigos_respaldo_disponibles: Number(libres.n) };
};
async function configurar2fa(actor) {
  const u = await usuarioPorId(actor.id);
  if (u.totp_activo) throw E.conflict('Ya tienes la verificacion en dos pasos activa', 'YA_ACTIVO');
  return prepararSecreto(u);
}
async function activar2fa(actor, codigo, { ip } = {}) {
  const u = await usuarioPorId(actor.id);
  if (u.totp_activo) throw E.conflict('Ya tienes la verificacion en dos pasos activa', 'YA_ACTIVO');
  return { codigos_respaldo: await confirmarSecreto(u, codigo, ip) };
}
async function desactivar2fa(actor, password, codigo, { ip } = {}) {
  const u = await usuarioPorId(actor.id);
  if (!u.totp_activo) throw E.badRequest('La verificacion en dos pasos no esta activa', 'DATOS_INVALIDOS');
  if (u.rol === 'admin' && admin2faObligatorio()) throw E.forbidden('Para administradores la verificacion en dos pasos es obligatoria', 'DOS_FACTORES_OBLIGATORIO');
  if (!(await bcrypt.compare(String(password || ''), u.password_hash))) throw E.unauthorized('Contrasena incorrecta', 'CREDENCIALES_INVALIDAS');
  await exigirSinBloqueo2fa(u.id);
  if (!(await verificarSegundoFactor(u, codigo))) { await registrarFallo2fa(u.id, ip); throw E.unauthorized('Codigo incorrecto', 'CODIGO_2FA_INVALIDO'); }
  await tx(async (t) => {
    await run('UPDATE usuarios SET totp_activo=0, totp_secreto_cifrado=NULL, totp_pendiente_cifrado=NULL, totp_ultimo_paso=NULL WHERE id=:id', { id: u.id }, t);
    await run('DELETE FROM codigos_respaldo_2fa WHERE usuario_id=:id', { id: u.id }, t);
    await audit.registrar(actor, 'actualizar', 'seguridad_2fa', u.id, { ip, t });
  });
}
async function regenerarRespaldo(actor, codigo, { ip } = {}) {
  const u = await usuarioPorId(actor.id);
  if (!u.totp_activo) throw E.badRequest('La verificacion en dos pasos no esta activa', 'DATOS_INVALIDOS');
  await exigirSinBloqueo2fa(u.id);
  const paso = totp.verificar(totp.descifrar(u.totp_secreto_cifrado), codigo, { ultimoPaso: u.totp_ultimo_paso });
  if (paso === null) { await registrarFallo2fa(u.id, ip); throw E.unauthorized('Codigo incorrecto', 'CODIGO_2FA_INVALIDO'); }
  return { codigos_respaldo: await tx((t) => generarCodigosRespaldo(u.id, t)) };
}
// El admin le quita el 2FA a alguien que perdio su celular y sus codigos de respaldo (queda en la auditoria).
async function restablecer2faDe(actor, usuarioId, { ip } = {}) {
  if (!actor || actor.rol !== 'admin') throw E.forbidden('Solo un administrador puede hacer esto');
  if (actor.id === usuarioId) throw E.badRequest('No puedes restablecer tu propio 2FA; usa tus codigos de respaldo', 'DATOS_INVALIDOS');
  const u = await usuarioPorId(usuarioId);
  if (!u) throw E.notFound('Usuario no encontrado');
  await tx(async (t) => {
    await run('UPDATE usuarios SET totp_activo=0, totp_secreto_cifrado=NULL, totp_pendiente_cifrado=NULL, totp_ultimo_paso=NULL WHERE id=:id', { id: usuarioId }, t);
    await run('DELETE FROM codigos_respaldo_2fa WHERE usuario_id=:id', { id: usuarioId }, t);
    await run('UPDATE refresh_tokens SET revocado_at=UTC_TIMESTAMP() WHERE usuario_id=:id AND revocado_at IS NULL', { id: usuarioId }, t);
    await audit.registrar(actor, 'actualizar', 'seguridad_2fa', usuarioId, { ip, t });
  });
}

// ---------- recuperacion de contrasena ----------
const hashCodigoRecup = (usuarioId, codigo) =>
  crypto.createHmac('sha256', A.secreto()).update(`recuperacion:${usuarioId}:${codigo}`).digest('hex');

// Responde SIEMPRE lo mismo (exista o no la cuenta) para no revelar que correos estan registrados.
async function solicitarRecuperacion(email, { ip } = {}) {
  const generica = { ok: true, mensaje: 'Si el correo esta registrado, te enviamos un codigo para restablecer tu contrasena.' };
  if (typeof email !== 'string' || email.length > 150) return generica;
  const u = await A.buscarUsuarioPorEmail(email);
  if (!u || !u.activo) return generica;
  const recientes = await one(
    `SELECT COUNT(*) AS n FROM codigos_verificacion WHERE usuario_id=:u AND proposito='recuperacion' AND created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR)`, { u: u.id });
  if (Number(recientes.n) >= MAX_CODIGOS_POR_HORA) return generica;
  const codigo = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await tx(async (t) => {
    await run(`UPDATE codigos_verificacion SET usado_at=UTC_TIMESTAMP() WHERE usuario_id=:u AND proposito='recuperacion' AND usado_at IS NULL`, { u: u.id }, t);
    await insert(
      `INSERT INTO codigos_verificacion (usuario_id,proposito,codigo_hash,expira_at,created_at)
       VALUES (:u,'recuperacion',:h,DATE_ADD(UTC_TIMESTAMP(), INTERVAL :m MINUTE),UTC_TIMESTAMP())`,
      { u: u.id, h: hashCodigoRecup(u.id, codigo), m: CODIGO_RECUP_MIN }, t);
  });
  try { await mailer.enviar(mailer.correoRecuperacion(u.email, u.nombre, codigo, CODIGO_RECUP_MIN)); }
  catch (e) { console.error(`[auth-service] no pude enviar el correo de recuperacion: ${e.message}`); }
  return generica;
}

async function restablecerPassword(email, codigo, nueva, { ip } = {}) {
  A.validarPassword(nueva);
  const invalido = () => E.badRequest('Codigo invalido o vencido', 'CODIGO_INVALIDO');
  const u = typeof email === 'string' ? await A.buscarUsuarioPorEmail(email) : null;
  if (!u || !u.activo || typeof codigo !== 'string' || !/^\d{6}$/.test(codigo.trim())) throw invalido();
  const f = await one(
    `SELECT id, codigo_hash, intentos FROM codigos_verificacion
     WHERE usuario_id=:u AND proposito='recuperacion' AND usado_at IS NULL AND expira_at > UTC_TIMESTAMP()
     ORDER BY id DESC LIMIT 1`, { u: u.id });
  if (!f || f.intentos >= MAX_INTENTOS_RECUP) throw invalido();
  const esperado = Buffer.from(f.codigo_hash, 'hex'), dado = Buffer.from(hashCodigoRecup(u.id, codigo.trim()), 'hex');
  if (!crypto.timingSafeEqual(esperado, dado)) {
    // fuera de la transaccion para que el intento fallido SI quede contado
    await run('UPDATE codigos_verificacion SET intentos=intentos+1 WHERE id=:id', { id: f.id });
    throw invalido();
  }
  const hash = await bcrypt.hash(nueva, 10);
  return tx(async (t) => {
    const vigente = await one('SELECT id FROM codigos_verificacion WHERE id=:id AND usado_at IS NULL FOR UPDATE', { id: f.id }, t);
    if (!vigente) throw invalido(); // otra peticion ya uso este codigo
    await run('UPDATE codigos_verificacion SET usado_at=UTC_TIMESTAMP() WHERE id=:id', { id: f.id }, t);
    await run('UPDATE usuarios SET password_hash=:h WHERE id=:id', { h: hash, id: u.id }, t);
    await run('UPDATE refresh_tokens SET revocado_at=UTC_TIMESTAMP() WHERE usuario_id=:id AND revocado_at IS NULL', { id: u.id }, t);
    await run('DELETE FROM intentos_login WHERE email=:e', { e: u.email }, t); // desbloquea la cuenta
    await audit.registrar({ id: u.id }, 'actualizar', 'password_recuperada', u.id, { ip, t });
    return { ok: true };
  });
}

module.exports = {
  admin2faObligatorio, firmarDesafio, loginConCodigo, iniciarConfiguracionInicial, confirmarConfiguracionInicial,
  estado2fa, configurar2fa, activar2fa, desactivar2fa, regenerarRespaldo, restablecer2faDe,
  solicitarRecuperacion, restablecerPassword
};
