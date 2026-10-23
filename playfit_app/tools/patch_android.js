// Prepara el proyecto Android para hablar con tu backend local (http, sin HTTPS), renombra la app y agrega los
// permisos de camara, microfono y notificaciones.
// Uso (dentro de la carpeta playfit_app):   node tools/patch_android.js
// Es seguro correrlo varias veces.
const fs = require('fs');
const path = require('path');

const ruta = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
if (!fs.existsSync(ruta)) {
  console.error('No encuentro android/app/src/main/AndroidManifest.xml.\nPrimero crea el proyecto con:  flutter create playfit_app --org co.edu.usb --platforms=android');
  process.exit(1);
}
let xml = fs.readFileSync(ruta, 'utf8');
const cambios = [];

if (!xml.includes('android.permission.INTERNET')) {
  xml = xml.replace(/(<manifest[^>]*>)/, '$1\n    <uses-permission android:name="android.permission.INTERNET"/>');
  cambios.push('permiso INTERNET');
}
if (!xml.includes('android.permission.CAMERA')) {
  xml = xml.replace(/(<uses-permission android:name="android.permission.INTERNET"\/>)/, '$1\n    <uses-permission android:name="android.permission.CAMERA"/>\n    <uses-feature android:name="android.hardware.camera" android:required="false"/>');
  cambios.push('permiso de CAMARA (conteo de repeticiones)');
}
// Fase 13: microfono (dictado al asistente) y notificaciones push (Android 13+ pide permiso)
if (!xml.includes('android.permission.RECORD_AUDIO')) {
  xml = xml.replace(/(<uses-permission android:name="android.permission.INTERNET"\/>)/, '$1\n    <uses-permission android:name="android.permission.RECORD_AUDIO"/>');
  cambios.push('permiso de MICROFONO (voz del asistente)');
}
if (!xml.includes('android.permission.POST_NOTIFICATIONS')) {
  xml = xml.replace(/(<uses-permission android:name="android.permission.INTERNET"\/>)/, '$1\n    <uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>');
  cambios.push('permiso de NOTIFICACIONES');
}
// Android 11+ solo deja ver los servicios de dictado y de voz del celular si se declaran aqui
if (!xml.includes('android.speech.RecognitionService')) {
  const consultas = [
    '        <intent>\n            <action android:name="android.speech.RecognitionService"/>\n        </intent>',
    '        <intent>\n            <action android:name="android.intent.action.TTS_SERVICE"/>\n        </intent>'
  ].join('\n');
  if (/<queries>/.test(xml)) xml = xml.replace('<queries>', `<queries>\n${consultas}`);
  else xml = xml.replace('</manifest>', `    <queries>\n${consultas}\n    </queries>\n</manifest>`);
  cambios.push('acceso a los servicios de dictado y voz del celular');
}
if (!xml.includes('usesCleartextTraffic')) {
  xml = xml.replace('<application', '<application\n        android:usesCleartextTraffic="true"');
  cambios.push('trafico http permitido (solo para desarrollo)');
}
if (/android:label="playfit_app"/.test(xml)) {
  xml = xml.replace('android:label="playfit_app"', 'android:label="PlayFit"');
  cambios.push('nombre de la app: PlayFit');
}
if (cambios.length) {
  fs.writeFileSync(ruta, xml);
  console.log('AndroidManifest.xml actualizado: ' + cambios.join(', ') + '.');
} else {
  console.log('AndroidManifest.xml ya estaba listo. No cambie nada.');
}
