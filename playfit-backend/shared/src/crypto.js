// Cifrado AES-256-GCM para los campos clinicos crudos. Formato: v1:iv:tag:cifrado (base64).
const crypto = require('crypto');

function key() {
  const hex = process.env.CLINICAL_KEY || '';
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error('CLINICAL_KEY debe tener 64 caracteres hexadecimales (32 bytes). Revisa tu .env');
  }
  return Buffer.from(hex, 'hex');
}

function encrypt(texto) {
  if (texto === null || texto === undefined || texto === '') return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}

function decrypt(payload) {
  if (!payload) return null;
  const [v, iv, tag, enc] = payload.split(':');
  if (v !== 'v1') throw new Error('Formato de cifrado desconocido');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
