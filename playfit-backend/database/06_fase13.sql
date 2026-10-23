-- PlayFit · Fase 13 · Agente de IA con funciones y memoria, notificaciones push (FCM) y automatizaciones con n8n.
-- Es IDEMPOTENTE: se aplica sola al arrancar el auth-service (y en db-init / db:reset), no hace falta recrear tu base.

-- Celulares registrados para recibir notificaciones push (Firebase Cloud Messaging).
-- El token lo entrega Firebase a la app; si otro usuario inicia sesion en el mismo celular, el token cambia de dueno.
CREATE TABLE IF NOT EXISTS dispositivos_push (
  id             INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  usuario_id     INT UNSIGNED NOT NULL,
  token          VARCHAR(512) NOT NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ultimo_uso_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_disp_token (token),
  INDEX idx_disp_usuario (usuario_id),
  CONSTRAINT fk_disp_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Bandeja de salida de las notificaciones: cada notificacion nueva queda "pendiente" y el social-service
-- la envia por FCM despues de que la transaccion que la creo se confirma (nunca se envia algo que se deshizo).
ALTER TABLE notificaciones ADD COLUMN IF NOT EXISTS push_estado ENUM('pendiente','enviando','enviada','sin_dispositivo','error','omitida') NOT NULL DEFAULT 'pendiente';
ALTER TABLE notificaciones ADD COLUMN IF NOT EXISTS push_lote CHAR(36) NULL;
ALTER TABLE notificaciones ADD INDEX IF NOT EXISTS idx_not_push (push_estado, id);

-- Memoria del agente: SOLO preferencias estructuradas que el propio usuario le conto (objetivo, nivel, horario...).
-- Nunca texto libre ni datos clinicos: las restricciones de salud siguen llegando solo como codigos de flags.
CREATE TABLE IF NOT EXISTS ia_memoria (
  estudiante_id  INT UNSIGNED NOT NULL,
  clave          VARCHAR(30)  NOT NULL,
  valor          VARCHAR(60)  NOT NULL,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (estudiante_id, clave),
  CONSTRAINT fk_iam_est FOREIGN KEY (estudiante_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Acciones que el agente PROPONE (registrar una sesion, crear un reto de squad). No se ejecutan hasta que el
-- usuario toca "Confirmar" en la app; la app las ejecuta con los endpoints normales (mismas validaciones).
CREATE TABLE IF NOT EXISTS ia_acciones (
  id               INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  conversacion_id  INT UNSIGNED NOT NULL,
  estudiante_id    INT UNSIGNED NOT NULL,
  tipo             ENUM('registrar_sesion','crear_reto_squad') NOT NULL,
  datos            JSON NOT NULL,
  resumen          VARCHAR(255) NOT NULL,
  estado           ENUM('propuesta','confirmada','cancelada') NOT NULL DEFAULT 'propuesta',
  resultado_id     INT UNSIGNED NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resuelta_at      DATETIME NULL,
  INDEX idx_iaa_conv (conversacion_id),
  INDEX idx_iaa_est (estudiante_id, estado),
  CONSTRAINT fk_iaa_conv FOREIGN KEY (conversacion_id) REFERENCES conversaciones_ia(id) ON DELETE CASCADE,
  CONSTRAINT fk_iaa_est  FOREIGN KEY (estudiante_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- El mensaje del modelo que propuso la accion (para volver a mostrar la tarjeta al abrir el historial)
ALTER TABLE mensajes_ia ADD COLUMN IF NOT EXISTS accion_id INT UNSIGNED NULL;
