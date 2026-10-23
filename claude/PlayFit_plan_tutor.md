# PlayFit — Plan para cumplir lo que pide el tutor (Ing. Jairo Salcedo)

> Acordado el 22-oct-2026 a partir del audio del 21-oct. Complementa `PlayFit_traspaso.md` (estado de las Fases 1–9).
> Fuente de los pedidos: `Transcripcion_audio_Jairo_21_octubre.md` y `Pendientes_proyecto_gimnasio_Jairo.md`.
> Última actualización: 23-oct-2026 (Fase 13 con código y pruebas; ver sección 13).

## 1. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Nube | **Azure for Students** (US$100 por 12 meses, sin tarjeta, renovable mientras sean estudiantes; cada integrante puede tener la suya como respaldo). |
| Orquestación | **Docker + Kubernetes (AKS, nivel gratuito del plano de control, 1 nodo pequeño)**. Se desarrolla y prueba en el Kubernetes de Docker Desktop; el clúster de Azure se **prende solo para demos, pruebas de seguridad y sustentación**. Plan B si la suscripción de estudiante bloquea AKS: una VM con k3s. |
| Base de datos | **SQL relacional sí o sí** (exigencia del profe) → **MariaDB en un contenedor dentro del clúster**, con disco persistente y respaldos automáticos. Se descartó Firebase SQL Connect (PostgreSQL): el plan gratis dura 90 días y luego se archiva, obliga a migrar de MariaDB a PostgreSQL y su acceso por SDK propio se salta el gateway, el cifrado y la auditoría. |
| Firebase | Solo para **notificaciones push (FCM)**. |
| HTTPS / dominio | Subdominio gratuito de Azure (`nombre.region.cloudapp.azure.com`) + certificado de Let's Encrypt. Cierra el RNF-02 del doc. |
| Roles | **Solo dos: usuario y admin** (en el código el rol de usuario se sigue llamando `estudiante`). El rol docente y los **cursos desaparecieron** (Fase 11): todo lo que hacía el docente lo maneja el admin (retos oficiales, usuarios, contenido) y los flags clínicos los deriva solo el sistema a partir del historial del propio usuario. |
| Gimnasio | PlayFit **no está asociado a ningún gimnasio**: nada de membresías de gimnasio, turnos ni valoraciones físicas hechas por un entrenador. |
| Automatización | **n8n self-hosted** dentro del clúster (gratis). Make y Retell se descartan por costo. |
| Voz | En el celular: voz → texto y texto → voz (gratis), conectado al agente. |
| Pagos | **Wompi en sandbox** (tarjeta, Nequi, PSE de prueba; no se mueve plata real). |
| Presupuesto | Se mantiene $0. Google Play (US$25 + prueba cerrada de 12 testers × 14 días) queda opcional. |

## 2. El admin y su relación con el usuario

El admin es **el equipo que opera PlayFit** (como el soporte de cualquier app). Nunca ve el texto del historial clínico.

| Función del admin | Relación con el usuario |
|---|---|
| Soporte por chat (Fase 12) | Recibe en su bandeja las conversaciones transferidas a un humano (pagos/Premium o cuando el usuario pide una persona), responde en el mismo chat y la cierra. Las que siguen con el asistente automático no las ve. Desde la Fase 13 recibe una notificación (push) cada vez que llega una transferencia. |
| Suscripciones y pagos | Ve quién tiene Premium, resuelve pagos fallidos, envía enlaces de pago y puede dar Premium de cortesía (p. ej. a los participantes del piloto USB). |
| Moderación | Atiende reportes de squads o retos con nombres ofensivos; puede desactivar cuentas. |
| Contenido | Administra ejercicios (fotos y videos), rutinas por objetivo y **retos oficiales de PlayFit** abiertos a todos. |
| Métricas | Panel con datos agregados y anónimos (usuarios activos, sesiones por semana, retención) → sirve para el objetivo 3 de la evaluación. |
| Auditoría | Consulta el log de accesos (RF-07 / RF-08). |

## 3. Agenda de entrenamientos — ELIMINADA
Se descartó (decisión del equipo, 22-oct-2026): PlayFit no está atado a un gimnasio, así que no hay citas, turnos ni agenda. La relación admin↔usuario es soporte por chat, pagos, moderación, contenido y métricas (sección 2).

## 4. Retos en squads y agente que crea retos

- Cualquier miembro crea retos para su squad (título, métrica, meta, fechas, ejercicio opcional).
- Métricas: reps, sesiones, días activos y **peso máximo** (nueva).
- **Duelos 1 vs 1** dentro del squad (cierra el RF-13).
- Anti-abuso: máximo de retos activos por squad (p. ej. 3), la XP la fija el servidor, duración de 1 a 30 días, progreso calculado desde las sesiones reales.
- Notificación a los miembros al crear un reto.
- El agente tiene la función `crear_reto_squad`: arma el reto, muestra el resumen y **solo lo crea si el usuario confirma**. También puede sugerir retos según la actividad del squad. ✅ Fase 13.
- Cambio de esquema necesario: `retos` necesita `squad_id` (hoy no existe) y la métrica nueva. ✅ Fase 12.

## 5. IA como agente

Gemini con llamadas a funciones (gratis): registrar sesión, ~~agendar entrenamiento~~, ~~buscar horario con el squad~~, crear reto de squad, sugerir/armar rutina, transferir a un humano. Toda acción la confirma el usuario. Se mantiene: solo flags derivados del historial, nunca texto clínico.
n8n: recordatorio de racha en riesgo, resumen semanal del squad, aviso al admin cuando hay una transferencia, notificación de pago aprobado.

> Fase 13: «agendar entrenamiento» y «buscar horario con el squad» quedaron fuera porque la agenda se eliminó (sección 3). «Sugerir/armar rutina» lo hace el agente con el catálogo, los flags (ejercicios marcados EVITAR) y la memoria del usuario. «Notificación de pago aprobado» queda lista como evento (`pago-aprobado`) para la Fase 14.

## 6. Pagos: PlayFit Premium (freemium)

**Qué se paga:** la personalización del agente de IA (no las funciones básicas).

| Gratis | Premium (ej. $9.900 COP/mes, en sandbox) |
|---|---|
| Rachas, XP, squads, retos, ranking, cámara, técnica, videos | **Memoria del agente**: recuerda objetivos, lesiones (solo etiquetas), horarios y progreso |
| **Crear rutinas propias a mano** y rutinas por objetivo del catálogo | **Rutina a medida con ajuste semanal** según las sesiones registradas |
| El agente arma rutinas con límite (p. ej. 2 al mes), respetando contraindicaciones | **Coach proactivo** (avisos de racha, sugerencias de retos) |
| Chat con IA (20 mensajes/día) | **Feedback de técnica con cámara**, **voz**, más mensajes/día y más videos |

> Fase 13: la memoria y la voz ya existen y hoy están disponibles para todos; en la Fase 14 se limitan a Premium. La memoria **no** guarda lesiones: las restricciones de salud siguen llegando al agente solo como flags derivados del historial (no hace falta duplicarlas).

Flujo pedido por el profe:
1. El usuario escribe «quiero pagar el Premium» o «tengo un problema con mi pago».
2. El agente detecta «pago» → *«Un momento, ya te transfiero a un asistente humano»* → la conversación llega a la bandeja del admin.
3. El admin atiende y **envía un enlace de pago** (el backend lo crea con la API de Wompi).
4. El usuario paga en el checkout de Wompi (PlayFit nunca toca datos de tarjeta).
5. Wompi avisa por **webhook firmado** → el backend verifica la firma → Premium activo 30 días → n8n notifica.

También habrá un botón «Hazte Premium» en el perfil.
**Riesgo documentado:** si se publica en Google Play, sus políticas exigen Google Play Billing para suscripciones digitales; en ese caso el Premium tendría que migrar. Para la demo con APK instalado directamente, Wompi sandbox sirve.

## 7. Fases

| Fase | Contenido |
|---|---|
| 10 | Docker, Kubernetes, Azure, HTTPS (MariaDB en el clúster) |
| 11 | ✅ **Código listo (23-oct-2026), pendiente que el equipo corra `npm test` y `flutter test` y pruebe en la app.** Rol admin dentro de la app (Resumen, Usuarios, Retos oficiales, Auditoría); 2FA TOTP (obligatorio para admin, opcional para usuarios, con 8 códigos de respaldo de un solo uso); recuperación de contraseña con código de 6 dígitos por correo (**Brevo**; sin clave el código sale en el log); consentimiento A1–A4 + declaración de mayoría de edad con versión y hash del texto; se quitó el rol docente y los cursos |
| 12 | ✅ **Código listo (23-oct-2026), pendiente que el equipo corra `npm test` y `flutter analyze`/`flutter test` y pruebe en la app.** Retos creados por los miembros dentro del squad (métrica nueva: peso máximo), duelos 1 vs 1 y chat de soporte usuario↔admin con transferencia a humano cuando se habla de pagos (también desde el asistente de IA) |
| 13 | ✅ **Código listo (23-oct-2026): 143 pruebas del backend y 44 de Flutter en verde, APK de depuración compila, n8n probado de punta a punta en Docker. Pendiente: desplegar 1.3.0 en Azure, crear el proyecto de Firebase, activar los flujos y probar en el celular.** Agente con funciones (registrar sesión y crear reto con confirmación, progreso, memoria de preferencias, transferir a humano), voz en el celular, n8n en el clúster (racha en riesgo, resumen semanal, aviso al admin) y push con FCM |
| 14 | Wompi sandbox y suscripciones Premium |
| 15 | Fotos de ejercicios, videos, cronómetro, rutinas propias y por objetivo |
| 16 | Pruebas de seguridad (Nmap, OWASP ZAP, Kali, MobSF) sobre el despliegue propio y reporte de vulnerabilidades |
| 17 | Documento en norma APA (hoy está en IEEE), Turnitin < 30 %, video de funcionamiento, Play Store opcional |

Pendientes que siguen vivos del traspaso: recorrido completo en el celular, APK firmado, cargar los 10 videos, recrear `playfit_app/README.md` (no está en el PC).

## 8. Brechas entre el doc IEEE y el código (a resolver implementando o documentando)

RF-02 recuperación de contraseña · RF-10/RNF-12 sesiones offline con idempotencia · RF-13 retos entre amigos · RF-22 notificaciones del sistema (✅ Fase 13: push con FCM) · consentimiento A1–A4 y declaración de edad (2.18) · RNF-02 HTTPS · RNF-15 Docker Compose · roles (doc: estudiante+admin) · Sprint 1 dice «Python o Java» (es Node.js).

## 11. Fase 11 — detalles de lo implementado
- **Esquema:** `roles` = estudiante/admin; sin `cursos`, `curso_estudiantes`, `squads.curso_id`; `retos.tipo` = individual/squad; flags con origen estudiante/sistema. Migración idempotente `04_fase11.sql` (columnas TOTP en `usuarios`, tablas `codigos_respaldo_2fa` y `codigos_verificacion`, `consentimientos.texto_hash/ip` y tipo `mayoria_edad`). En una base antigua, las cuentas con rol docente ya no pueden iniciar sesión.
- **2FA:** el login devuelve `requiere_2fa` (con un *desafío* firmado con otra clave, que no sirve como token) o `requiere_configurar_2fa` (admin sin 2FA: configura y entra en el mismo paso). Anti-repetición del código, bloqueo tras 5 fallos, secreto cifrado con AES-256-GCM (`TOTP_KEY` o derivado de `JWT_SECRET`). Variable `ADMIN_2FA_OBLIGATORIO=0` solo para desarrollo.
- **Recuperación:** respuesta siempre genérica, código de 15 min y un solo uso, máximo 5 intentos y 3 correos por hora; al cambiar la contraseña se cierran las sesiones y se desbloquea la cuenta.
- **Consentimiento:** `GET /api/auth/consent-texts` entrega textos + versión; el registro exige A1 (tratamiento de datos) y la declaración de ser mayor de 18; A2 salud, A3 cámara y A4 IA son opcionales. Si los textos cambiaron, el servidor responde `TEXTOS_DESACTUALIZADOS`.
- **Admin:** métricas agregadas y anónimas, auditoría de accesos, lista/activar/desactivar usuarios, restablecer 2FA de otra persona, crear otros admins, crear/activar/desactivar retos oficiales. El admin sigue sin acceso a texto clínico.
- **Correo (Brevo):** crear cuenta gratis, verificar un remitente, generar clave API y ponerlas en `BREVO_API_KEY` y `MAIL_FROM` (`k8s/overlays/*/secrets.env` y `.env`).

## 12. Fase 12 — detalles de lo implementado
- **Esquema:** migración idempotente `05_fase12.sql`: `retos.squad_id` (NULL = reto oficial del admin), métrica `peso_maximo`, tablas `duelos`, `soporte_conversaciones` y `soporte_mensajes`, y motivos nuevos de XP/feed (`duelo`, `reto_creado`).
- **Retos del squad:** cualquier miembro los crea (título, métrica, ejercicio si aplica, meta, 1–30 días, empieza hoy o hasta en 7 días). Pueden ser "meta entre todos" o "cada uno" (el peso máximo siempre es "cada uno"). Anti-abuso: máximo 3 vigentes por squad, la XP la fija el servidor (50 + 10 por día, tope 300) y el progreso sale de las sesiones reales. El creador queda inscrito y al resto del squad le llega una notificación. Solo los ve su squad. Los cancela quien lo creó o el líder. Si alguien elimina su cuenta, sus retos pasan al líder.
- **Duelos 1 vs 1 (RF-13):** solo entre miembros del mismo squad; métricas repeticiones, sesiones o peso máximo; 1–7 días desde que el retado acepta. Máximo 3 duelos abiertos por persona y 1 por pareja; si nadie responde en 3 días vence. Al terminar se resuelve con las sesiones reales: el ganador gana 60 XP, en empate con entreno 25 XP cada uno y sin entreno nada.
- **Soporte:** chat en Perfil › Ayuda y soporte. Un asistente automático (sin IA, por palabras clave) responde dudas frecuentes. Si el mensaje habla de pagos, Premium, cobros, PSE/Nequi, etc., responde *"Un momento, ya te transfiero a un asistente humano"* y la conversación pasa a la bandeja del admin (pestaña Soporte). También transfiere si el usuario pide "hablar con un asesor". El asistente de IA hace lo mismo: un mensaje sobre pagos no se envía a Gemini ni gasta cuota. El admin responde (al usuario le llega una notificación) y cierra; cada conversación que abre queda en la auditoría. Límite: 30 mensajes por hora por usuario.
- **Pendiente para la Fase 14:** desde el chat de soporte el admin enviará el enlace de pago de Wompi.

## 13. Fase 13 — detalles de lo implementado
- **Esquema:** migración idempotente `06_fase13.sql`: `dispositivos_push` (tokens FCM, máx. 5 por usuario, cambian de dueño si otra cuenta entra en el mismo celular), `ia_memoria` (preferencias), `ia_acciones` (propuestas del agente con estado propuesta/confirmada/cancelada), `notificaciones.push_estado` y `mensajes_ia.accion_id`.
- **Agente (Gemini con function calling):**
  - `registrar_sesion` y `crear_reto_squad` **solo proponen**: la app muestra una tarjeta con el resumen y los botones Confirmar/Cancelar. Al confirmar, la app usa los endpoints normales (mismas validaciones, XP y anti-abuso) y luego avisa al asistente. Una propuesta por mensaje. Si faltan datos o no son válidos (ejercicio inexistente, sin squad, meta fuera de rango, sesión de hace más de 7 días), la función le devuelve el error al modelo para que pregunte.
  - `consultar_progreso`: racha, XP, nivel, sesiones de los últimos 7 días y retos vigentes del squad (sin nombres de personas).
  - `guardar_preferencia`: objetivo, nivel, días por semana, horario, minutos por sesión y equipo (listas cerradas). El usuario ve y borra lo que recuerda (botón ✨ en el chat); retirar el permiso A4 lo borra todo.
  - `transferir_a_humano`: lleva la conversación a Soporte (además del filtro de pagos de la Fase 12).
  - Rutinas: el prompt incluye el catálogo con los ejercicios contraindicados por los flags marcados «EVITAR».
  - Un mensaje gasta 1 de la cuota diaria aunque el modelo llame varias funciones (máx. 3 rondas).
- **Voz:** micrófono en el chat (dictado del celular con `speech_to_text`, envía al terminar de hablar) y botón para que el asistente lea sus respuestas en voz alta (`flutter_tts`, se recuerda por usuario). No pasa nada por el backend.
- **Push (FCM, RF-22):** toda notificación de la app (retos, duelos, soporte, nivel, insignias, n8n) se envía también al celular. Bandeja de salida en el social-service: se envía después del commit, cada 10 s, sin duplicar entre réplicas; los tokens inválidos se borran. La app registra su token al entrar y lo quita al cerrar sesión.
- **n8n:** `k8s/base/n8n.yaml` (sin IP pública, disco propio, NetworkPolicies) + 3 flujos en `k8s/n8n/flujos/`: racha en riesgo (diario 7 p. m.), resumen semanal del squad (domingos 6 p. m.) y aviso a los admins cuando hay una transferencia a Soporte (webhook con token). n8n usa una API interna del social-service que solo entrega ids y números y solo crea notificaciones. Si n8n está caído, el aviso de Soporte tiene respaldo directo.
- **Pendiente para la Fase 14:** limitar memoria y voz a Premium; evento `pago-aprobado` → n8n notifica.
