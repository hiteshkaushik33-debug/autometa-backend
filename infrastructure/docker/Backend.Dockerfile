FROM node:22-bookworm-slim AS node-runtime

FROM node-runtime AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY . .
RUN npm ci && npm run build

FROM node-runtime AS app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY --from=build --chown=node:node /app/backend /app/backend
ENV NODE_ENV=production
USER node
CMD ["node", "dist/api/src/main.js"]

FROM postgres:16-bookworm AS backups
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 libatomic1 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
RUN node --version
COPY ops/backup.mjs /opt/autometa/backup.mjs
ENTRYPOINT ["node", "/opt/autometa/backup.mjs"]
CMD ["loop"]
