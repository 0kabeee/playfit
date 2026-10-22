-- =====================================================================
-- PlayFit · Fase 3 · Esquema de base de datos (MariaDB 10.11)
-- Base: playfit_dev · Motor: InnoDB · Charset: utf8mb4
-- Tablas agrupadas por servicio (prefijo en comentarios):
--   [AUTH] [CLINICO] [SOCIAL] [CONTENIDO/IA]
-- =====================================================================
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS intentos_login;
DROP VIEW  IF EXISTS v_reps_semanales;
DROP VIEW  IF EXISTS v_ranking_ejercicio;
DROP VIEW  IF EXISTS v_ranking_xp;

DROP TABLE IF EXISTS ia_uso_diario, mensajes_ia, conversaciones_ia,
  contenido_nutricion, mascota_mensajes, tips_tecnica,
  notificaciones, actividad_feed, estudiante_insignias, insignias,
  xp_movimientos, reto_participaciones, retos, perfil_gamificacion,
  series_ejercicio, sesiones_entrenamiento, squad_miembros, squads,
  ejercicio_contraindicaciones, ejercicios,
  mediciones_corporales, estudiante_flags, flags_clinicos, historiales_clinicos,
  auditoria_accesos, curso_estudiantes, cursos, consentimientos,
  refresh_tokens, usuarios, roles;

SET FOREIGN_KEY_CHECKS = 1;

-- =====================================================================
-- [AUTH] auth-service
-- =====================================================================
CREATE TABLE roles (
  id      TINYINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  nombre  ENUM('estudiante','docente','admin') NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE usuarios (
  id                  INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  rol_id              TINYINT UNSIGNED NOT NULL,
  nombre              VARCHAR(80)  NOT NULL,
  apellido            VARCHAR(80)  NOT NULL,
  email               VARCHAR(150) NOT NULL UNIQUE,
  password_hash       VARCHAR(100) NOT NULL,            -- bcrypt
  codigo_estudiantil  VARCHAR(20)  NULL UNIQUE,
  avatar_color        VARCHAR(7)   NOT NULL DEFAULT '#4F46E5',
  activo              TINYINT(1)   NOT NULL DEFAULT 1,
  ultimo_login        DATETIME     NULL,
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_usuarios_rol FOREIGN KEY (rol_id) REFERENCES roles(id)
) ENGINE=InnoDB;

CREATE TABLE refresh_tokens (
  id          INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  usuario_id  INT UNSIGNED NOT NULL,
  token_hash  CHAR(64)     NOT NULL UNIQUE,             -- SHA-256 del token
  expira_at   DATETIME     NOT NULL,
  revocado_at DATETIME     NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_rt_usuario (usuario_id),
  CONSTRAINT fk_rt_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Consentimiento informado (Ley 1581 de 2012 / Decreto 1377)
CREATE TABLE consentimientos (
  id              INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  usuario_id      INT UNSIGNED NOT NULL,
  tipo            ENUM('tratamiento_datos','datos_salud','uso_camara','ia_chatbot') NOT NULL,
  aceptado        TINYINT(1)   NOT NULL,
  version_politica VARCHAR(10) NOT NULL DEFAULT '1.0',
  fecha           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_cons_usuario_tipo (usuario_id, tipo),
  CONSTRAINT fk_cons_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE cursos (
  id          INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  nombre      VARCHAR(120) NOT NULL,
  periodo     VARCHAR(10)  NOT NULL,                    -- ej. 2026-2
  docente_id  INT UNSIGNED NOT NULL,
  activo      TINYINT(1)   NOT NULL DEFAULT 1,
  CONSTRAINT fk_cursos_docente FOREIGN KEY (docente_id) REFERENCES usuarios(id)
) ENGINE=InnoDB;

CREATE TABLE curso_estudiantes (
  curso_id       INT UNSIGNED NOT NULL,
  estudiante_id  INT UNSIGNED NOT NULL,
  inscrito_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (curso_id, estudiante_id),
  CONSTRAINT fk_ce_curso FOREIGN KEY (curso_id) REFERENCES cursos(id) ON DELETE CASCADE,
  CONSTRAINT fk_ce_est   FOREIGN KEY (estudiante_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Bitácora de accesos a datos sensibles (historial clínico)
CREATE TABLE auditoria_accesos (
  id          BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  usuario_id  INT UNSIGNED NULL,
  accion      ENUM('leer','crear','actualizar','eliminar') NOT NULL,
  recurso     VARCHAR(40)  NOT NULL,                    -- ej. historial_clinico
  recurso_id  INT UNSIGNED NULL,
  ip          VARCHAR(45)  NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_aud_recurso (recurso, recurso_id),
  INDEX idx_aud_usuario (usuario_id, created_at),
  CONSTRAINT fk_aud_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- =====================================================================
-- [CLINICO] clinical-service
-- Texto clínico crudo SOLO vive aquí (cifrado en la app). Al resto del
-- sistema y a la IA solo llegan los flags derivados.
-- =====================================================================
CREATE TABLE historiales_clinicos (
  id                    INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  estudiante_id         INT UNSIGNED NOT NULL UNIQUE,
  fecha_nacimiento      DATE NULL,
  condiciones_cifrado   TEXT NULL,   -- AES-256-GCM aplicado en la app
  lesiones_cifrado      TEXT NULL,
  medicamentos_cifrado  TEXT NULL,
  actualizado_por       INT UNSIGNED NULL,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_hc_est  FOREIGN KEY (estudiante_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_hc_upd  FOREIGN KEY (actualizado_por) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE flags_clinicos (
  codigo       VARCHAR(40) PRIMARY KEY,
  descripcion  VARCHAR(160) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE estudiante_flags (
  estudiante_id  INT UNSIGNED NOT NULL,
  flag_codigo    VARCHAR(40)  NOT NULL,
  origen         ENUM('estudiante','docente','sistema') NOT NULL DEFAULT 'sistema',
  derivado_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (estudiante_id, flag_codigo),
  CONSTRAINT fk_ef_est  FOREIGN KEY (estudiante_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_ef_flag FOREIGN KEY (flag_codigo) REFERENCES flags_clinicos(codigo)
) ENGINE=InnoDB;

CREATE TABLE mediciones_corporales (
  id             INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  estudiante_id  INT UNSIGNED NOT NULL,
  fecha          DATE NOT NULL,
  peso_kg        DECIMAL(5,2) NOT NULL,
  estatura_cm    DECIMAL(5,1) NOT NULL,
  imc            DECIMAL(4,1) GENERATED ALWAYS AS
                   (ROUND(peso_kg / POW(estatura_cm / 100, 2), 1)) STORED,
  INDEX idx_med_est_fecha (estudiante_id, fecha),
  CONSTRAINT fk_med_est FOREIGN KEY (estudiante_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- =====================================================================
-- [SOCIAL] social-service (ejercicios, entrenos, squads, retos, XP)
-- =====================================================================
CREATE TABLE ejercicios (
  id              INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  slug            VARCHAR(40)  NOT NULL UNIQUE,
  nombre          VARCHAR(80)  NOT NULL,
  grupo_muscular  ENUM('piernas','pecho','espalda','hombros','brazos','core','cardio') NOT NULL,
  nivel           ENUM('basico','intermedio','avanzado') NOT NULL DEFAULT 'basico',
  descripcion     VARCHAR(255) NOT NULL,
  pasos_tecnica   TEXT NULL,
  youtube_id      VARCHAR(20) NULL,
  mide_reps       TINYINT(1) NOT NULL DEFAULT 1,       -- 0 = se mide por tiempo (plancha)
  soporta_camara  TINYINT(1) NOT NULL DEFAULT 0,       -- conteo con ML Kit / MediaPipe
  activo          TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB;

CREATE TABLE ejercicio_contraindicaciones (
  ejercicio_id  INT UNSIGNED NOT NULL,
  flag_codigo   VARCHAR(40)  NOT NULL,
  PRIMARY KEY (ejercicio_id, flag_codigo),
  CONSTRAINT fk_ec_ej   FOREIGN KEY (ejercicio_id) REFERENCES ejercicios(id) ON DELETE CASCADE,
  CONSTRAINT fk_ec_flag FOREIGN KEY (flag_codigo) REFERENCES flags_clinicos(codigo)
) ENGINE=InnoDB;

CREATE TABLE squads (
  id                 INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  nombre             VARCHAR(60) NOT NULL,
  descripcion        VARCHAR(200) NULL,
  codigo_invitacion  CHAR(8) NOT NULL UNIQUE,
  lider_id           INT UNSIGNED NOT NULL,
  curso_id           INT UNSIGNED NULL,
  max_miembros       TINYINT UNSIGNED NOT NULL DEFAULT 6,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sq_lider FOREIGN KEY (lider_id) REFERENCES usuarios(id),
  CONSTRAINT fk_sq_curso FOREIGN KEY (curso_id) REFERENCES cursos(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE squad_miembros (
  squad_id       INT UNSIGNED NOT NULL,
  estudiante_id  INT UNSIGNED NOT NULL,
  rol            ENUM('lider','miembro') NOT NULL DEFAULT 'miembro',
  unido_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (squad_id, estudiante_id),
  UNIQUE KEY uq_un_squad_por_estudiante (estudiante_id),   -- un estudiante, un squad
  CONSTRAINT fk_sm_squad FOREIGN KEY (squad_id) REFERENCES squads(id) ON DELETE CASCADE,
  CONSTRAINT fk_sm_est   FOREIGN KEY (estudiante_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE sesiones_entrenamiento (
  id             INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  estudiante_id  INT UNSIGNED NOT NULL,
  fecha          DATE NOT NULL,
  inicio_at      DATETIME NOT NULL,
  fin_at         DATETIME NULL,
  notas          VARCHAR(255) NULL,
  INDEX idx_ses_est_fecha (estudiante_id, fecha),
  CONSTRAINT fk_ses_est FOREIGN KEY (estudiante_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE series_ejercicio (
  id            BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  sesion_id     INT UNSIGNED NOT NULL,
  ejercicio_id  INT UNSIGNED NOT NULL,
  orden         TINYINT UNSIGNED NOT NULL DEFAULT 1,
  repeticiones  SMALLINT UNSIGNED NULL,
  peso_kg       DECIMAL(5,1) NULL,
  duracion_seg  SMALLINT UNSIGNED NULL,
  fuente_conteo ENUM('manual','camara') NOT NULL DEFAULT 'manual',
  INDEX idx_ser_ej (ejercicio_id),
  CONSTRAINT fk_ser_ses FOREIGN KEY (sesion_id) REFERENCES sesiones_entrenamiento(id) ON DELETE CASCADE,
  CONSTRAINT fk_ser_ej  FOREIGN KEY (ejercicio_id) REFERENCES ejercicios(id)
) ENGINE=InnoDB;

CREATE TABLE perfil_gamificacion (
  estudiante_id    INT UNSIGNED PRIMARY KEY,
  xp_total         INT UNSIGNED NOT NULL DEFAULT 0,
  nivel            SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  racha_actual     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  racha_maxima     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  ultima_actividad DATE NULL,
  CONSTRAINT fk_pg_est FOREIGN KEY (estudiante_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE retos (
  id            INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  titulo        VARCHAR(100) NOT NULL,
  descripcion   VARCHAR(255) NOT NULL,
  tipo          ENUM('individual','squad','curso') NOT NULL,
  metrica       ENUM('reps','sesiones','dias_activos') NOT NULL,
  ejercicio_id  INT UNSIGNED NULL,                      -- solo si metrica = reps
  meta          INT UNSIGNED NOT NULL,
  xp_recompensa SMALLINT UNSIGNED NOT NULL DEFAULT 100,
  fecha_inicio  DATE NOT NULL,
  fecha_fin     DATE NOT NULL,
  creado_por    INT UNSIGNED NOT NULL,
  activo        TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT fk_ret_ej  FOREIGN KEY (ejercicio_id) REFERENCES ejercicios(id) ON DELETE SET NULL,
  CONSTRAINT fk_ret_cre FOREIGN KEY (creado_por) REFERENCES usuarios(id),
  CONSTRAINT ck_ret_fechas CHECK (fecha_fin >= fecha_inicio)
) ENGINE=InnoDB;

CREATE TABLE reto_participaciones (
  id             INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  reto_id        INT UNSIGNED NOT NULL,
  estudiante_id  INT UNSIGNED NOT NULL,
  squad_id       INT UNSIGNED NULL,
  progreso       INT UNSIGNED NOT NULL DEFAULT 0,
  completado_at  DATETIME NULL,
  UNIQUE KEY uq_reto_est (reto_id, estudiante_id),
  CONSTRAINT fk_rp_reto  FOREIGN KEY (reto_id) REFERENCES retos(id) ON DELETE CASCADE,
  CONSTRAINT fk_rp_est   FOREIGN KEY (estudiante_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_rp_squad FOREIGN KEY (squad_id) REFERENCES squads(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE xp_movimientos (
  id              BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  estudiante_id   INT UNSIGNED NOT NULL,
  puntos          INT NOT NULL,
  motivo          ENUM('sesion','record','reto_completado','racha','insignia','bonus') NOT NULL,
  referencia_tipo VARCHAR(30) NULL,
  referencia_id   INT UNSIGNED NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_xp_est (estudiante_id, created_at),
  CONSTRAINT fk_xp_est FOREIGN KEY (estudiante_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE insignias (
  id           INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  codigo       VARCHAR(30) NOT NULL UNIQUE,
  nombre       VARCHAR(60) NOT NULL,
  descripcion  VARCHAR(160) NOT NULL,
  icono        VARCHAR(30) NOT NULL DEFAULT 'medal'
) ENGINE=InnoDB;

CREATE TABLE estudiante_insignias (
  estudiante_id  INT UNSIGNED NOT NULL,
  insignia_id    INT UNSIGNED NOT NULL,
  obtenida_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (estudiante_id, insignia_id),
  CONSTRAINT fk_ei_est FOREIGN KEY (estudiante_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_ei_ins FOREIGN KEY (insignia_id) REFERENCES insignias(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE actividad_feed (
  id             BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  squad_id       INT UNSIGNED NOT NULL,
  estudiante_id  INT UNSIGNED NOT NULL,
  tipo           ENUM('sesion','record','reto_completado','racha','insignia','union') NOT NULL,
  detalle        JSON NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_feed_squad (squad_id, created_at),
  CONSTRAINT fk_feed_squad FOREIGN KEY (squad_id) REFERENCES squads(id) ON DELETE CASCADE,
  CONSTRAINT fk_feed_est   FOREIGN KEY (estudiante_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE notificaciones (
  id          BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  usuario_id  INT UNSIGNED NOT NULL,
  tipo        VARCHAR(30)  NOT NULL,
  titulo      VARCHAR(100) NOT NULL,
  cuerpo      VARCHAR(255) NULL,
  leida       TINYINT(1)   NOT NULL DEFAULT 0,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_not_usuario (usuario_id, leida, created_at),
  CONSTRAINT fk_not_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- =====================================================================
-- [CONTENIDO/IA] content-service
-- =====================================================================
CREATE TABLE tips_tecnica (
  id            INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  ejercicio_id  INT UNSIGNED NOT NULL,
  tipo          ENUM('error_comun','consejo','respiracion') NOT NULL,
  texto         VARCHAR(255) NOT NULL,
  CONSTRAINT fk_tip_ej FOREIGN KEY (ejercicio_id) REFERENCES ejercicios(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- La mascota reacciona a datos reales (racha, ranking, reto, comparación)
CREATE TABLE mascota_mensajes (
  id            INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  contexto      ENUM('bienvenida','racha','ranking','reto','comparacion','descanso','post_serie') NOT NULL,
  condicion     VARCHAR(40) NULL,                       -- ej. 'racha>=7', 'puesto=1'
  pose          VARCHAR(30) NOT NULL,                   -- debe coincidir con las poses del mockup
  mensaje       VARCHAR(255) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE contenido_nutricion (
  id         INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  categoria  ENUM('hidratacion','proteina','pre_entreno','post_entreno','general') NOT NULL,
  titulo     VARCHAR(100) NOT NULL,
  cuerpo     TEXT NOT NULL,
  activo     TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB;

CREATE TABLE conversaciones_ia (
  id             INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  estudiante_id  INT UNSIGNED NOT NULL,
  titulo         VARCHAR(100) NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_conv_est (estudiante_id, created_at),
  CONSTRAINT fk_conv_est FOREIGN KEY (estudiante_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE mensajes_ia (
  id               BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  conversacion_id  INT UNSIGNED NOT NULL,
  rol              ENUM('usuario','modelo') NOT NULL,
  contenido        TEXT NOT NULL,
  flags_aplicados  JSON NULL,                           -- solo códigos de flags, nunca texto clínico
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_msg_conv (conversacion_id, created_at),
  CONSTRAINT fk_msg_conv FOREIGN KEY (conversacion_id) REFERENCES conversaciones_ia(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Control de cuota para respetar el free tier de Gemini
CREATE TABLE ia_uso_diario (
  estudiante_id  INT UNSIGNED NOT NULL,
  fecha          DATE NOT NULL,
  solicitudes    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (estudiante_id, fecha),
  CONSTRAINT fk_iau_est FOREIGN KEY (estudiante_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- =====================================================================
-- Vistas para ranking (las pestañas por ejercicio y la flecha de tendencia)
-- =====================================================================
CREATE VIEW v_ranking_xp AS
SELECT u.id AS estudiante_id, CONCAT(u.nombre,' ',u.apellido) AS estudiante,
       g.xp_total, g.nivel, g.racha_actual,
       RANK() OVER (ORDER BY g.xp_total DESC) AS puesto
FROM perfil_gamificacion g
JOIN usuarios u ON u.id = g.estudiante_id AND u.activo = 1;

CREATE VIEW v_ranking_ejercicio AS
SELECT s.estudiante_id, sr.ejercicio_id,
       SUM(sr.repeticiones)  AS total_reps,
       COUNT(*)              AS total_series,
       MAX(sr.peso_kg)       AS mejor_peso_kg
FROM series_ejercicio sr
JOIN sesiones_entrenamiento s ON s.id = sr.sesion_id
GROUP BY s.estudiante_id, sr.ejercicio_id;

CREATE VIEW v_reps_semanales AS
SELECT s.estudiante_id, sr.ejercicio_id,
  COALESCE(SUM(CASE WHEN YEARWEEK(s.fecha,1) = YEARWEEK(CURDATE(),1)
                    THEN sr.repeticiones END),0) AS reps_semana_actual,
  COALESCE(SUM(CASE WHEN YEARWEEK(s.fecha,1) = YEARWEEK(DATE_SUB(CURDATE(), INTERVAL 7 DAY),1)
                    THEN sr.repeticiones END),0) AS reps_semana_anterior
FROM series_ejercicio sr
JOIN sesiones_entrenamiento s ON s.id = sr.sesion_id
GROUP BY s.estudiante_id, sr.ejercicio_id;
