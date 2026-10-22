// Levanta los 5 procesos (gateway + 4 servicios) con un solo comando: npm run dev
// Ctrl+C los detiene a todos. Si uno muere, se detienen todos (para que el error no pase desapercibido).
const { spawn } = require('child_process');
const path = require('path');

const PROCESOS = [
  { nombre: 'auth', archivo: 'services/auth-service/src/server.js', color: 36 },
  { nombre: 'clinical', archivo: 'services/clinical-service/src/server.js', color: 35 },
  { nombre: 'social', archivo: 'services/social-service/src/server.js', color: 33 },
  { nombre: 'content', archivo: 'services/content-service/src/server.js', color: 32 },
  { nombre: 'gateway', archivo: 'gateway/src/server.js', color: 34 }
];
const raiz = path.join(__dirname, '..');
const hijos = [];
let cerrando = false;

function cerrarTodo(codigo = 0) {
  if (cerrando) return;
  cerrando = true;
  for (const h of hijos) { try { h.kill(); } catch { /* ya termino */ } }
  setTimeout(() => process.exit(codigo), 500);
}

for (const p of PROCESOS) {
  const hijo = spawn(process.execPath, [path.join(raiz, p.archivo)], { cwd: raiz, env: process.env });
  const prefijo = `\x1b[${p.color}m${p.nombre.padEnd(8)}\x1b[0m| `;
  const pipe = (stream, salida) => {
    let resto = '';
    stream.on('data', (d) => {
      const lineas = (resto + d.toString()).split(/\r?\n/);
      resto = lineas.pop();
      for (const l of lineas) if (l.trim()) salida.write(prefijo + l + '\n');
    });
  };
  pipe(hijo.stdout, process.stdout); pipe(hijo.stderr, process.stderr);
  hijo.on('exit', (code) => {
    if (cerrando) return;
    console.error(`\n[dev] el proceso "${p.nombre}" termino (codigo ${code}). Detengo todo; revisa el mensaje de arriba.\n`);
    cerrarTodo(code || 1);
  });
  hijos.push(hijo);
}
process.on('SIGINT', () => cerrarTodo(0));
process.on('SIGTERM', () => cerrarTodo(0));
console.log('[dev] iniciando gateway + 4 servicios... (Ctrl+C para detener)');
