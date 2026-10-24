// Cliente minimo de Wompi (pasarela de pagos de Colombia). Se usa en SANDBOX: no se mueve plata real.
// Variables:
//   WOMPI_ENV            sandbox (por defecto) | production
//   WOMPI_PUBLIC_KEY     pub_test_...   (consultar transacciones)
//   WOMPI_PRIVATE_KEY    prv_test_...   (crear enlaces de pago)  -> SECRETA
//   WOMPI_EVENTS_SECRET  test_events_... (verificar la firma de los webhooks) -> SECRETA
//   WOMPI_REDIRECT_URL   a donde vuelve el usuario despues de pagar (pagina del backend)
// PlayFit nunca recibe ni guarda datos de tarjeta: el usuario paga en el checkout de Wompi.
const crypto = require('crypto');

const BASES = { sandbox: 'https://sandbox.wompi.co/v1', production: 'https://production.wompi.co/v1' };
const ambiente = () => (process.env.WOMPI_ENV === 'production' ? 'production' : 'sandbox');
const configurado = () => !!(process.env.WOMPI_PRIVATE_KEY && process.env.WOMPI_EVENTS_SECRET);
const urlCheckout = (linkId) => `https://checkout.wompi.co/l/${encodeURIComponent(linkId)}`;
// En un evento, environment = "test" en sandbox y "prod" en produccion.
const ambienteEvento = () => (ambiente() === 'production' ? 'prod' : 'test');

class WompiError extends Error {
  constructor(message, status) { super(message); this.name = 'WompiError'; this.status = status; }
}

function crearCliente({ fetchFn = fetch } = {}) {
  const base = BASES[ambiente()];
  async function pedir(metodo, ruta, { body, clave } = {}) {
    let res;
    try {
      res = await fetchFn(`${base}${ruta}`, {
        method: metodo,
        headers: { 'Content-Type': 'application/json', ...(clave ? { Authorization: `Bearer ${clave}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15000)
      });
    } catch (e) {
      throw new WompiError(`No pude conectarme con Wompi: ${e.message}`, 0);
    }
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) {
      const det = data && data.error ? JSON.stringify(data.error).slice(0, 300) : `HTTP ${res.status}`;
      throw new WompiError(`Wompi respondio ${res.status}: ${det}`, res.status);
    }
    return data && data.data;
  }
  return {
    // Enlace de un solo uso por un monto fijo en COP. Devuelve { id, url }.
    async crearEnlace({ nombre, descripcion, montoCentavos, redirectUrl, sku }) {
      const privada = process.env.WOMPI_PRIVATE_KEY;
      if (!privada) throw new WompiError('Falta WOMPI_PRIVATE_KEY', 0);
      const d = await pedir('POST', '/payment_links', {
        clave: privada,
        body: {
          name: String(nombre).slice(0, 60), description: String(descripcion).slice(0, 255),
          single_use: true, collect_shipping: false, currency: 'COP', amount_in_cents: montoCentavos,
          ...(redirectUrl ? { redirect_url: redirectUrl } : {}), ...(sku ? { sku: String(sku).slice(0, 36) } : {})
        }
      });
      if (!d || !d.id) throw new WompiError('Wompi no devolvio el id del enlace', 0);
      return { id: String(d.id), url: urlCheckout(d.id) };
    },
    // Estado real de una transaccion, consultado directamente a Wompi.
    consultarTransaccion: (id) => pedir('GET', `/transactions/${encodeURIComponent(id)}`, { clave: process.env.WOMPI_PUBLIC_KEY || null })
  };
}

// Firma de un evento: SHA256( valores de signature.properties en orden + timestamp + secreto ), en hexadecimal.
const valorEn = (obj, ruta) => String(ruta).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
function checksumEvento(evento, secreto) {
  const props = (evento && evento.signature && evento.signature.properties) || [];
  const cadena = props.map((p) => { const v = valorEn(evento.data, p); return v == null ? '' : String(v); }).join('')
    + String(evento.timestamp) + secreto;
  return crypto.createHash('sha256').update(cadena).digest('hex');
}
function firmaValida(evento, secreto = process.env.WOMPI_EVENTS_SECRET) {
  if (!secreto || !evento || typeof evento !== 'object') return false;
  const sig = evento.signature;
  if (!sig || !Array.isArray(sig.properties) || !sig.properties.length || typeof sig.checksum !== 'string') return false;
  if (!/^[0-9a-f]{64}$/i.test(sig.checksum) || evento.timestamp === undefined) return false;
  const a = Buffer.from(checksumEvento(evento, secreto), 'hex');
  const b = Buffer.from(sig.checksum.toLowerCase(), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { crearCliente, firmaValida, checksumEvento, configurado, ambiente, ambienteEvento, urlCheckout, WompiError, BASES };
