// Control de acceso por rol (RBAC). El admin NO tiene permisos clinicos: minimizacion de datos (Ley 1581).
const PERMISOS = {
  estudiante: [
    'perfil:leer_propio', 'sesion:crear_propia', 'squad:gestionar_propio', 'reto:unirse', 'ranking:ver',
    'clinico:leer_propio', 'clinico:escribir_propio', 'ia:usar', 'contenido:ver', 'soporte:usar'
  ],
  admin: [
    'usuario:gestionar', 'reto:crear', 'contenido:gestionar', 'ranking:ver', 'auditoria:ver', 'metricas:ver', 'soporte:atender', 'pagos:gestionar'
  ]
};
const { E } = require('./errors');

const can = (rol, permiso) => (PERMISOS[rol] || []).includes(permiso);
function require_(actor, permiso) {
  if (!actor || !can(actor.rol, permiso)) throw E.forbidden(`Se requiere el permiso ${permiso}`);
}
module.exports = { PERMISOS, can, requirePermiso: require_ };
