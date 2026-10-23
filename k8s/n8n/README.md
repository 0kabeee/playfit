# n8n en PlayFit (Fase 13)

n8n es la herramienta de automatizaciones (gratis y *self-hosted*) que pidió el tutor. Corre **dentro del clúster** (`k8s/base/n8n.yaml`) y no tiene IP pública.

```
                  (horario)                         (evento)
   n8n ── cron ──► GET  /internal/rachas-en-riesgo      backend ── POST /webhook/soporte-transferida ──► n8n
       │          GET  /internal/resumen-semanal                                                        │
       └────────► POST /internal/notificaciones ◄──────────────────────────────────────────────────────┘
                         │
                         ▼
          tabla notificaciones ──► social-service las envía por FCM (push) cada 10 s
```

- n8n **solo** habla con la API interna del social-service (`http://social:3003/internal`), protegida con `N8N_TOKEN` y con una NetworkPolicy. No toca la base de datos.
- Lo que n8n recibe son **ids y números** (nunca nombres, correos, mensajes ni datos de salud).
- Lo único que puede hacer es **crear notificaciones** (tipos `racha_riesgo`, `resumen_semanal`, `soporte`, `pago`, `sistema`).

## Flujos incluidos (`flujos/`)

| Archivo | Cuándo | Qué hace |
|---|---|---|
| `racha-en-riesgo.json` | Todos los días 7 p. m. (Bogotá) | Busca a quien tiene racha ≥ 2 y entrenó por última vez ayer, y le avisa «Tu racha está en riesgo». No repite el aviso el mismo día. |
| `resumen-semanal.json` | Domingos 6 p. m. | A cada squad: cuántos entrenaron, sesiones, repeticiones y retos en curso. |
| `soporte-transferida.json` | Cuando el backend lo avisa | Un usuario pasó a Soporte con un humano (pagos o pidió una persona) → notificación a todos los admins. Si el token no coincide, rechaza el evento y el backend usa su respaldo. |

Los dos primeros tienen además un botón **«Ejecutar ahora»** (disparo manual) para mostrarlos en la demo sin esperar al horario.

## 1. Abrir el editor

Con el clúster encendido y la versión 1.3.0 desplegada (`k8s/README.md`, sección 5):

```
kubectl port-forward -n playfit svc/n8n 5678:5678
```

Deja esa ventana abierta y entra a **http://localhost:5678**. La primera vez n8n pide crear la cuenta del dueño (correo y contraseña **solo para n8n**; guárdalos con los secretos del proyecto).

## 2. Importar los flujos

Para cada archivo de `k8s\n8n\flujos\`:

1. En n8n: **Create workflow** › menú **⋯** (arriba a la derecha) › **Import from File…** › elige el `.json`.
2. **Save**.
3. Activa el interruptor **Active** (arriba a la derecha). Los flujos con horario y el webhook solo funcionan activos.

No hay que configurar credenciales: los flujos leen la dirección del backend y el token de las variables de entorno del pod (`PLAYFIT_API_URL`, `PLAYFIT_N8N_TOKEN`).

## 3. Probar

- **Racha / resumen:** abre el flujo y toca **Execute workflow** (usa el disparo «Ejecutar ahora»). En cada nodo ves lo que devolvió el backend; el último debe responder `{"creadas": N}`. En la app, la campana muestra el aviso (y llega el push si configuraste Firebase).
- **Soporte:** en la app, entra como usuario a *Perfil › Ayuda y soporte* y escribe «quiero hablar con un asesor». En n8n, pestaña **Executions** del flujo, aparece la ejecución; el admin recibe la notificación «Nueva conversación en Soporte».

Para probar a mano la API interna desde tu PC:

```
kubectl port-forward -n playfit svc/social 3003:3003
curl -H "x-playfit-token: TU_N8N_TOKEN" http://localhost:3003/internal/rachas-en-riesgo
```

(`TU_N8N_TOKEN` está en `k8s\overlays\azure\secrets.env`. No lo pegues en el chat.)

## 4. Si algo falla

| Síntoma | Qué revisar |
|---|---|
| Pod `n8n` en `CreateContainerConfigError` | Falta `N8N_ENCRYPTION_KEY` en `secrets.env`: corre `node k8s\generar-secretos.js azure` (solo agrega lo que falta) y vuelve a aplicar. |
| El nodo HTTP responde **401** | El `N8N_TOKEN` del pod de n8n y el del social-service no coinciden: ambos salen del mismo secreto; vuelve a aplicar y reinicia los dos (`kubectl rollout restart deployment/n8n deployment/social -n playfit`). |
| El nodo HTTP responde **404** | El social-service no tiene `N8N_TOKEN` (la API interna está apagada) o la versión desplegada es anterior a la 1.3.0. |
| El aviso de Soporte no pasa por n8n | El flujo no está **Active**. El backend usa el respaldo (notifica directo a los admins) y en `kubectl logs -n playfit deploy/social` aparece `n8n respondio 404`. |
| Se perdieron los flujos | Están en el disco `n8n-datos`. Si se borró, se vuelven a importar desde esta carpeta. |

## Verificado

Los 3 flujos se importaron en n8n 1.123.5 y se ejecutaron contra el social-service real (base `playfit_test`): «racha en riesgo» creó el aviso para el usuario en riesgo, el resumen semanal creó una notificación por miembro de cada squad, y el webhook de Soporte notificó al admin (con un token equivocado n8n rechazó el evento y el backend usó el respaldo).
