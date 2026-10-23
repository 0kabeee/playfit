-- PlayFit · Fase 11 · 2FA (TOTP), recuperacion de contrasena y consentimiento con evidencia.
-- Es IDEMPOTENTE: se aplica sola al arrancar el auth-service (y en db-init / db:reset), no hace falta recrear tu base.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS totp_secreto_cifrado VARCHAR(255) NULL;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS totp_pendiente_cifrado VARCHAR(255) NULL;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS totp_activo TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS totp_ultimo_paso BIGINT NULL;
CREATE TABLE IF NOT EXISTS codigos_respaldo_2fa (
  id          INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  usuario_id  INT UNSIGNED NOT NULL,
  codigo_hash CHAR(64) NOT NULL,
  usado_at    DATETIME NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_cr_usuario (usuario_id),
  CONSTRAINT fk_cr_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS codigos_verificacion (
  id          INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  usuario_id  INT UNSIGNED NOT NULL,
  proposito   VARCHAR(20) NOT NULL DEFAULT 'recuperacion',
  codigo_hash CHAR(64) NOT NULL,
  intentos    TINYINT UNSIGNED NOT NULL DEFAULT 0,
  expira_at   DATETIME NOT NULL,
  usado_at    DATETIME NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_cv_usuario (usuario_id, proposito, created_at),
  CONSTRAINT fk_cv_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB;
ALTER TABLE consentimientos MODIFY tipo ENUM('tratamiento_datos','datos_salud','uso_camara','ia_chatbot','mayoria_edad') NOT NULL;
ALTER TABLE consentimientos ADD COLUMN IF NOT EXISTS texto_hash CHAR(64) NULL;
ALTER TABLE consentimientos ADD COLUMN IF NOT EXISTS ip VARCHAR(45) NULL;
-- Nota: el rol 'docente' ya no existe en el codigo. Si una base antigua aun tiene cuentas de docente, no pueden iniciar sesion
-- (el auth-service solo acepta los roles estudiante y admin).
