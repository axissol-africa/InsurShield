# Production image for the InsurShield API.
#
# Built from the MONOREPO ROOT so the workspace lockfile is available:
#   docker build -f backend/Dockerfile -t insurshield-api .
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
RUN npx --yes turbo@2.11.3 prune backend --docker

# ── production dependencies ─────────────────────────────────────────────
# Only the package.json files, so this layer is cached until a dependency moves.
FROM node:24-alpine AS prod-deps
WORKDIR /app
COPY --from=pruner /app/out/json/ ./
# --omit=peer drops auto-installed optional peers (Prisma Studio pulls React).
#
# `@prisma/client` also declares the Prisma CLI as an OPTIONAL peer, so npm
# installs it regardless. The running app needs only @prisma/client and
# @prisma/adapter-pg — applying migrations is the `migrator` target's job. This
# removal must happen in the same layer as the install, or the files remain in
# the layer below and the image does not actually shrink. It takes the CLI's
# mysql2/deepmerge-ts advisories with it; this service is Postgres-only and
# never loads the MySQL driver.
RUN npm ci --omit=dev --omit=peer --ignore-scripts && \
    npm cache clean --force && \
    rm -rf node_modules/prisma \
           node_modules/@prisma/config \
           node_modules/@prisma/studio-core \
           node_modules/@prisma/dev \
           node_modules/mysql2 \
           node_modules/deepmerge-ts \
           node_modules/effect \
           node_modules/@electric-sql \
           node_modules/typescript

# ── build ───────────────────────────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /app
COPY --from=pruner /app/out/json/ ./
RUN npm ci --ignore-scripts
COPY --from=pruner /app/out/full/ ./
WORKDIR /app/backend
RUN npx prisma generate && npm run build

# ── migrator ────────────────────────────────────────────────────────────
# Applies migrations as a pre-deploy/release step, e.g. Fly `release_command`,
# an ECS one-off task, or a Render pre-deploy command:
#   docker build -f backend/Dockerfile --target migrator -t insurshield-migrator .
# Kept separate so the Prisma CLI (and the ~200MB of tooling it pulls in) never
# ships in the image that serves traffic.
FROM build AS migrator
WORKDIR /app/backend
CMD ["npx", "prisma", "migrate", "deploy"]

# ── runtime ─────────────────────────────────────────────────────────────
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Prisma needs OpenSSL; tini reaps zombies and forwards SIGTERM so Nest's
# shutdown hooks actually run.
RUN apk add --no-cache openssl tini && \
    addgroup -S nodejs && adduser -S nestjs -G nodejs

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/package.json ./package.json
COPY --from=prod-deps /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/dist ./backend/dist

USER nestjs
WORKDIR /app/backend
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
