// Textos de consentimiento (Ley 1581 de 2012 y Decreto 1377 de 2013). La app los muestra tal cual y el servidor guarda,
// junto con cada aceptacion, la version y el hash SHA-256 del texto exacto que la persona vio (evidencia).
// Si cambias un texto, SUBE la version: asi queda claro a cual texto se dio cada consentimiento.
const crypto = require('crypto');

const VERSION = '2.0';
const TEXTOS = [
  { codigo: 'A1', tipo: 'tratamiento_datos', obligatorio: true, titulo: 'Tratamiento de datos personales',
    texto: 'Autorizo a PlayFit a recolectar y usar mis datos personales (nombre, correo, actividad de entrenamiento y progreso) para prestarme el servicio, calcular mis rachas, retos y rankings y mostrarme mi avance. Puedo conocer, actualizar, rectificar o suprimir mis datos y revocar esta autorizacion cuando quiera, eliminando mi cuenta desde la app.' },
  { codigo: 'A2', tipo: 'datos_salud', obligatorio: false, titulo: 'Datos de salud (sensibles)',
    texto: 'Autorizo el tratamiento de mis datos de salud (condiciones, lesiones y medicamentos) para recibir ejercicios seguros. Es un dato sensible: no estoy obligado a darlo, se guarda cifrado, nadie del equipo de PlayFit puede leerlo y a la inteligencia artificial solo llegan etiquetas generales (por ejemplo "cuidar la rodilla"), nunca el texto.' },
  { codigo: 'A3', tipo: 'uso_camara', obligatorio: false, titulo: 'Uso de la camara',
    texto: 'Autorizo el uso de la camara de mi celular para analizar mi tecnica en tiempo real. El video se procesa en mi dispositivo y no se envia ni se guarda en los servidores de PlayFit.' },
  { codigo: 'A4', tipo: 'ia_chatbot', obligatorio: false, titulo: 'Asistente de inteligencia artificial',
    texto: 'Autorizo que mis mensajes con el asistente de IA se envien a un proveedor externo de IA para generar respuestas. Entiendo que el asistente no es un medico ni da diagnosticos, y que no debo escribirle datos de salud sensibles.' },
  { codigo: 'EDAD', tipo: 'mayoria_edad', obligatorio: true, titulo: 'Declaracion de edad',
    texto: 'Declaro bajo mi responsabilidad que soy mayor de 18 anos.' }
];
const hashDe = (texto) => crypto.createHash('sha256').update(texto, 'utf8').digest('hex');
const porTipo = Object.fromEntries(TEXTOS.map((t) => [t.tipo, { ...t, hash: hashDe(t.texto) }]));

const publico = () => ({ version: VERSION, textos: TEXTOS.map(({ codigo, tipo, obligatorio, titulo, texto }) => ({ codigo, tipo, obligatorio, titulo, texto, hash: porTipo[tipo].hash })) });
module.exports = { VERSION, TEXTOS, porTipo, publico, hashDe, TIPOS: TEXTOS.map((t) => t.tipo) };
