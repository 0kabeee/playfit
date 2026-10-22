// Bitacora de acceso a datos sensibles.
const { insert } = require('./db');
const registrar = (actor, accion, recurso, recursoId, { ip = null, t } = {}) =>
  insert(
    'INSERT INTO auditoria_accesos (usuario_id,accion,recurso,recurso_id,ip) VALUES (:u,:a,:r,:rid,:ip)',
    { u: actor ? actor.id : null, a: accion, r: recurso, rid: recursoId || null, ip }, t
  );
module.exports = { registrar };
