# PlayFit · Backend (Fase 7: seguridad reforzada sobre API REST + Gateway)

Monorepo (`npm workspaces`): `shared/`, `gateway/` y 4 servicios en `services/` (auth, clinical, social, content).
El celular/emulador habla SOLO con el gateway (puerto 3000); los servicios escuchan solo en 127.0.0.1.

## Primera vez
```
npm install
npm run setup -- --db-port=3307     (usa el puerto donde escucha TU MariaDB; crea .env con secretos aleatorios)
npm test                            (88 pruebas; usan la BD playfit_test)
```
> Guarda una copia de tu `.env`: la `CLINICAL_KEY` cifra los historiales clinicos; si se pierde, esos datos no se recuperan.

## Levantar todo
```
npm run dev        (gateway + 4 servicios; Ctrl+C los detiene)
npm run smoke      (en OTRA terminal: prueba de humo contra el sistema en marcha)
```
Datos de ejemplo (base playfit_dev): `ana@playfit.test`, `luis@playfit.test`, `docente@playfit.test`, `admin@playfit.test`...
contrasena de todos: `PlayFit123!`. Para volver a dejar playfit_dev como al inicio: `npm run db:reset` (hazlo una vez tras actualizar: cambian los nombres de poses de la mascota en los datos de ejemplo).

## Desde la app
- Emulador Android: `http://10.0.2.2:3000`   · Celular real (misma WiFi): `http://<IP de tu PC>:3000` (Windows pedira permitir el puerto en el firewall).

## Endpoints (todos bajo /api; excepto register/login/refresh/logout requieren `Authorization: Bearer <accessToken>`)
**auth** `/api/auth`: POST register · login · refresh · logout · password · GET me · GET consents · PUT consents/:tipo · (admin) GET/POST users · PATCH users/:id · DELETE me (eliminar cuenta, pide contraseña)
**clinical** `/api/clinical`: GET|PUT students/:id/history · GET|PUT students/:id/flags · GET|POST students/:id/measurements · GET me/exercises   (`:id` puede ser `me`)
**social** `/api/social`: GET notifications · POST notifications/read · GET badges · GET records?student= · GET challenges/:id · GET dashboard · POST|GET sessions · GET|POST challenges · POST challenges/:id/join · POST squads · POST squads/join · POST squads/leave · GET squads/me · GET squads/compare?with=&exercise= · GET squads/:id · GET rankings/xp · GET rankings/exercises/:id
**content** `/api/content`: GET exercises · exercises/:id · exercises/:id/tip · nutrition · mascot?context= · POST ai/chat · GET ai/conversations · ai/conversations/:id

## Errores
Siempre JSON: `{ "error": { "code": "PASSWORD_DEBIL", "message": "..." } }`. Codigos: 400 datos invalidos, 401 sin sesion/token, 403 sin permiso,
404 no existe, 409 conflicto, 413 cuerpo muy grande, 429 limite de intentos, 502/503/504 servicio caido/lento o IA no configurada.

## Reglas clave
- Texto clinico cifrado (AES-256-GCM); solo el estudiante y su docente lo leen; el admin no. Toda lectura queda auditada con la IP.
- A la IA solo llegan codigos de flags (nunca texto clinico, nombres ni correos). Cuota diaria por estudiante. Sin `GEMINI_API_KEY` el chat responde 503.
- Gateway: limite global (300/min por IP) y de intentos de login/registro/refresh (10 por 15 min por IP; en login solo cuentan los intentos FALLIDOS).

## Activar el chat de IA (Gemini, gratis)
1. Entra a https://aistudio.google.com/apikey con una cuenta de Google y crea una clave (no pide tarjeta).
2. Abre el `.env` del backend y pon `GEMINI_API_KEY=` seguido de tu clave (sin comillas ni espacios).
3. **Revisa `GEMINI_MODEL`:** los modelos `gemini-2.5-*` se retiran el **16 de octubre de 2026**. Debe decir `gemini-3.1-flash-lite` (si tu `.env` ya traia `gemini-2.5-flash`, cámbialo a mano: el `.env` existente no se reescribe solo).
4. Reinicia `npm run dev` y prueba el chat en la app.
- Si Google retira otro modelo, el chat responde "El modelo de IA configurado ya no está disponible" y la consola del backend dice qué cambiar. Para ver los modelos que tu clave puede usar: abre en el navegador `https://generativelanguage.googleapis.com/v1beta/models?key=TU_CLAVE` y elige uno cuyo nombre tenga `flash` (ej. `models/gemini-3.1-flash-lite` -> `GEMINI_MODEL=gemini-3.1-flash-lite`).
- El plan gratis tiene límites bajos por minuto y por día; el backend ya limita a 20 mensajes diarios por estudiante (`IA_LIMITE_DIARIO`).

## Videos de técnica
Cada ejercicio puede tener un video de YouTube que la app abre con el botón «Ver video de la técnica». Para asignarlos (sin tocar la base a mano):
```
npm run video                                               (lista los ejercicios y su video)
npm run video -- sentadilla https://youtu.be/XXXXXXXXXXX    (acepta enlace completo o el ID de 11 caracteres)
npm run video -- sentadilla quitar
```
Elige videos de canales confiables (de preferencia el que recomiende tu docente); el sistema solo guarda el ID.

## Seguridad (Fase 7)
- **Bloqueo temporal por cuenta:** 5 intentos de login fallidos con el mismo correo en 15 min -> `429 CUENTA_BLOQUEADA_TEMPORAL`, aunque la contrasena sea la correcta. Se guarda en la tabla `intentos_login` (sobrevive a reinicios y a cambios de IP) y aplica igual a correos que no existen (no revela que cuentas hay). Un login correcto borra los fallos. La tabla se crea sola al arrancar el auth-service; no hace falta `db:reset`.
- **Cuenta desactivada o eliminada = acceso cortado al instante:** todos los servicios consultan la BD al validar el token (antes el access token seguia sirviendo hasta 15 min). El rol que cuenta es el de la BD.
- **Base de datos caida = `503 BASE_DE_DATOS_NO_DISPONIBLE`** con mensaje claro (antes salia "error interno"; el detalle tecnico sigue en la consola del servidor).
- Contrasena: el maximo de 72 se mide en bytes (limite real de bcrypt), no en caracteres.
- Ya estaban desde la Fase 5: refresh tokens con rotacion y deteccion de reutilizacion, hashes SHA-256 en BD, bcrypt, JWT HS256 con 15 min de vida, cifrado AES-256-GCM del historial clinico, auditoria de lecturas.
