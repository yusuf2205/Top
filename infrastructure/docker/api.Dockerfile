# Build context: repo root (docker compose build sets this — see docker-compose.yml)
# Follows the standard turborepo + pnpm Docker pattern: prune -> install -> build -> slim runner.
FROM node:22-alpine AS base
RUN corepack enable

FROM base AS pruner
WORKDIR /app
RUN npm install -g turbo@^2.3.0
COPY . .
RUN turbo prune @top/api --docker

FROM base AS installer
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN corepack prepare pnpm@12.4.1 --activate && pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=installer /app/ .
COPY --from=pruner /app/out/full/ .
# turbo prune only follows package.json-declared workspace deps — tsconfig.base.json
# is a root file referenced only via TS "extends", so it isn't pruned in automatically.
COPY tsconfig.base.json ./tsconfig.base.json
RUN corepack prepare pnpm@12.4.1 --activate
# @prisma/client's own postinstall can't find a non-default schema location (it warns
# and skips) — generate explicitly so the typed client (and the extension typings
# packages/database/src/client.ts depends on) actually exist before compiling.
RUN pnpm --filter @top/database exec prisma generate
RUN npx turbo build --filter=@top/api

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -g 1001 -S nodejs && adduser -S api -u 1001
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
# pnpm's isolated node_modules puts apps/api's own direct deps (reflect-metadata,
# @nestjs/*, ...) as symlinks under apps/api/node_modules, not hoisted to the root —
# without this, `node apps/api/dist/main.js` fails with MODULE_NOT_FOUND at boot.
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
USER api
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]
