FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    DATA_DIR=/data \
    BACKUP_DIR=/backups \
    PORT=3000

WORKDIR /app

# Dépendances d'abord, pour profiter du cache Docker
COPY package.json package-lock.json ./
# --ignore-scripts : les binaires natifs (SQLite, sharp, argon2) sont précompilés,
# inutile d'installer un compilateur dans l'image
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY src ./src
COPY public ./public

COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /data /backups

EXPOSE 3000
VOLUME ["/data", "/backups"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "src/server.js"]
