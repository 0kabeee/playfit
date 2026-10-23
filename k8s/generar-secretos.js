// Crea k8s/overlays/ENTORNO/secrets.env con secretos aleatorios para Kubernetes.
// Uso (desde C:\playfit):   node k8s/generar-secretos.js local     |     node k8s/generar-secretos.js azure
// - No sobrescribe un archivo existente (CLINICAL_KEY cifra el historial clinico: si se pierde, esos datos no se
//   recuperan). Para forzar:  node k8s/generar-secretos.js azure --force
// - Copia GEMINI_API_KEY de playfit-backend/.env si la encuentra.
// - Guarda una copia del archivo en un lugar seguro (NO en Git, NO en el chat).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const entorno = process.argv[2];
if (!['local', 'azure'].includes(entorno)) {
  console.error('Uso: node k8s/generar-secretos.js local   (o azure)');
  process.exit(1);
}
const destino = path.join(__dirname, 'overlays', entorno, 'secrets.env');
if (fs.existsSync(destino) && !process.argv.includes('--force')) {
  console.log(`Ya existe ${destino}; no lo toque (protege tu CLINICAL_KEY). Usa --force solo si la base esta vacia.`);
  process.exit(0);
}

function geminiDelEnv() {
  const archivo = path.join(__dirname, '..', 'playfit-backend', '.env');
  if (!fs.existsSync(archivo)) return '';
  const linea = fs.readFileSync(archivo, 'utf8').split(/\r?\n/).find((l) => l.startsWith('GEMINI_API_KEY='));
  return linea ? linea.slice('GEMINI_API_KEY='.length).trim() : '';
}
// Contrasena legible para las cuentas de ejemplo (sin caracteres que confundan: 0/O, 1/l)
function contrasenaLegible(n = 14) {
  const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (const b of crypto.randomBytes(n)) s += abc[b % abc.length];
  return `${s}!`;
}

const demo = contrasenaLegible();
const gemini = geminiDelEnv();
const contenido = [
  `# Secretos de PlayFit para Kubernetes (${entorno}). NO lo subas a Git ni lo compartas. GUARDA UNA COPIA SEGURA.`,
  `DB_PASS=${crypto.randomBytes(24).toString('hex')}`,
  `MARIADB_ROOT_PASSWORD=${crypto.randomBytes(24).toString('hex')}`,
  `JWT_SECRET=${crypto.randomBytes(48).toString('hex')}`,
  `CLINICAL_KEY=${crypto.randomBytes(32).toString('hex')}`,
  `DEMO_PASSWORD=${demo}`,
  `GEMINI_API_KEY=${gemini}`,
  '# Correo con Brevo (recuperacion de contrasena). Crea una cuenta gratis en brevo.com, genera una clave API y verifica un remitente.',
  'BREVO_API_KEY=',
  'MAIL_FROM=',
  ''
].join('\n');
fs.writeFileSync(destino, contenido, { mode: 0o600 });
console.log(`Listo: ${destino}`);
console.log(`  Contrasena de las cuentas de ejemplo (ana@playfit.test, admin@playfit.test, ...): ${demo}`);
console.log(gemini ? '  GEMINI_API_KEY copiada de playfit-backend/.env' : '  AVISO: sin GEMINI_API_KEY (el chat de IA respondera 503). Puedes pegarla en el archivo.');
console.log('  Haz una copia de este archivo en un lugar seguro: la CLINICAL_KEY no se puede recuperar.');
