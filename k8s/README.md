# PlayFit en Kubernetes: en tu PC y en Azure (Fase 10)

Esta carpeta monta todo el backend de PlayFit en un **clúster de Kubernetes**: primero en tu PC (Docker Desktop) y luego en **Azure (AKS)** con HTTPS y un subdominio gratis.

```
Internet ──► IP pública de Azure + subdominio  NOMBRE.REGION.cloudapp.azure.com
              │ (puertos 80 y 443)
              ▼
            Caddy ── HTTPS automático (Let's Encrypt)
              │
              ▼
            gateway (3000) ── límites por IP, CORS, cabeceras de seguridad
              │
              ├─► auth (3001)       ┐
              ├─► clinical (3002)   │ solo el gateway puede llamarlos (NetworkPolicy)
              ├─► social (3003)     │
              └─► content (3004) ───┼──► Gemini (internet)
                                    ▼
                                 MariaDB 11.8 (SQL relacional, disco persistente de 5 GB)
                                    ▲
                                 respaldo diario 3:00 a. m. (guarda los últimos 7)
```

| Carpeta / archivo | Qué es |
|---|---|
| `base/` | Lo común: namespace, configuración, MariaDB, gateway + 4 servicios, NetworkPolicies, respaldos |
| `overlays/local/` | Para el Kubernetes de Docker Desktop: el gateway queda en `http://localhost:3000` |
| `overlays/azure/` | Para AKS: Caddy con HTTPS, subdominio de Azure, imagen desde GitHub (ghcr.io) |
| `generar-secretos.js` | Crea `overlays/ENTORNO/secrets.env` con contraseñas y llaves aleatorias (**nunca se sube a Git**) |

> **Comandos:** todos están pensados para **cmd** (Símbolo del sistema) y se corren desde `C:\playfit` salvo que se diga otra cosa. Donde hay una diferencia con PowerShell, se avisa.

---

## 0. Requisitos (una sola vez)

1. **Docker Desktop** para Windows: https://www.docker.com/products/docker-desktop/ (gratis para uso educativo/personal).
2. En Docker Desktop: **Settings › Kubernetes › Enable Kubernetes** › *Apply & restart*. Espera a que el ícono de Kubernetes salga en verde. Esto también instala `kubectl`.
3. Comprueba en una terminal nueva:
   ```
   docker version
   kubectl version --client
   ```

---

## 1. Lo más rápido: Docker Compose (sin Kubernetes)

Sirve para comprobar que la imagen funciona. Usa tu `playfit-backend\.env`, pero con **otra base de datos** (un MariaDB en un contenedor), así que tu base del puerto 3307 no se toca.

```
cd C:\playfit\playfit-backend
docker compose up --build
```
- La primera vez tarda unos minutos (descarga MariaDB y Node). Verás `[db-init] listo.` y luego los 5 procesos escuchando.
- Abre http://localhost:3000/health → debe decir `"estado":"ok"`.
- Cuentas de ejemplo: las del README del backend (contraseña `PlayFit123!`, solo en tu PC).
- Si `npm run dev` está corriendo, apágalo primero (los dos quieren el puerto 3000), o usa otro puerto: `set COMPOSE_GATEWAY_PORT=3100` y luego `docker compose up`.
- Detener: `Ctrl+C` y después `docker compose down`. Para borrar también esa base: `docker compose down -v`.

---

## 2. Kubernetes en tu PC (Docker Desktop)

```
cd C:\playfit
docker build -t playfit-backend:dev playfit-backend
node k8s\generar-secretos.js local
kubectl config use-context docker-desktop
kubectl apply -k k8s\overlays\local
kubectl get pods -n playfit -w
```
- `generar-secretos.js` imprime la **contraseña de las cuentas de ejemplo** (`ana@playfit.test`, `admin@playfit.test`, ...). Anótala.
- Espera a que todos los pods digan `Running` y `1/1` (MariaDB tarda ~1 min la primera vez). Sal con `Ctrl+C`.
- Prueba: http://localhost:3000/health. El emulador sigue usando `http://10.0.2.2:3000` y el celular por cable `adb reverse tcp:3000 tcp:3000`, igual que antes.
- **Cambiaste código del backend:** vuelve a correr el `docker build ...` de arriba y luego `kubectl rollout restart deployment -n playfit`.
- **Borrar todo** (incluida esa base de datos): `kubectl delete -k k8s\overlays\local`.

> En Docker Desktop las NetworkPolicies no se aplican (no tiene el componente que las hace cumplir). En Azure sí.

---

## 3. Azure (AKS) con HTTPS

### 3.1 Activar Azure for Students
Entra a https://azure.microsoft.com/free/students con el **correo de la universidad**. Da US$100 por 12 meses, sin tarjeta. Cada integrante del equipo puede activar la suya (sirve de respaldo si se acaba el crédito).

### 3.2 Instalar la CLI de Azure e iniciar sesión
```
winget install -e --id Microsoft.AzureCLI
```
Cierra y vuelve a abrir la terminal, luego:
```
az login
az account show --query name
```
(debe mostrar algo como `"Azure for Students"`).

Registra los servicios que se usan (una sola vez; puede tardar unos minutos):
```
az provider register --namespace Microsoft.ContainerService
az provider register --namespace Microsoft.Compute
az provider register --namespace Microsoft.Network
```

### 3.3 Crear el grupo y el clúster
```
az group create --name playfit-rg --location eastus2
az aks create --resource-group playfit-rg --name playfit-aks --tier free --node-count 1 --node-vm-size Standard_B2s --network-plugin azure --network-plugin-mode overlay --network-dataplane cilium --generate-ssh-keys
```
- Tarda de 5 a 10 minutos. `--tier free` = el plano de control no se cobra; solo se paga la máquina (el nodo) con el crédito.
- `--network-dataplane cilium` es lo que hace cumplir las NetworkPolicies (el "firewall interno").
- **Si sale `RequestDisallowedByAzure` o un error de región:** las suscripciones de estudiante solo permiten algunas regiones; el mensaje de error las lista. Repite los dos comandos con una de ellas (por ejemplo `--location centralus`) y **usa esa misma región en el subdominio** (paso 3.5).
- **Si el tamaño `Standard_B2s` no está disponible:** prueba `Standard_B2s_v2` o `Standard_B2as_v2`. Para ver cuáles hay: `az vm list-skus --location eastus2 --size Standard_B2 --output table`.

Conecta `kubectl` al clúster:
```
az aks get-credentials --resource-group playfit-rg --name playfit-aks
kubectl get nodes
```
> ⚠️ Desde ahora `kubectl` apunta a **Azure**. Antes de cualquier `apply` revisa a cuál estás conectado: `kubectl config current-context`. Para volver al de tu PC: `kubectl config use-context docker-desktop`; para volver a Azure: `kubectl config use-context playfit-aks`.

### 3.4 Subir la imagen a GitHub (ghcr.io, gratis)
1. En GitHub: **Settings › Developer settings › Personal access tokens › Tokens (classic) › Generate new token (classic)**. Crea **dos**:
   - uno con `write:packages` (para subir desde tu PC),
   - otro con solo `read:packages` (para que el clúster descargue). Cópialos: GitHub no los vuelve a mostrar.
2. Construir y subir (cambia `0kabeee` si la cuenta es otra; debe ir en minúsculas):
   ```
   docker login ghcr.io -u 0kabeee
   ```
   Como contraseña pega el token de **write:packages**. Luego:
   ```
   docker build -t ghcr.io/0kabeee/playfit-backend:1.0.0 playfit-backend
   docker push ghcr.io/0kabeee/playfit-backend:1.0.0
   ```
3. Dar al clúster permiso de descarga (el paquete es privado por defecto). Cambia `TOKEN_LECTURA` por el token de **read:packages**:
   ```
   kubectl create namespace playfit
   kubectl create secret docker-registry ghcr-pull -n playfit --docker-server=ghcr.io --docker-username=0kabeee --docker-password=TOKEN_LECTURA
   ```

### 3.5 Elegir el subdominio
El subdominio queda así: **NOMBRE.REGION.cloudapp.azure.com** (gratis, lo da Azure). Ejemplo: `playfit-usb.eastus2.cloudapp.azure.com`.
- `NOMBRE`: minúsculas, números y guiones; debe estar libre en esa región.
- `REGION`: la misma de `az group create` (sin espacios, ej. `eastus2`).

Edita dos archivos (las líneas dicen `<-- CAMBIA`):
- `k8s\overlays\azure\kustomization.yaml` → `PLAYFIT_DOMAIN=...` (el subdominio completo) y, si hace falta, `newName` / `newTag` de la imagen.
- `k8s\overlays\azure\caddy.yaml` → `azure-dns-label-name: ...` (solo el `NOMBRE`).

### 3.6 Secretos y despliegue
```
node k8s\generar-secretos.js azure
```
- Anota la contraseña de las cuentas de ejemplo que imprime.
- Si no copió la `GEMINI_API_KEY`, ábrelo (`k8s\overlays\azure\secrets.env`) y pégala después de `GEMINI_API_KEY=`.
- **Guarda una copia de ese archivo fuera de la carpeta del proyecto** (USB, gestor de contraseñas). La `CLINICAL_KEY` cifra los historiales clínicos: si se pierde, no se recuperan. No lo mandes por chat ni lo subas a Git (ya está en `.gitignore`).

```
kubectl config current-context
kubectl apply -k k8s\overlays\azure
kubectl get pods -n playfit -w
```
Cuando todo esté `Running 1/1` (`Ctrl+C` para salir):
```
kubectl get service caddy -n playfit
```
Debe tener una `EXTERNAL-IP`. En 1–2 minutos Caddy saca el certificado. Abre en el navegador:
**https://playfit-usb.eastus2.cloudapp.azure.com/health** (con tu subdominio) → `{"gateway":"ok","estado":"ok",...}` y el candado de HTTPS.

### 3.7 Conectar la app
Ya no hace falta la misma WiFi, `adb reverse` ni abrir el firewall de Windows: funciona hasta con datos móviles.
```
flutter run --dart-define=API_BASE=https://playfit-usb.eastus2.cloudapp.azure.com
flutter build apk --release --dart-define=API_BASE=https://playfit-usb.eastus2.cloudapp.azure.com
```

### 3.8 Apagar y prender (para que el crédito dure)
El nodo es lo que más gasta. Apágalo cuando no lo estén usando; **los datos se conservan**:
```
az aks stop --resource-group playfit-rg --name playfit-aks
az aks start --resource-group playfit-rg --name playfit-aks
```
- Después de `start`, espera unos minutos a que los pods vuelvan a `Running`. El subdominio sigue siendo el mismo.
- Apagado, los discos y la IP pública siguen costando un poco (centavos al día).
- Revisa el saldo en el portal de Azure (https://portal.azure.com › *Cost Management*). Es buena idea crear una alerta de presupuesto ahí.

### 3.9 Subir una versión nueva del backend
```
docker build -t ghcr.io/0kabeee/playfit-backend:1.0.1 playfit-backend
docker push ghcr.io/0kabeee/playfit-backend:1.0.1
```
Cambia `newTag: "1.0.1"` en `k8s\overlays\azure\kustomization.yaml` y:
```
kubectl apply -k k8s\overlays\azure
```
Kubernetes reemplaza los pods uno por uno. Si algo sale mal: `kubectl rollout undo deployment/auth -n playfit` (igual con los demás).

### 3.10 Respaldos
- Automático: todos los días a las 3:00 a. m. (hora de Bogotá), se guardan los últimos 7 en su propio disco.
- Sacar uno manual **a tu PC** (en **cmd**, no en PowerShell: PowerShell cambia `$MARIADB_PASSWORD` y la codificación del archivo):
  ```
  kubectl exec -n playfit mariadb-0 -- sh -c "mariadb-dump -u playfit_app -p$MARIADB_PASSWORD --single-transaction playfit" > respaldo-playfit.sql
  ```
- Restaurar ese archivo (borra lo que haya con el mismo nombre de tabla):
  ```
  kubectl exec -i -n playfit mariadb-0 -- sh -c "mariadb -u playfit_app -p$MARIADB_PASSWORD playfit" < respaldo-playfit.sql
  ```
- Lanzar el respaldo programado ahora mismo: `kubectl create job -n playfit --from=cronjob/respaldo-mariadb respaldo-manual`.

### 3.11 Borrar todo (al final del proyecto)
```
az group delete --name playfit-rg --yes
```
Borra el clúster, los discos y la IP. **Los datos se pierden** (saca un respaldo antes).

---

## 4. Qué seguridad queda aplicada (para el documento y la sustentación)

| Medida | Dónde |
|---|---|
| Un solo punto de entrada público (Caddy, puertos 80/443); el gateway, los servicios y la base no tienen IP pública | `overlays/azure/caddy.yaml` |
| HTTPS con certificado de Let's Encrypt renovado automáticamente; HSTS | `overlays/azure/Caddyfile` (cierra el RNF-02) |
| Firewall interno: todo cerrado por defecto; MariaDB solo desde los servicios; los servicios solo desde el gateway; el gateway solo desde Caddy | `base/networkpolicies.yaml` (RNF-04) |
| Pods sin root, sin escalar privilegios, sin capacidades de Linux y con el sistema de archivos de solo lectura (perfil *restricted* de Kubernetes, forzado en el namespace) | `base/namespace.yaml`, `base/backend.yaml` |
| Secretos fuera de la imagen y fuera de Git (Kubernetes Secret generado desde `secrets.env`) | `generar-secretos.js`, `.dockerignore` |
| Las cuentas de ejemplo no usan la contraseña pública del README | `DEMO_PASSWORD` en `scripts/db-init.js` |
| Límites por IP con la IP real del cliente (no compartidos entre todos los usuarios) | `GATEWAY_TRUST_PROXY=1` |
| Respaldos diarios; el historial clínico va cifrado (AES-256-GCM) también dentro del respaldo | `base/backup.yaml` |
| Despliegue reproducible con Docker Compose y Kubernetes | RNF-15 |

---

## 5. Problemas comunes

| Síntoma | Qué revisar |
|---|---|
| Pod en `ImagePullBackOff` | Nombre/etiqueta de la imagen en `kustomization.yaml`, que hiciste `docker push`, y el secreto `ghcr-pull` (paso 3.4). En local: que hiciste `docker build -t playfit-backend:dev ...` |
| Pod en `CrashLoopBackOff` | `kubectl logs -n playfit deploy/auth -c db-init` (inicialización de la base) y `kubectl logs -n playfit deploy/auth` (el servicio). Igual con `clinical`, `social`, `content`, `gateway` |
| `mariadb-0` en `Pending` | `kubectl describe pod mariadb-0 -n playfit` (casi siempre es el disco; espera 1–2 min en Azure) |
| El navegador no muestra el candado / error de certificado | El `NOMBRE` de `caddy.yaml` debe coincidir con el inicio de `PLAYFIT_DOMAIN`, y la región con la del clúster. `kubectl logs -n playfit deploy/caddy`. Let's Encrypt limita los intentos fallidos (espera una hora si fallaste varias veces) |
| `kubectl` hace cambios en el clúster equivocado | `kubectl config current-context` (sección 3.3) |
| El chat de IA responde 503 | Falta `GEMINI_API_KEY` en `secrets.env`; después de editarlo: `kubectl apply -k k8s\overlays\azure` |
| En Docker Desktop, `mariadb-0` se reinicia con `Permission denied` en `/var/lib/mysql` | Borra y vuelve a crear: `kubectl delete -k k8s\overlays\local` y `kubectl apply -k k8s\overlays\local`; si sigue, avísanos con el log (`kubectl logs -n playfit mariadb-0`) |
| `pods ... is forbidden: violates PodSecurity "restricted"` | Algún cambio pidió root o privilegios: revisa el `securityContext` del manifiesto que editaste |
