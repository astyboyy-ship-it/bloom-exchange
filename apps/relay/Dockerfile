# Bloom clearing relay. Build from the repository root:
#   docker build -f apps/relay/Dockerfile -t bloom-relay:0.2.0 .
#   docker run -p 8080:8080 -e DATABASE_URL=... -e UPSTASH_REDIS_REST_URL=... -e UPSTASH_REDIS_REST_TOKEN=... bloom-relay:0.2.0

FROM node:24-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
# npm ci checks every workspace in the lockfile, so all their manifests are copied (sources only for the relay's).
COPY packages/core/package.json packages/core/
COPY packages/sdk/package.json packages/sdk/
COPY packages/mcp/package.json packages/mcp/
COPY packages/schemas/package.json packages/schemas/
COPY apps/node/package.json apps/node/
COPY apps/relay/package.json apps/relay/
COPY apps/verifier/package.json apps/verifier/
RUN npm ci --ignore-scripts --no-audit --no-fund -w @bloom-exchange/schemas -w @bloom-exchange/sdk -w @bloom-exchange/relay --include-workspace-root
COPY packages/schemas packages/schemas
COPY packages/sdk packages/sdk
COPY apps/relay apps/relay
RUN npm run build -w @bloom-exchange/schemas && npm run build -w @bloom-exchange/sdk && npm run build -w @bloom-exchange/relay

FROM node:24-alpine AS deps
WORKDIR /repo
COPY --from=build /repo/package.json /repo/package-lock.json ./
COPY --from=build /repo/packages/core/package.json packages/core/
COPY --from=build /repo/packages/sdk/package.json packages/sdk/
COPY --from=build /repo/packages/mcp/package.json packages/mcp/
COPY --from=build /repo/packages/schemas/package.json packages/schemas/
COPY --from=build /repo/apps/node/package.json apps/node/
COPY --from=build /repo/apps/relay/package.json apps/relay/
COPY --from=build /repo/apps/verifier/package.json apps/verifier/
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund -w @bloom-exchange/schemas -w @bloom-exchange/sdk -w @bloom-exchange/relay

FROM node:24-alpine
ENV NODE_ENV=production PORT=8080
WORKDIR /repo
COPY --from=deps /repo/node_modules node_modules
COPY --from=build /repo/packages/schemas/package.json packages/schemas/package.json
COPY --from=build /repo/packages/schemas/dist packages/schemas/dist
COPY --from=build /repo/packages/sdk/package.json packages/sdk/package.json
COPY --from=build /repo/packages/sdk/dist packages/sdk/dist
COPY --from=build /repo/apps/relay/package.json apps/relay/package.json
COPY --from=build /repo/apps/relay/dist apps/relay/dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/relay/dist/main.js"]
