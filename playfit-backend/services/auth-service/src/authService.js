// auth-service · logica de negocio: registro, login, tokens, consentimientos, usuarios.
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { one, select, insert, run, tx, E, rbac, audit } = require('@playfit/shared');
const textos = require('./consentTexts');

const ACCESS_TTL = '15m';
const REFRESH_DIAS = 7;
const MAX_FALLOS_LOGIN = 5;      // intentos fallidos por correo ...
const VENTANA_FALLOS_MIN = 15;   // ... dentro de esta ventana bloquean el login de esa cuenta temporalmente
const TIPOS_CONSENTIMIENTO = textos.TIPOS; // A1 tratamiento_datos, A2 datos_salud, A3 uso_camara, A4 ia_chatbot + declaracion de edad
const ROLES_VALIDOS = ['estudiante', 'admin']; // el rol docente desaparecio: una cuenta antigua con ese rol ya no entra
const secreto = () => {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) throw new Error('JWT_SECRET no esta configurado (minimo 16 caracteres). Revisa tu .env');
  return s;
};
const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex');
const HASH_FALSO = bcrypt.hashSync('contrasena-falsa-para-igualar-tiempos', 10);

// ---------- validaciones ----------
function validarPassword(p) {
  if (typeof p !== 'string' || p.length < 8) throw E.badRequest('La contrasena debe tener al menos 8 caracteres', 'PASSWORD_DEBIL');
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) throw E.badRequest('La contrasena debe combinar letras y numeros', 'PASSWORD_DEBIL');
  if (Buffer.byteLength(p, 'utf8') > 72) throw E.badRequest('La contrasena es demasiado larga (maximo 72 bytes; los acentos y simbolos cuentan doble)', 'PASSWORD_DEBIL');
}
function validarEmail(e) {
  if (typeof e !== 'string' || e.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw E.badRequest('Correo invalido', 'EMAIL_INVALIDO');
}
function validarNombre(v, campo) {
  if (typeof v !== 'string' || v.trim().length < 2 || v.length > 80) throw E.badRequest(`${campo} invalido`, 'DATOS_INVALIDOS');
}

const publico = (u) => ({
  id: u.id, rol: u.rol, nombre: u.nombre, apellido: u.apellido, email: u.email,
  codigo_estudiantil: u.codigo_estudiantil, avatar_color: u.avatar_color, dos_factores: !!u.totp_activo
});

// ---------- tokens ----------
function firmarAccessToken(u) {
  return jwt.sign({ sub: u.id, rol: u.rol }, secreto(), { expiresIn: ACCESS_TTL, algorithm: 'HS256' });
}
function verificarAccessToken(token) {
  try {
    const p = jwt.verify(token, secreto(), { algorithms: ['HS256'] });
    return { id: p.sub, rol: p.rol };
  } catch (e) {
    throw E.unauthorized(e.name === 'TokenExpiredError' ? 'Sesion expirada' : 'Token invalido',
      e.name === 'TokenExpiredError' ? 'TOKEN_EXPIRADO' : 'TOKEN_INVALIDO');
  }
}
async function emitirTokens(u, t) {
  const refresh = crypto.randomBytes(48).toString('hex');
  await insert(
    'INSERT INTO refresh_tokens (usuario_id,token_hash,expira_at) VALUES (:u,:h,DATE_ADD(UTC_TIMESTAMP(), INTERVAL :d DAY))',
    { u: u.id, h: sha256(refresh), d: REFRESH_DIAS }, t
  );
  return { accessToken: firmarAccessToken(u), refreshToken: refresh, expiraEn: ACCESS_TTL };
}

const buscarUsuarioPorEmail = (email, t) => one(
  `SELECT u.*, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.email = :e`,
  { e: String(email).trim().toLowerCase() }, t);

// ---------- registro (solo estudiantes se auto-registran) ----------
async function registrarEstudiante({ nombre, apellido, email, password, codigo_estudiantil = null, consentimientos = {}, version_consentimiento } = {}, { ip } = {}) {
  validarNombre(nombre, 'Nombre'); validarNombre(apellido, 'Apellido'); validarEmail(email); validarPassword(password);
  if (codigo_estudiantil !== null && !/^[A-Za-z0-9]{4,20}$/.test(String(codigo_estudiantil))) {
    throw E.badRequest('Codigo estudiantil invalido', 'CODIGO_INVALIDO');
  }
  if (consentimientos === null || typeof consentimientos !== 'object' || Array.isArray(consentimientos)) consentimientos = {};
  if (consentimientos.tratamiento_datos !== true) {
    throw E.badRequest('Debes aceptar el tratamiento de datos personales para registrarte', 'CONSENTIMIENTO_REQUERIDO');
  }
  if (consentimientos.mayoria_edad !== true) {
    throw E.badRequest('Debes declarar que eres mayor de 18 anos para registrarte', 'EDAD_REQUERIDA');
  }
  // La app envia la version de los textos que la persona vio; si cambiaron mientras tanto, debe leerlos de nuevo.
  if (version_consentimiento !== undefined && version_consentimiento !== textos.VERSION) {
    throw E.conflict('Los textos de consentimiento cambiaron. Vuelve a leerlos y aceptarlos.', 'TEXTOS_DESACTUALIZADOS');
  }
  const mail = email.trim().toLowerCase();
  if (await buscarUsuarioPorEmail(mail)) throw E.conflict('Ya existe una cuenta con ese correo', 'EMAIL_EN_USO');
  if (codigo_estudiantil && await one('SELECT id FROM usuarios WHERE codigo_estudiantil=:c', { c: codigo_estudiantil })) {
    throw E.conflict('Ese codigo estudiantil ya esta registrado', 'CODIGO_EN_USO');
  }
  const hash = await bcrypt.hash(password, 10);
  const colores = ['#EF4444', '#F59E0B', '#10B981', '#6366F1', '#EC4899', '#14B8A6', '#0EA5E9'];
  return tx(async (t) => {
    const id = await insert(
      `INSERT INTO usuarios (rol_id,nombre,apellido,email,password_hash,codigo_estudiantil,avatar_color)
       VALUES (1,:n,:a,:e,:h,:c,:col)`,
      { n: nombre.trim(), a: apellido.trim(), e: mail, h: hash, c: codigo_estudiantil, col: colores[crypto.randomInt(colores.length)] }, t);
    for (const tipo of TIPOS_CONSENTIMIENTO) {
      if (tipo in consentimientos) {
        await insert('INSERT INTO consentimientos (usuario_id,tipo,aceptado,version_politica,texto_hash,ip) VALUES (:u,:t,:a,:v,:h,:ip)',
          { u: id, t: tipo, a: consentimientos[tipo] === true ? 1 : 0, v: textos.VERSION, h: textos.porTipo[tipo].hash, ip: ip ? String(ip).slice(0, 45) : null }, t);
      }
    }
    const u = await buscarUsuarioPorEmail(mail, t);
    const tokens = await emitirTokens(u, t);
    return { usuario: publico(u), ...tokens };
  });
}

// ---------- login ----------
// Bloqueo temporal por cuenta (persistente en la BD, sobrevive a reinicios y a cambios de IP). Se cuenta por el correo
// escrito, exista o no, para no revelar que cuentas existen. Un login correcto borra los fallos de ese correo.
async function fallosRecientes(mail) {
  const f = await one(
    'SELECT COUNT(*) AS n FROM intentos_login WHERE email=:e AND creado_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL :m MINUTE)',
    { e: mail, m: VENTANA_FALLOS_MIN });
  return Number(f.n);
}
async function login(email, password, { ip } = {}) {
  const mail = typeof email === 'string' ? email.trim().toLowerCase().slice(0, 150) : null;
  if (mail && await fallosRecientes(mail) >= MAX_FALLOS_LOGIN) {
    throw E.tooMany(`Demasiados intentos fallidos con este correo. Espera ${VENTANA_FALLOS_MIN} minutos o restablece tu contrasena con el enlace "Olvide mi contrasena".`, 'CUENTA_BLOQUEADA_TEMPORAL');
  }
  const u = mail ? await buscarUsuarioPorEmail(mail) : null;
  // Siempre se compara un hash (aunque el usuario no exista) para no revelar si el correo existe por tiempos de respuesta.
  const ok = await bcrypt.compare(String(password || ''), u ? u.password_hash : HASH_FALSO);
  if (!u || !ok || !u.activo || !ROLES_VALIDOS.includes(u.rol)) {
    if (mail) {
      await insert('INSERT INTO intentos_login (email,ip,creado_at) VALUES (:e,:ip,UTC_TIMESTAMP())', { e: mail, ip: ip ? String(ip).slice(0, 45) : null });
      await run('DELETE FROM intentos_login WHERE creado_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY)'); // limpieza
    }
    throw E.unauthorized('Correo o contrasena incorrectos', 'CREDENCIALES_INVALIDAS');
  }
  // Segundo factor: con 2FA activo no se entregan tokens hasta verificar el codigo; el admin SIN 2FA debe configurarlo primero.
  const seg = require('./seguridad');
  if (u.totp_activo) return { requiere_2fa: true, desafio: seg.firmarDesafio(u.id, 'login') };
  if (u.rol === 'admin' && seg.admin2faObligatorio()) return { requiere_configurar_2fa: true, desafio: seg.firmarDesafio(u.id, 'setup') };
  return completarLogin(u);
}
// Sesion completa: borra los fallos del correo y entrega los tokens.
function completarLogin(u) {
  return tx(async (t) => {
    await run('DELETE FROM intentos_login WHERE email=:e', { e: u.email }, t);
    await run('UPDATE usuarios SET ultimo_login = UTC_TIMESTAMP() WHERE id=:id', { id: u.id }, t);
    return { usuario: publico(u), ...(await emitirTokens(u, t)) };
  });
}

// ---------- refresh con rotacion y deteccion de reutilizacion ----------
async function refrescar(refreshToken) {
  if (typeof refreshToken !== 'string' || refreshToken.length < 20) throw E.unauthorized('Refresh token invalido', 'TOKEN_INVALIDO');
  const fila = await one('SELECT * FROM refresh_tokens WHERE token_hash=:h', { h: sha256(refreshToken) });
  if (!fila) throw E.unauthorized('Refresh token invalido', 'TOKEN_INVALIDO');
  if (fila.revocado_at) {
    // Un token ya usado vuelve a presentarse: posible robo. Se cierran todas las sesiones del usuario.
    await run('UPDATE refresh_tokens SET revocado_at = UTC_TIMESTAMP() WHERE usuario_id=:u AND revocado_at IS NULL', { u: fila.usuario_id });
    throw E.unauthorized('Sesion invalidada por seguridad, inicia sesion de nuevo', 'TOKEN_REUTILIZADO');
  }
  const vigente = await one('SELECT (expira_at > UTC_TIMESTAMP()) AS ok FROM refresh_tokens WHERE id=:id', { id: fila.id });
  if (!vigente.ok) throw E.unauthorized('Sesion expirada', 'TOKEN_EXPIRADO');
  const u = await one('SELECT u.*, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id=u.rol_id WHERE u.id=:id', { id: fila.usuario_id });
  if (!u || !u.activo || !ROLES_VALIDOS.includes(u.rol)) throw E.unauthorized('Cuenta desactivada', 'CUENTA_INACTIVA');
  return tx(async (t) => {
    await run('UPDATE refresh_tokens SET revocado_at = UTC_TIMESTAMP() WHERE id=:id', { id: fila.id }, t);
    return { usuario: publico(u), ...(await emitirTokens(u, t)) };
  });
}

async function logout(refreshToken) {
  if (typeof refreshToken !== 'string') return;
  await run('UPDATE refresh_tokens SET revocado_at = UTC_TIMESTAMP() WHERE token_hash=:h AND revocado_at IS NULL', { h: sha256(refreshToken) });
}

// ---------- consentimientos ----------
async function registrarConsentimiento(actor, tipo, aceptado, { ip = null } = {}) {
  if (!TIPOS_CONSENTIMIENTO.includes(tipo)) throw E.badRequest('Tipo de consentimiento invalido', 'DATOS_INVALIDOS');
  if (tipo === 'mayoria_edad' && !aceptado) throw E.badRequest('La declaracion de edad no se puede retirar; si ya no quieres usar PlayFit, elimina tu cuenta', 'DATOS_INVALIDOS');
  await insert('INSERT INTO consentimientos (usuario_id,tipo,aceptado,version_politica,texto_hash,ip) VALUES (:u,:t,:a,:v,:h,:ip)',
    { u: actor.id, t: tipo, a: aceptado ? 1 : 0, v: textos.VERSION, h: textos.porTipo[tipo].hash, ip: ip ? String(ip).slice(0, 45) : null });
}
// El ultimo registro manda: si lo revoco, deja de valer.
async function tieneConsentimiento(usuarioId, tipo) {
  const f = await one('SELECT aceptado FROM consentimientos WHERE usuario_id=:u AND tipo=:t ORDER BY id DESC LIMIT 1', { u: usuarioId, t: tipo });
  return !!(f && f.aceptado);
}
const listarConsentimientos = async (actor) => {
  const out = {};
  for (const t of TIPOS_CONSENTIMIENTO) out[t] = await tieneConsentimiento(actor.id, t);
  return out;
};

// ---------- perfil / password ----------
async function perfil(actor) {
  const u = await one('SELECT u.*, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id=u.rol_id WHERE u.id=:id', { id: actor.id });
  if (!u) throw E.notFound('Usuario no encontrado');
  return publico(u);
}
async function cambiarPassword(actor, actual, nueva) {
  validarPassword(nueva);
  const u = await one('SELECT password_hash FROM usuarios WHERE id=:id', { id: actor.id });
  if (!u || !(await bcrypt.compare(String(actual || ''), u.password_hash))) throw E.unauthorized('Contrasena actual incorrecta', 'CREDENCIALES_INVALIDAS');
  const hash = await bcrypt.hash(nueva, 10);
  await tx(async (t) => {
    await run('UPDATE usuarios SET password_hash=:h WHERE id=:id', { h: hash, id: actor.id }, t);
    await run('UPDATE refresh_tokens SET revocado_at = UTC_TIMESTAMP() WHERE usuario_id=:id AND revocado_at IS NULL', { id: actor.id }, t);
  });
}

// ---------- eliminar la propia cuenta (derecho de supresion, Ley 1581) ----------
// Borra al estudiante y, por las llaves foraneas en cascada, sus sesiones, historial clinico, flags, mediciones,
// consentimientos, notificaciones, conversaciones de IA, etc. Si lidera un squad, el liderazgo pasa al de mas XP.
async function eliminarCuenta(actor, password, { ip } = {}) {
  if (!actor || actor.rol !== 'estudiante') throw E.forbidden('Solo los estudiantes pueden eliminar su cuenta desde la app');
  const u = await one('SELECT password_hash FROM usuarios WHERE id=:id', { id: actor.id });
  if (!u || !(await bcrypt.compare(String(password || ''), u.password_hash))) throw E.unauthorized('Contrasena incorrecta', 'CREDENCIALES_INVALIDAS');
  await tx(async (t) => {
    const sm = await one('SELECT squad_id, rol FROM squad_miembros WHERE estudiante_id=:e', { e: actor.id }, t);
    if (sm) {
      const otros = await select(
        `SELECT sm.estudiante_id FROM squad_miembros sm LEFT JOIN perfil_gamificacion g ON g.estudiante_id=sm.estudiante_id
         WHERE sm.squad_id=:s AND sm.estudiante_id<>:e ORDER BY COALESCE(g.xp_total,0) DESC, sm.unido_at ASC`, { s: sm.squad_id, e: actor.id }, t);
      await run('DELETE FROM squad_miembros WHERE estudiante_id=:e', { e: actor.id }, t);
      if (!otros.length) await run('DELETE FROM squads WHERE id=:s', { s: sm.squad_id }, t);
      else if (sm.rol === 'lider') {
        await run('UPDATE squads SET lider_id=:l WHERE id=:s', { l: otros[0].estudiante_id, s: sm.squad_id }, t);
        await run("UPDATE squad_miembros SET rol='lider' WHERE squad_id=:s AND estudiante_id=:l", { s: sm.squad_id, l: otros[0].estudiante_id }, t);
      }
    }
    await audit.registrar(actor, 'eliminar', 'usuario', actor.id, { ip, t }); // el usuario_id queda en NULL al borrarse la cuenta
    await run('DELETE FROM usuarios WHERE id=:e', { e: actor.id }, t);
  });
}

// ---------- administracion de usuarios (solo admin) ----------
async function crearUsuarioStaff(actor, { rol, nombre, apellido, email, password }) {
  rbac.requirePermiso(actor, 'usuario:gestionar');
  if (rol !== 'admin') throw E.badRequest('Solo se pueden crear cuentas de administrador (los usuarios se registran solos)', 'DATOS_INVALIDOS');
  validarNombre(nombre, 'Nombre'); validarNombre(apellido, 'Apellido'); validarEmail(email); validarPassword(password);
  const mail = email.trim().toLowerCase();
  if (await buscarUsuarioPorEmail(mail)) throw E.conflict('Ya existe una cuenta con ese correo', 'EMAIL_EN_USO');
  const hash = await bcrypt.hash(password, 10);
  const id = await insert(
    'INSERT INTO usuarios (rol_id,nombre,apellido,email,password_hash) VALUES ((SELECT id FROM roles WHERE nombre=:r),:n,:a,:e,:h)',
    { r: rol, n: nombre.trim(), a: apellido.trim(), e: mail, h: hash });
  await audit.registrar(actor, 'crear', 'usuario', id);
  return publico(await buscarUsuarioPorEmail(mail));
}
async function cambiarEstadoUsuario(actor, usuarioId, activo) {
  rbac.requirePermiso(actor, 'usuario:gestionar');
  if (actor.id === usuarioId) throw E.badRequest('No puedes desactivar tu propia cuenta', 'DATOS_INVALIDOS');
  const u = await one('SELECT id FROM usuarios WHERE id=:id', { id: usuarioId });
  if (!u) throw E.notFound('Usuario no encontrado');
  await tx(async (t) => {
    await run('UPDATE usuarios SET activo=:a WHERE id=:id', { a: activo ? 1 : 0, id: usuarioId }, t);
    if (!activo) await run('UPDATE refresh_tokens SET revocado_at = UTC_TIMESTAMP() WHERE usuario_id=:id AND revocado_at IS NULL', { id: usuarioId }, t);
    await audit.registrar(actor, 'actualizar', 'usuario', usuarioId, { t });
  });
}
async function listarUsuarios(actor) {
  rbac.requirePermiso(actor, 'usuario:gestionar');
  return select('SELECT u.id, r.nombre AS rol, u.nombre, u.apellido, u.email, u.activo, u.totp_activo AS dos_factores, u.ultimo_login, u.created_at FROM usuarios u JOIN roles r ON r.id=u.rol_id ORDER BY u.id');
}

module.exports = {
  registrarEstudiante, login, completarLogin, emitirTokens, publico, buscarUsuarioPorEmail, validarPassword, sha256, secreto, fallosRecientes, MAX_FALLOS_LOGIN, VENTANA_FALLOS_MIN, refrescar, logout, verificarAccessToken,
  registrarConsentimiento, tieneConsentimiento, listarConsentimientos,
  perfil, cambiarPassword, eliminarCuenta, crearUsuarioStaff, cambiarEstadoUsuario, listarUsuarios, TIPOS_CONSENTIMIENTO
};
