// Prepara el proyecto Android para hablar con tu backend local (http, sin HTTPS) y renombra la app.
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
