FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
COPY backend/api/package.json api/package.json
COPY backend/worker/package.json worker/package.json
COPY backend/packages/config/package.json packages/config/package.json
COPY backend/packages/database/package.json packages/database/package.json
COPY backend/packages/shared-types/package.json packages/shared-types/package.json
COPY backend/packages/web-proxy/package.json packages/web-proxy/package.json
COPY backend/packages/email/package.json packages/email/package.json
RUN npm ci
WORKDIR /app/users
COPY users/package.json users/package-lock.json ./
RUN npm ci
WORKDIR /app/admin
COPY admin/package.json admin/package-lock.json ./
RUN npm ci
COPY admin /app/admin
COPY backend /app/backend
COPY users /app/users
WORKDIR /app/backend
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
RUN npm --prefix /app/users run build && npm --prefix /app/admin run build

FROM node:22-bookworm-slim AS production
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app /app
WORKDIR /app/backend
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
USER node
CMD ["node", "dist/api/src/main.js"]
