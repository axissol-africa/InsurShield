# Production image for the InsurShield API.
#
# Built from the MONOREPO ROOT so the workspace lockfile is available:
#   docker build -f apps/api/Dockerfile -t insurshield-api .
#
# Runs anywhere that takes a container — ECS/Fargate, App Runner, Fly.io,
# Render — so the hosting decision stays open.

# ── prune ───────────────────────────────────────────────────────────────
# `npm ci` installs the whole lockfile even when scoped to one workspace, which
# would drag the React frontend into the API image. `turbo prune` emits a
# backend-only workspace with a matching lockfile instead.
FROM node:24-alpine AS pruner
WORKDIR /app
COPY . .
RUN npx --yes turbo@2.11.3 prune @insurshield/api --docker

# ── production dependencies ─────────────────────────────────────────────
# Only the package.json files, so this layer is cached until a dependency moves.
FROM node:24-alpine AS prod-deps
WORKDIR /app
COPY --from=pruner /app/out/json/ ./
# Omits every optional and devOptional package: better-auth's optional peers (vitest, drizzle-kit) are devOptional and
# survive --omit=dev alone. A runtime dependency that ships its platform binary as an optional dependency needs this revisited.
RUN npm ci --omit=dev --omit=peer --omit=optional --ignore-scripts && npm cache clean --force

# ── build ───────────────────────────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /app
COPY --from=pruner /app/out/json/ ./
RUN npm ci --ignore-scripts
COPY --from=pruner /app/out/full/ ./
WORKDIR /app/apps/api
RUN npm run build

# ── migrator ────────────────────────────────────────────────────────────
# Applies migrations as a pre-deploy/release step, e.g. Fly `release_command`,
# an ECS one-off task, or a Render pre-deploy command:
#   docker build -f apps/api/Dockerfile --target migrator -t insurshield-migrator .
#   docker run --rm -e DATABASE_URL=postgresql://… insurshield-migrator
# The entry point reads the migrations from apps/api/drizzle/, beside dist/.
FROM node:24-alpine AS migrator
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/package.json ./package.json
COPY --from=prod-deps /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/drizzle ./apps/api/drizzle
USER node
WORKDIR /app/apps/api
CMD ["node", "dist/db/migrate.js"]

# ── runtime ─────────────────────────────────────────────────────────────
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# tini reaps zombies and forwards SIGTERM so Nest's shutdown hooks actually run.
RUN apk add --no-cache tini && \
    addgroup -S nodejs && adduser -S nestjs -G nodejs

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/package.json ./package.json
COPY --from=prod-deps /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist

USER nestjs
WORKDIR /app/apps/api
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
