// Crea el archivo .env con secretos aleatorios. Uso:  npm run setup -- --db-port=3307
// No sobrescribe un .env existente (la CLINICAL_KEY cifra datos de salud: si la pierdes o la cambias,
// los historiales ya guardados quedan ilegibles). Para forzar: --force
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split('=').slice(1).join('=') : d; };
const destino = path.join(__dirname, '..', '.env');

if (fs.existsSync(destino) && !process.argv.includes('--force')) {
  console.log('Ya existe un archivo .env, no lo toque (protege tu CLINICAL_KEY). Usa --force solo si sabes lo que haces.');
  process.exit(0);
}
const contenido = `# Generado por "npm run setup". NO lo subas a Git ni lo compartas.
# --- Base de datos ---
DB_HOST=127.0.0.1
DB_PORT=${arg('db-port', '3306')}
DB_NAME=${arg('db-name', 'playfit_dev')}
DB_USER=playfit_app
DB_PASS=${arg('db-pass', 'playfit_dev_pass')}
# --- Zona horaria (las rachas cambian a medianoche de esta zona) ---
APP_TZ=America/Bogota
# --- Seguridad ---
JWT_SECRET=${crypto.randomBytes(48).toString('hex')}
# CLINICAL_KEY cifra el historial clinico. GUARDA UNA COPIA: si se pierde, esos datos no se pueden recuperar.
CLINICAL_KEY=${crypto.randomBytes(32).toString('hex')}
# --- Puertos ---
GATEWAY_PORT=3000
GATEWAY_HOST=0.0.0.0
AUTH_PORT=3001
CLINICAL_PORT=3002
SOCIAL_PORT=3003
CONTENT_PORT=3004
# --- Limites del gateway ---
RATE_LIMIT_GLOBAL=300
RATE_LIMIT_AUTH=10
# Origenes web permitidos por CORS, separados por coma (la app movil no lo necesita). Ej: http://localhost:5000
CORS_ORIGINS=
# --- IA (Gemini). Sin clave el resto funciona y el chat responde 503. ---
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.1-flash-lite
IA_LIMITE_DIARIO=20
`;
fs.writeFileSync(destino, contenido, { mode: 0o600 });
console.log(`Listo: se creo ${destino}`);
console.log(`  DB_PORT=${arg('db-port', '3306')}  (si MariaDB usa otro puerto: npm run setup -- --force --db-port=XXXX)`);
