FROM node:22-bookworm-slim AS node-runtime
FROM postgres:16-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 libatomic1 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
RUN node --version
COPY backend/ops/backup.mjs /opt/autometa/backup.mjs
ENTRYPOINT ["node", "/opt/autometa/backup.mjs"]
CMD ["loop"]
