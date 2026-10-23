-- PlayFit · Fase 12 · Retos creados dentro del squad, duelos 1 vs 1 y chat de soporte usuario <-> admin.
-- Es IDEMPOTENTE: se aplica sola al arrancar el auth-service (y en db-init / db:reset), no hace falta recrear tu base.

-- Retos de squad: squad_id = NULL es un reto oficial (del admin) visible para todos;
-- con squad_id solo lo ven y se unen los miembros de ese squad. Nueva metrica: peso maximo levantado.
ALTER TABLE retos ADD COLUMN IF NOT EXISTS squad_id INT UNSIGNED NULL AFTER tipo;
ALTER TABLE retos ADD INDEX IF NOT EXISTS idx_ret_squad (squad_id, activo, fecha_fin);
ALTER TABLE retos MODIFY metrica ENUM('reps','sesiones','dias_activos','peso_maximo') NOT NULL;

ALTER TABLE xp_movimientos MODIFY motivo ENUM('sesion','record','reto_completado','racha','insignia','bonus','duelo') NOT NULL;
ALTER TABLE actividad_feed MODIFY tipo ENUM('sesion','record','reto_completado','racha','insignia','union','reto_creado','duelo') NOT NULL;

-- Duelos 1 vs 1 entre miembros del mismo squad. El progreso se calcula siempre desde las sesiones reales.
CREATE TABLE IF NOT EXISTS duelos (
  id               INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  squad_id         INT UNSIGNED NULL,
  retador_id       INT UNSIGNED NOT NULL,
  retado_id        INT UNSIGNED NOT NULL,
  metrica          ENUM('reps','sesiones','peso_maximo') NOT NULL,
  ejercicio_id     INT UNSIGNED NULL,
  dias             TINYINT UNSIGNED NOT NULL,
  estado           ENUM('pendiente','activo','rechazado','cancelado','expirado','finalizado') NOT NULL DEFAULT 'pendiente',
  fecha_inicio     DATE NULL,
  fecha_fin        DATE NULL,
  progreso_retador INT UNSIGNED NULL,
  progreso_retado  INT UNSIGNED NULL,
  ganador_id       INT UNSIGNED NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resuelto_at      DATETIME NULL,
  INDEX idx_duelo_retador (retador_id, estado),
  INDEX idx_duelo_retado (retado_id, estado),
  CONSTRAINT fk_duelo_squad   FOREIGN KEY (squad_id) REFERENCES squads(id) ON DELETE SET NULL,
  CONSTRAINT fk_duelo_retador FOREIGN KEY (retador_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_duelo_retado  FOREIGN KEY (retado_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_duelo_ej      FOREIGN KEY (ejercicio_id) REFERENCES ejercicios(id) ON DELETE SET NULL,
  CONSTRAINT fk_duelo_ganador FOREIGN KEY (ganador_id) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Chat de soporte. estado: bot (responde el asistente automatico), pendiente (transferido, esperando a un admin),
-- atendiendo (un admin ya respondio) y cerrada.
CREATE TABLE IF NOT EXISTS soporte_conversaciones (
  id                 INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  usuario_id         INT UNSIGNED NOT NULL,
  estado             ENUM('bot','pendiente','atendiendo','cerrada') NOT NULL DEFAULT 'bot',
  motivo             ENUM('general','pago') NOT NULL DEFAULT 'general',
  asignado_a         INT UNSIGNED NULL,
  no_leidos_usuario  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  no_leidos_admin    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  transferida_at     DATETIME NULL,
  ultimo_mensaje_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cerrada_at         DATETIME NULL,
  INDEX idx_sop_usuario (usuario_id, estado),
  INDEX idx_sop_estado (estado, ultimo_mensaje_at),
  CONSTRAINT fk_sop_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_sop_admin   FOREIGN KEY (asignado_a) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS soporte_mensajes (
  id               BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  conversacion_id  INT UNSIGNED NOT NULL,
  autor            ENUM('usuario','admin','bot') NOT NULL,
  autor_id         INT UNSIGNED NULL,
  contenido        VARCHAR(1000) NOT NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sopm_conv (conversacion_id, id),
  CONSTRAINT fk_sopm_conv  FOREIGN KEY (conversacion_id) REFERENCES soporte_conversaciones(id) ON DELETE CASCADE,
  CONSTRAINT fk_sopm_autor FOREIGN KEY (autor_id) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB;
