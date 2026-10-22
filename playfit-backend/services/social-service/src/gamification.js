// Reglas puras de gamificacion (sin base de datos): faciles de probar y de ajustar.
const { clock } = require('@playfit/shared');

const XP = {
  SESION: 50,              // por sesion registrada
  MAX_SESIONES_CON_XP_DIA: 2, // anti-abuso: solo las 2 primeras sesiones del dia dan XP
  RECORD: 25,              // por ejercicio donde superas tu marca personal
  RACHA: { 7: 100, 14: 200, 30: 500 }, // bono al alcanzar esa racha
  POR_NIVEL: 300
};

const nivelDesdeXp = (xp) => Math.floor(xp / XP.POR_NIVEL) + 1;
function progresoNivel(xp) {
  const enNivel = xp % XP.POR_NIVEL;
  return { nivel: nivelDesdeXp(xp), xp_en_nivel: enNivel, xp_para_siguiente: XP.POR_NIVEL - enNivel, porcentaje: Math.round((enNivel / XP.POR_NIVEL) * 100) };
}

// Nueva racha al registrar actividad en `fecha`, dado el ultimo dia activo y la racha guardada.
function calcularRacha(ultima, rachaActual, fecha) {
  if (!ultima) return 1;
  const d = clock.diffDays(fecha, ultima);
  if (d === 0) return Math.max(rachaActual, 1);
  if (d === 1) return rachaActual + 1;
  if (d > 1) return 1;
  return Math.max(rachaActual, 1); // sesion con fecha anterior a la ultima: no altera la racha
}
// Racha "viva" hoy: si pasaron mas de 1 dia sin entrenar, esta rota (0).
function rachaVigente(ultima, racha, hoy) {
  if (!ultima) return 0;
  return clock.diffDays(hoy, ultima) > 1 ? 0 : racha;
}
// Que bono de racha se gana al pasar de `antes` a `despues` (solo si sube y toca justo un hito).
const bonoRacha = (antes, despues) => (despues > antes && XP.RACHA[despues] ? XP.RACHA[despues] : 0);

module.exports = { XP, nivelDesdeXp, progresoNivel, calcularRacha, rachaVigente, bonoRacha };
