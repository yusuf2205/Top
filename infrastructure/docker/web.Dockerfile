FROM node:22-alpine AS base
RUN corepack enable

FROM base AS pruner
WORKDIR /app
RUN npm install -g turbo@^2.3.0
COPY . .
RUN turbo prune @top/web --docker

FROM base AS installer
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN corepack prepare pnpm@12.4.1 --activate && pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=installer /app/ .
COPY --from=pruner /app/out/full/ .
RUN corepack prepare pnpm@12.4.1 --activate
RUN npx turbo build --filter=@top/web

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -g 1001 -S nodejs && adduser -S web -u 1001
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=web:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=web:nodejs /app/apps/web/.next/static ./apps/web/.next/static
USER web
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
