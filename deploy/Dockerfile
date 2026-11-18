# Bloom Exchange node: the clearing API and the operating desk as one self-contained server.
# Build from the repository root:
#   docker build -f deploy/Dockerfile -t bloom-exchange-node:0.1.0 .
# Air-gapped hosts: build on a connected machine (fonts and npm packages are fetched at build time only), then
#   docker save bloom-exchange-node:0.1.0 | gzip > bloom-node.tar.gz   →   docker load < bloom-node.tar.gz
# The running node makes no outbound calls unless you configure a model provider or a settlement webhook.

FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---- dependencies: manifests first, so source edits don't bust the install layer ----
FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/sdk/package.json packages/sdk/
COPY packages/mcp/package.json packages/mcp/
COPY apps/node/package.json apps/node/
RUN npm ci --no-audit --no-fund

# ---- build: the engine and SDK (compiled to dist), then the Next.js standalone server ----
FROM deps AS build
COPY . .
RUN npm run build -w @bloom-exchange/core && npm run build -w @bloom-exchange/sdk && npm run build -w @bloom-exchange/node

# ---- runtime: only the standalone server and its static assets ----
FROM base AS runtime
ENV NODE_ENV=production \
    BLOOM_SOVEREIGN_NODE=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/apps/node/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/node/.next/static ./apps/node/.next/static
COPY --from=build --chown=node:node /app/apps/node/public ./apps/node/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=4s --start-period=20s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/exchange/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/node/server.js"]
