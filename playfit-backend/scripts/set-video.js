// Asigna el video de YouTube de un ejercicio (la app lo abre con el boton "Ver video de la tecnica").
//   npm run video                                              -> lista los ejercicios y su video actual
//   npm run video -- sentadilla https://youtu.be/XXXXXXXXXXX   -> asigna el video (acepta enlace o el ID de 11 caracteres)
//   npm run video -- sentadilla quitar                         -> borra el video
require('../shared/src/env').load();
const db = require('../shared/src/db');

function idDeYoutube(txt) {
  const t = String(txt || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(t)) return t;
  const m = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/.exec(t);
  return m ? m[1] : null;
}

(async () => {
  const [ejercicio, video] = process.argv.slice(2);
  try {
    if (!ejercicio) {
      const filas = await db.select('SELECT id, slug, nombre, youtube_id FROM ejercicios WHERE activo=1 ORDER BY id');
      console.log('Ejercicios (slug · video):');
      for (const f of filas) console.log(`  ${String(f.id).padStart(2)}  ${f.slug.padEnd(16)} ${f.youtube_id || '(sin video)'}`);
      console.log('\nPara asignar uno:  npm run video -- <slug> <enlace de YouTube>');
      return;
    }
    const ej = await db.one('SELECT id, nombre FROM ejercicios WHERE slug=:s OR id=:n', { s: ejercicio, n: Number(ejercicio) || 0 });
    if (!ej) { console.error(`No existe el ejercicio "${ejercicio}". Corre "npm run video" para ver la lista.`); process.exitCode = 1; return; }
    if (video === 'quitar') {
      await db.run('UPDATE ejercicios SET youtube_id=NULL WHERE id=:id', { id: ej.id });
      console.log(`${ej.nombre}: video quitado.`);
      return;
    }
    const id = idDeYoutube(video);
    if (!id) { console.error('No reconozco ese enlace de YouTube. Ejemplo: https://www.youtube.com/watch?v=XXXXXXXXXXX'); process.exitCode = 1; return; }
    await db.run('UPDATE ejercicios SET youtube_id=:v WHERE id=:id', { v: id, id: ej.id });
    console.log(`${ej.nombre}: video asignado (${id}). Abre el ejercicio en la app para verlo.`);
  } catch (e) {
    console.error('Error:', e.message);
    process.exitCode = 1;
  } finally {
    await db.sequelize.close();
  }
})();
