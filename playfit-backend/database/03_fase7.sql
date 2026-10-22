-- PlayFit · Fase 7 · Registro de intentos de inicio de sesion (bloqueo temporal por cuenta).
-- Es idempotente (IF NOT EXISTS): el auth-service lo aplica solo al arrancar, asi que NO hace falta recrear tu base.
CREATE TABLE IF NOT EXISTS intentos_login (
  id         BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  email      VARCHAR(150) NOT NULL,
  ip         VARCHAR(45)  NULL,
  creado_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_il_email (email, creado_at)
) ENGINE=InnoDB;
