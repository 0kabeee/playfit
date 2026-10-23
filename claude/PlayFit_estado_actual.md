# PlayFit — Estado actual y guía para retomar (Claude Code o chat nuevo)

> Actualizado el 23-oct-2026, al terminar el **código de la Fase 13** (falta desplegarla en Azure, ver «Pendientes»). **Este documento reemplaza lo desactualizado de `PlayFit_traspaso.md`** (que llega hasta la Fase 9 y todavía habla de rol docente, sin Azure y sin recuperación de contraseña). De ese archivo siguen valiendo las secciones 2 (principios de diseño), 7.2/7.3 (app y conteo con cámara) y 8 (bitácora de problemas resueltos).

## Cómo retomar
1. Pega esto al empezar: «Estoy continuando PlayFit. Lee claude/PlayFit_estado_actual.md y claude/PlayFit_plan_tutor.md. Voy en la Fase 13 terminada; sigue la Fase 14.»
2. El código es la fuente de verdad: repositorio git en `C:\playfit` (rama `main`). Carpetas `playfit-backend`, `playfit_app`, `k8s`. Los dos documentos de estado están en `C:\playfit\claude\`.
3. Claude Code en el PC puede correr `npm test`, `flutter analyze`, `flutter test`, `docker` y `kubectl` directamente. Desde el chat, el usuario los corre y pega la salida.

## Qué es y restricciones
- App móvil de gamificación social para estudiantes de la USB (Acondicionamiento Físico). Proyecto de grado, equipo de 4, **presupuesto $0**.
- El usuario (Okabe/felipe) escribe en español informal con erratas; responder en español, explicar cada comando y qué resultado esperar.

## Decisiones de producto vigentes
- **Solo 2 roles:** usuario (internamente `estudiante`) y `admin`. Sin docente, sin cursos, sin agenda, sin gimnasio asociado, sin membresía.
- **Premium** = personalización con agente de IA (memoria, voz, videos más completos). Flujo de pago: el usuario escribe «pago» → el agente lo transfiere a un humano (chat de Soporte) → el admin envía un link de Wompi → webhook firmado → Premium por 30 días (Fase 14).
- 2FA (TOTP) **obligatorio para admin, opcional para usuarios**. Recuperación de contraseña por correo (Brevo).
- La IA solo recibe códigos de flags derivados, nunca texto clínico. Mensajes con señales de alarma no van al modelo.
- **El agente nunca ejecuta solo:** registrar sesión y crear reto quedan como propuesta hasta que el usuario toca «Confirmar» (Fase 13).
- **La memoria del agente** solo guarda preferencias de listas cerradas (objetivo, nivel, días, horario, minutos, equipo). Nada de texto libre ni salud.
- Anti-abuso: solo las 2 primeras sesiones del día dan XP.
- «Agendar entrenamiento» y «buscar horario con el squad» (sección 5 del plan) **no se implementaron** porque la agenda se eliminó (decisión del 22-oct).

## Stack e infraestructura
- Flutter (solo Android) + backend Node 22 / Express 5 en microservicios: gateway 3000, auth 3001, clinical 3002, social 3003, content 3004. MariaDB. Sequelize con consultas crudas parametrizadas (`shared/src/db.js`: select/one/insert/run/tx).
- Migraciones idempotentes `03_fase7.sql`, `04_fase11.sql`, `05_fase12.sql`, `06_fase13.sql`, listadas en `shared/src/migrate.js` (`ARCHIVOS`); las aplica el auth-service al arrancar (y `db-init` en Kubernetes).
- **n8n 1.123.5** dentro del clúster (`k8s/base/n8n.yaml`), sin IP pública; el editor se abre con `kubectl port-forward -n playfit svc/n8n 5678:5678`. Flujos en `k8s/n8n/flujos/`, guía en `k8s/n8n/README.md`.
- **Push:** Firebase Cloud Messaging (API HTTP v1, sin SDK en el backend). Backend: `FCM_SERVICE_ACCOUNT` (secreto). App: 4 `--dart-define` públicos (`FCM_API_KEY`, `FCM_APP_ID`, `FCM_SENDER_ID`, `FCM_PROJECT_ID`); no usa `google-services.json`.
- **Azure AKS:** cluster `playfit-aks`, resource group `playfit-rg`, namespace `playfit`, dominio `playfit-usb.chilecentral.cloudapp.azure.com`. Imagen `ghcr.io/0kabeee/playfit-backend`. Versión desplegada: **1.2.0** (Fase 12 + Brevo). La Fase 13 va como **1.3.0** (aún no desplegada).
- **Costos:** el cluster se enciende con `az aks start --resource-group playfit-rg --name playfit-aks` y se apaga con `az aks stop ...` cuando no se use. Con el cluster apagado, `kubectl` da «no such host».
- **Despliegue:** `docker login ghcr.io -u 0kabeee` (token clásico con `write:packages`); `docker build -t ghcr.io/0kabeee/playfit-backend:X playfit-backend` desde `C:\playfit`; `docker push`; cambiar `newTag` en `k8s/overlays/azure/kustomization.yaml`; `kubectl apply -k k8s\overlays\azure`; `kubectl rollout status deployment -n playfit`. Log de migración: `kubectl logs -n playfit deploy/auth -c db-init`. Pasos de la 1.3.0: `k8s/README.md` sección 5.
- **Secretos:** `playfit-backend/.env` y `k8s/overlays/*/secrets.env` están en `.gitignore`. Contienen JWT_SECRET, `CLINICAL_KEY` (cifra el historial clínico; si se pierde no se recupera → guardar copia segura), `BREVO_API_KEY`, `MAIL_FROM`, `GEMINI_API_KEY` y, desde la Fase 13, `N8N_TOKEN`, `N8N_ENCRYPTION_KEY` (cifra las credenciales de n8n) y `FCM_SERVICE_ACCOUNT`. `node k8s/generar-secretos.js azure` sobre un archivo existente **solo agrega** las claves que faltan. Nunca pegarlos en el chat ni subirlos a git.
- **Brevo:** cuenta con plan gratis (300 correos/día), remitente verificado `playfit.0123@gmail.com`. Sin dominio propio los correos pueden caer en spam (mencionarlo al tutor: SPF/DKIM resolvería).

## Pruebas locales
- Backend: `npm test` (MariaDB real, base `playfit_test`) → **143 pruebas** tras la Fase 13. Flutter: `flutter analyze` limpio y `flutter test` → **44 pruebas**. `flutter build apk --debug` compila con Firebase y los plugins de voz.
- Usuarios de ejemplo (`npm run db:reset` los recrea), contraseña de todos `PlayFit123!`: `ana`, `luis`, `camila`, `andres` (squad Titanes), `valentina`, `sebastian` (squad Mancuernas), `admin` — todos `@playfit.test`. Solo en local; en Azure únicamente existe el admin.
- El admin en local también debe configurar 2FA la primera vez (QR con Google Authenticator; la clave base32 solo tiene A–Z y 2–7).
- Gotchas: Sequelize falla con `<:p` (usar espacio o parámetros distintos); en regex, `curso_id` también coincide con `recurso_id`; en el seed Luis y Camila ya entrenaron «hoy», así que retos de sesiones con meta baja se completan al unirse.
- Gotchas de la Fase 13: `n8n import:workflow` (CLI) exige `versionId` en el JSON, y un flujo importado así no se puede activar desde la CLI en una instalación sin dueño: se importa y activa desde el editor. `firebase_messaging` 17 marca `getToken` como obsoleto (se mantiene a propósito: el backend usa *registration tokens* con la API v1). `playfit-backend/README.md` y `.env.example` tienen atributo de solo lectura en Windows.

## Estado por fases
| Fase | Contenido | Estado |
|---|---|---|
| 1–9 | Entorno, BD, servicios, API, app, seguridad, series, video, conteo con cámara | ✅ |
| 10 | Contenedores, Kubernetes y despliegue en Azure | ✅ |
| 11 | Rol admin, 2FA, recuperación de contraseña, consentimientos, sin docente | ✅ desplegada |
| 12 | Retos creados por el squad (máx. 3 vigentes), duelos 1 vs 1, chat de Soporte con transferencia a humano, métrica peso máximo | ✅ desplegada (1.2.0) |
| 13 | Agente de IA con funciones y memoria, voz, n8n, FCM | ✅ código y pruebas · ⏳ desplegar 1.3.0, Firebase y activar flujos |
| 14 | Wompi sandbox + Premium (el admin envía el link desde el chat de Soporte) | ⏳ siguiente |
| 15 | Fotos/videos, cronómetro, rutinas | ⏳ |
| 16 | Pruebas de seguridad: SQL injection y caracteres especiales en login, Nmap/ZAP/Kali/MobSF, informe | ⏳ |
| 17 | Normas APA, Turnitin, video de demo, Play Store opcional | ⏳ |

## Fase 13 en detalle (por si hay que tocarla)
- `database/06_fase13.sql`: tablas `dispositivos_push`, `ia_memoria`, `ia_acciones`; columnas `notificaciones.push_estado/push_lote` y `mensajes_ia.accion_id`.
- **Agente** (`content-service/src/agente.js` + `ia.js`): Gemini con *function calling* (máx. 3 rondas; la última sin funciones; se reenvían las partes del modelo tal cual por las *thought signatures* de Gemini 3). Funciones: `consultar_progreso`, `registrar_sesion` y `crear_reto_squad` (solo proponen; una propuesta por mensaje), `guardar_preferencia`, `transferir_a_humano`. El prompt incluye el catálogo con los ejercicios contraindicados marcados «EVITAR», la memoria y el estado de las propuestas recientes. Un mensaje gasta 1 de la cuota diaria aunque llame varias funciones.
- **Rutas nuevas:** `POST /api/content/ai/actions/:id` (`confirmada`/`cancelada`), `GET|DELETE /api/content/ai/memory`, `DELETE /api/content/ai/memory/:clave`, `POST|DELETE /api/social/devices`. API interna para n8n (no pasa por el gateway, cabecera `x-playfit-token`): `GET /internal/rachas-en-riesgo`, `GET /internal/resumen-semanal`, `POST /internal/notificaciones`.
- **Push** (`shared/src/push.js`): bandeja de salida; el social-service envía cada 10 s las notificaciones pendientes **después** del commit, borra tokens inválidos, omite las de más de 24 h y reparte lotes con un id para que dos réplicas no envíen lo mismo.
- **Eventos a n8n** (`shared/src/eventos.js`): `soporte-transferida` (desde el chat de Soporte y desde el agente). Si n8n no responde o rechaza, respaldo: notificación directa a los admins. Preparado `pago-aprobado` para la Fase 14.
- **Privacidad:** retirar el consentimiento del asistente borra su memoria; n8n solo recibe ids y números.
- **App:** `screens/chatbot.dart` (tarjeta Confirmar/Cancelar, chips «Recordaré…», hoja «Lo que recuerda el asistente», micrófono con `speech_to_text`, lectura en voz alta con `flutter_tts` guardada por usuario), `services/push_service.dart` (registra el token al entrar y lo quita al cerrar sesión), `config.dart` (dart-defines de Firebase), `tools/patch_android.js` (permisos RECORD_AUDIO y POST_NOTIFICATIONS + `<queries>` de dictado/voz).
- **Verificado de punta a punta:** n8n 1.123.5 en Docker contra el social-service real: los 3 flujos importan y funcionan, y el webhook rechaza un token equivocado.

## Pendientes recordados
- **Fase 13 en Azure:** `node k8s\generar-secretos.js azure` (agrega N8N_TOKEN, N8N_ENCRYPTION_KEY, FCM_SERVICE_ACCOUNT), crear el proyecto de Firebase y su cuenta de servicio, construir/subir la imagen **1.3.0**, aplicar, importar y activar los 3 flujos de n8n (`k8s/README.md` sección 5 y `k8s/n8n/README.md`).
- **Probar en el celular:** micrófono y voz del asistente, tarjeta de confirmación, push con la app cerrada. Antes: `node tools\patch_android.js`.
- Documentar la Fase 13 en `playfit-backend/README.md` y `.env.example` (están en solo lectura; hay que quitarles ese atributo).
- Cargar los 10 `youtube_id` de técnica: `npm run video -- slug "url"`.
- Ajustes de diseño en la app.
- Vulnerabilidades del login (SQL injection / caracteres especiales) → Fase 16.
- Recrear `playfit_app/README.md`.
- APK firmado de entrega.
- Borrar los archivos auxiliares de `C:\playfit\_to_delete\` cuando ya no hagan falta.
- Apagar el cluster de Azure cuando no se use.
