-- PlayFit · Fase 14 · PlayFit Premium y pagos con Wompi (SANDBOX: no se mueve plata real).
-- Es IDEMPOTENTE: se aplica sola al arrancar el auth-service (y en db-init / db:reset), no hace falta recrear tu base.
--
-- Flujo: el usuario pide el Premium -> el chat lo pasa a un humano (Fase 12) -> el admin envia un ENLACE DE PAGO de Wompi
-- desde la conversacion -> el usuario paga en el checkout de Wompi (PlayFit nunca ve datos de tarjeta) -> Wompi avisa
-- por un webhook FIRMADO -> el backend verifica la firma y activa el Premium 30 dias.

-- Hasta cuando es Premium cada usuario (UTC). NULL o una fecha pasada = plan gratis.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS premium_hasta DATETIME NULL;

-- Cada enlace de pago que se crea en Wompi y lo que paso con el.
CREATE TABLE IF NOT EXISTS pagos (
  id               INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  usuario_id       INT UNSIGNED NOT NULL,
  proveedor        ENUM('wompi') NOT NULL DEFAULT 'wompi',
  ambiente         ENUM('sandbox','production') NOT NULL DEFAULT 'sandbox',
  concepto         VARCHAR(60)  NOT NULL DEFAULT 'premium_mensual',
  dias             SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  monto_centavos   INT UNSIGNED NOT NULL,
  moneda           CHAR(3) NOT NULL DEFAULT 'COP',
  link_id          VARCHAR(40)  NULL,          -- id del enlace de pago en Wompi
  checkout_url     VARCHAR(255) NULL,
  estado           ENUM('pendiente','aprobado','rechazado','anulado','error') NOT NULL DEFAULT 'pendiente',
  transaccion_id   VARCHAR(60)  NULL,          -- id de la transaccion en Wompi (cuando el usuario paga)
  metodo           VARCHAR(30)  NULL,          -- CARD, NEQUI, PSE... (lo informa Wompi)
  nota             VARCHAR(255) NULL,
  conversacion_id  INT UNSIGNED NULL,          -- conversacion de Soporte desde la que se envio
  creado_por       INT UNSIGNED NULL,          -- admin que lo envio
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira_at        DATETIME NULL,
  actualizado_at   DATETIME NULL,
  pagado_at        DATETIME NULL,
  UNIQUE KEY uq_pago_link (link_id),
  UNIQUE KEY uq_pago_tx (transaccion_id),
  INDEX idx_pago_usuario (usuario_id, estado),
  CONSTRAINT fk_pago_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_pago_admin   FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Historial de cambios del Premium (pago, cortesia del admin, revocado): sirve de auditoria.
CREATE TABLE IF NOT EXISTS premium_movimientos (
  id           INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  usuario_id   INT UNSIGNED NOT NULL,
  motivo       ENUM('pago','cortesia','revocado') NOT NULL,
  dias         SMALLINT NOT NULL DEFAULT 0,
  hasta        DATETIME NULL,
  pago_id      INT UNSIGNED NULL,
  admin_id     INT UNSIGNED NULL,
  nota         VARCHAR(255) NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pm_usuario (usuario_id, id),
  CONSTRAINT fk_pm_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_pm_admin   FOREIGN KEY (admin_id) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Eventos recibidos de Wompi: el checksum es unico, asi un evento repetido (reintentos) no se aplica dos veces.
CREATE TABLE IF NOT EXISTS wompi_eventos (
  id             INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  checksum       CHAR(64) NOT NULL,
  evento         VARCHAR(40) NOT NULL,
  transaccion_id VARCHAR(60) NULL,
  estado         VARCHAR(20) NULL,
  resultado      VARCHAR(30) NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_wev_checksum (checksum)
) ENGINE=InnoDB;

-- Mensajes de Soporte que llevan un enlace de pago (el chat muestra una tarjeta con el boton "Pagar").
ALTER TABLE soporte_mensajes ADD COLUMN IF NOT EXISTS pago_id INT UNSIGNED NULL;
