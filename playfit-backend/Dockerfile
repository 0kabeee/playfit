# PlayFit backend: UNA sola imagen para el gateway y los 4 microservicios.
# Cada contenedor arranca un proceso distinto (ver docker-compose.yml y k8s/), asi se construye y se sube una vez.
#   docker build -t playfit-backend:dev .
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY gateway/package.json gateway/
COPY services/auth-service/package.json services/auth-service/
COPY services/clinical-service/package.json services/clinical-service/
COPY services/social-service/package.json services/social-service/
COPY services/content-service/package.json services/content-service/
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-alpine
ENV NODE_ENV=production \
    SERVICE_HOST=0.0.0.0 \
    TRUST_PROXY=uniquelocal
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY shared ./shared
COPY gateway ./gateway
COPY services ./services
COPY database ./database
COPY scripts/db-init.js ./scripts/db-init.js
# Sin privilegios de root (el usuario "node" ya viene en la imagen oficial)
USER node
EXPOSE 3000 3001 3002 3003 3004
# Por defecto arranca el gateway; los servicios cambian el comando.
CMD ["node", "gateway/src/server.js"]
