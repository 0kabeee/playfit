# PlayFit

App móvil de **gamificación social** para que los estudiantes de la Universidad de San Buenaventura (USB) inscritos en **Acondicionamiento Físico** sean constantes en el gimnasio. Proyecto de grado, desarrollado con **Scrum** y con **presupuesto $0** (todo el stack es gratuito).

## Qué incluye

- **Rachas, XP, niveles, insignias, retos y ranking** por ejercicio, en un **squad** (grupo) con compañeros.
- **Registro de sesiones** con repeticiones y peso propios por serie.
- **Conteo automático de repeticiones con la cámara** (ML Kit, en el celular): sentadilla, zancadas, flexiones, press militar y curl de bíceps. El video no se guarda ni se envía.
- **Técnica de cada ejercicio** con video dentro de la app y consejos.
- **Asistente de IA** (Gemini, plan gratuito) para dudas de técnica y nutrición. Solo recibe indicadores derivados, nunca texto clínico ni datos personales.
- **Mascota contextual** que reacciona a tus datos reales (y no aparece en pantallas clínicas).
- Seguridad: JWT con refresh rotativo, bloqueo temporal por intentos fallidos, historial clínico cifrado (AES-256-GCM) y auditoría de lecturas, alineado con la Ley 1581 y el Decreto 1377 de Colombia.

## Estructura

| Carpeta | Contenido |
|---|---|
| [`playfit-backend/`](playfit-backend) | Node.js + MariaDB: API Gateway (puerto 3000) y 4 microservicios (auth, clinical, social, content). 89 pruebas automáticas. |
| [`playfit_app/`](playfit_app) | App Flutter (Android). Solo rol estudiante. |

Cada carpeta tiene su propio `README.md` con los detalles.

## Cómo correrlo (Windows)

**Requisitos:** Node.js, MariaDB, Flutter y Android Studio.

1. **Backend**
   ```
   cd playfit-backend
   npm install
   npm run setup -- --db-port=3306
   npm run dev
   ```
   Usa el puerto donde escucha tu MariaDB. `npm run setup` crea el archivo `.env` con secretos aleatorios (ese archivo **no** se sube al repositorio). Para cargar la base con datos de ejemplo: `npm run db:reset`.

2. **App**
   ```
   cd playfit_app
   flutter pub get
   flutter run
   ```
   El emulador de Android se conecta al backend por `http://10.0.2.2:3000`. Para un celular real, mira la sección «Conteo de repeticiones con la cámara» y «Generar el APK» en `playfit_app/README.md`.

## Pruebas

```
cd playfit-backend && npm test
cd playfit_app && flutter test
```

## Notas

- La red social abierta/pública quedó fuera del alcance (trabajo futuro).
- Para activar el chat de IA hay que poner una `GEMINI_API_KEY` propia en el `.env` del backend (guía en `playfit-backend/README.md`).
- Nunca subas el `.env`, la llave de firma (`*.jks`) ni `android/key.properties`.
