// TOTP (RFC 6238) con el modulo crypto de Node: sin dependencias nuevas. Compatible con Google Authenticator,
// Microsoft Authenticator, Authy, etc. (SHA-1, 6 digitos, paso de 30 s).
const crypto = require('crypto');

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PASO_S = 30, DIGITOS = 6;

function base32(buf) {
  let bits = '', out = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i < bits.length; i += 5) out += ALFABETO[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}
function desdeBase32(texto) {
  const limpio = String(texto).replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = '';
  for (const c of limpio) {
    const v = ALFABETO.indexOf(c);
    if (v < 0) throw new Error('base32 invalido');
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

const generarSecreto = () => base32(crypto.randomBytes(20)); // 160 bits

function hotp(secretoBuf, contador) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(contador));
  const h = crypto.createHmac('sha1', secretoBuf).update(msg).digest();
  const o = h[h.length - 1] & 0x0f;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** DIGITOS).padStart(DIGITOS, '0');
}
const paso = (ahoyMs = Date.now()) => Math.floor(ahoyMs / 1000 / PASO_S);
const codigoActual = (secreto, ahoyMs = Date.now()) => hotp(desdeBase32(secreto), paso(ahoyMs));

// Devuelve el paso (contador) que coincide, o null. Tolera +-1 paso por desfase de reloj del celular.
// `ultimoPaso` evita reutilizar un codigo ya aceptado (anti-repeticion).
function verificar(secreto, codigo, { ahoyMs = Date.now(), ventana = 1, ultimoPaso = null } = {}) {
  const c = String(codigo || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const buf = desdeBase32(secreto);
  const actual = paso(ahoyMs);
  let hallado = null;
  for (let d = -ventana; d <= ventana; d++) {
    const p = actual + d;
    const esperado = hotp(buf, p);
    // comparacion en tiempo constante; se recorren todos los pasos para no filtrar por tiempos
    if (crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(c)) && hallado === null) hallado = p;
  }
  if (hallado === null) return null;
  if (ultimoPaso !== null && ultimoPaso !== undefined && hallado <= Number(ultimoPaso)) return null;
  return hallado;
}

const otpauthUri = (secreto, cuenta, emisor = 'PlayFit') =>
  `otpauth://totp/${encodeURIComponent(emisor)}:${encodeURIComponent(cuenta)}?secret=${secreto}&issuer=${encodeURIComponent(emisor)}&algorithm=SHA1&digits=${DIGITOS}&period=${PASO_S}`;

// ---- cifrado del secreto en la BD (AES-256-GCM). Clave: TOTP_KEY (64 hex) o, si no hay, derivada del JWT_SECRET ----
function clave() {
  const k = process.env.TOTP_KEY;
  if (k) {
    if (!/^[0-9a-f]{64}$/i.test(k)) throw new Error('TOTP_KEY debe tener 64 caracteres hexadecimales');
    return Buffer.from(k, 'hex');
  }
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) throw new Error('JWT_SECRET no esta configurado');
  return Buffer.from(crypto.hkdfSync('sha256', s, 'playfit-totp', 'secreto-totp-v1', 32));
}
function cifrar(texto) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', clave(), iv);
  const enc = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}
function descifrar(payload) {
  const [v, iv, tag, enc] = String(payload).split(':');
  if (v !== 'v1') throw new Error('Formato de cifrado desconocido');
  const d = crypto.createDecipheriv('aes-256-gcm', clave(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8');
}

module.exports = { generarSecreto, codigoActual, verificar, otpauthUri, cifrar, descifrar, base32, desdeBase32, PASO_S };
