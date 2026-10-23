// Envio de correo con la API HTTP de Brevo (https://developers.brevo.com). Sin dependencias: usa fetch.
// Variables: BREVO_API_KEY, MAIL_FROM (remitente verificado en Brevo), MAIL_FROM_NAME (opcional).
// Sin BREVO_API_KEY: en desarrollo/pruebas el correo se imprime en consola (ahi lees el codigo);
// en produccion se registra un error en el log (el usuario igual recibe la respuesta generica).
let transporte = null; // las pruebas lo reemplazan para capturar los correos

const setTransporte = (fn) => { transporte = fn; };

async function enviarBrevo({ para, asunto, html, texto }) {
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: process.env.MAIL_FROM, name: process.env.MAIL_FROM_NAME || 'PlayFit' },
      to: [{ email: para }], subject: asunto, htmlContent: html, textContent: texto
    }),
    signal: AbortSignal.timeout(10000)
  });
  if (!r.ok) throw new Error(`Brevo respondio ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

async function enviar(correo) {
  if (transporte) return transporte(correo);
  if (process.env.BREVO_API_KEY && process.env.MAIL_FROM) return enviarBrevo(correo);
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Correo no configurado: define BREVO_API_KEY y MAIL_FROM');
  }
  console.log(`[correo:desarrollo] Para: ${correo.para} | ${correo.asunto}\n${correo.texto}`);
}

function correoRecuperacion(para, nombre, codigo, minutos) {
  const texto = `Hola ${nombre},\n\nTu codigo para restablecer la contrasena de PlayFit es: ${codigo}\nVence en ${minutos} minutos. Si no lo pediste tu, ignora este mensaje: tu contrasena sigue igual.\n\nEl equipo de PlayFit`;
  const html = `<p>Hola ${escapar(nombre)},</p><p>Tu código para restablecer la contraseña de PlayFit es:</p>` +
    `<p style="font-size:28px;letter-spacing:6px;font-weight:bold">${codigo}</p>` +
    `<p>Vence en ${minutos} minutos. Si no lo pediste tú, ignora este mensaje: tu contraseña sigue igual.</p><p>El equipo de PlayFit</p>`;
  return { para, asunto: 'Código para restablecer tu contraseña de PlayFit', html, texto };
}
const escapar = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

module.exports = { enviar, setTransporte, correoRecuperacion };
