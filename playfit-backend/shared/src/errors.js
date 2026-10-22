// Errores de negocio con codigo HTTP; la Fase 5 los traduce a respuestas JSON.
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
const E = {
  badRequest: (msg, code = 'DATOS_INVALIDOS', d) => new AppError(400, code, msg, d),
  unauthorized: (msg = 'No autenticado', code = 'NO_AUTENTICADO') => new AppError(401, code, msg),
  forbidden: (msg = 'No tienes permiso para esto', code = 'PROHIBIDO') => new AppError(403, code, msg),
  notFound: (msg = 'No encontrado', code = 'NO_ENCONTRADO') => new AppError(404, code, msg),
  conflict: (msg, code = 'CONFLICTO') => new AppError(409, code, msg),
  tooMany: (msg, code = 'LIMITE_EXCEDIDO') => new AppError(429, code, msg)
};
module.exports = { AppError, E };
