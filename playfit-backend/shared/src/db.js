// Conexion unica a MariaDB via Sequelize (usado como ejecutor de consultas parametrizadas).
const { Sequelize, QueryTypes } = require('sequelize');

const sequelize = new Sequelize(
  process.env.DB_NAME || 'playfit_dev',
  process.env.DB_USER || 'playfit_app',
  process.env.DB_PASS || 'playfit_dev_pass',
  {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    dialect: 'mysql',
    logging: false,
    timezone: '+00:00',
    // DATE/DATETIME llegan como texto 'YYYY-MM-DD' / 'YYYY-MM-DD HH:MM:SS' (evita desfases de zona horaria)
    dialectOptions: { dateStrings: true },
    pool: { max: 10, min: 0, idle: 10000 }
  }
);

// Todas las consultas pasan por aqui: SIEMPRE con replacements (nunca concatenar datos del usuario).
const select = (sql, replacements = {}, t) =>
  sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction: t });
const one = async (sql, replacements = {}, t) => (await select(sql, replacements, t))[0] || null;
const insert = async (sql, replacements = {}, t) => {
  const [id] = await sequelize.query(sql, { replacements, type: QueryTypes.INSERT, transaction: t });
  return id;
};
const run = (sql, replacements = {}, t) =>
  sequelize.query(sql, { replacements, type: QueryTypes.RAW, transaction: t });
// Transaccion con reintento automatico para colisiones transaccionales normales bajo concurrencia:
// - ER_LOCK_DEADLOCK: InnoDB elige esta tx como victima.
// - "Record has changed since last read": MariaDB 10.6+ detecta que la fila fue modificada por otro tx
//   entre el inicio de esta tx y el SELECT ... FOR UPDATE (optimistic check de MDEV-17713).
const RETRIABLE = new Set(['ER_LOCK_DEADLOCK']);
const RETRIABLE_MSG = 'Record has changed since last read';
const tx = async (fn) => {
  for (let intento = 1; ; intento++) {
    try { return await sequelize.transaction(fn); }
    catch (e) {
      if (intento < 3) {
        const code = e && ((e.parent && e.parent.code) || e.code);
        const msg  = (e.parent && e.parent.message) || e.message || '';
        if (RETRIABLE.has(code) || msg.includes(RETRIABLE_MSG)) continue;
      }
      throw e;
    }
  }
};

module.exports = { sequelize, select, one, insert, run, tx };
