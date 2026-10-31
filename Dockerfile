# Delomu v3 server image for self-hosting inside a customer's own cloud (VPC).
# Build: docker build -t delomu .   Run: see docs/v3.md.
FROM node:24-slim

ENV NODE_ENV=production \
    DELOMU_HOST=0.0.0.0 \
    PORT=8080 \
    DELOMU_DATA=/data

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY bin ./bin
COPY src ./src

# The data volume holds delomu.db and every org's deployment folders; run as the image's non-root user.
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
USER node

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "bin/delomu.mjs", "serve"]
