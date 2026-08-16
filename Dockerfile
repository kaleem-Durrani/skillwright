# syntax=docker/dockerfile:1.7
#
# Single-origin production image: the API process serves the built SPA from the
# same origin it serves /api/v1 from. That is not a packaging convenience — it is
# what lets the session cookie be `__Host-sw_session` with `SameSite=Lax` and no
# CORS surface at all. See docs/adr/0004-same-origin-sessions-and-csrf.md.
#
# Build:  docker build -t skillwright:local .
# Run:    docker run --rm -p 3000:3000 --env-file .env skillwright:local

ARG NODE_VERSION=22.13.0
ARG ALPINE_VERSION=3.21

# ---------------------------------------------------------------------------
# base — pnpm via corepack, pinned by the root package.json `packageManager`
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true
RUN corepack enable
WORKDIR /app

# ---------------------------------------------------------------------------
# deps — populate the pnpm store from the lockfile alone, so this layer is
#        invalidated only by a dependency change, never by a source edit
# ---------------------------------------------------------------------------
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm fetch

# ---------------------------------------------------------------------------
# build — full workspace install (offline, from the fetched store) + turbo build
# ---------------------------------------------------------------------------
FROM base AS build
COPY --from=deps /pnpm /pnpm
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline

# Prisma client must exist before anything typechecks or compiles.
RUN pnpm --filter @skillwright/db exec prisma generate

RUN pnpm turbo run build --filter=@skillwright/api... --filter=@skillwright/web...

# Production-only tree for the API, with its workspace dependencies injected.
RUN pnpm --filter @skillwright/api deploy --prod /prod/api

# The Prisma client is generated a second time, INSIDE the deployed tree. The
# generated client is emitted next to whichever @prisma/client resolves from the
# schema, so generating it in the build workspace leaves nothing behind in
# /prod/api. The CLI version is read from the runtime client rather than pinned
# here, because a CLI/client mismatch fails at query time rather than at build
# time — which is the worst possible moment to discover it.
RUN PRISMA_VERSION="$(node -p "require('/prod/api/node_modules/@prisma/client/package.json').version")" \
 && npx --yes "prisma@${PRISMA_VERSION}" generate \
      --schema /prod/api/node_modules/@skillwright/db/prisma/schema.prisma

# ---------------------------------------------------------------------------
# runtime — non-root, production deps only, tini as PID 1
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS runtime

# tini reaps zombies and forwards SIGTERM, so `docker stop` and a Kubernetes
# eviction both reach Fastify's graceful-shutdown hook instead of being swallowed
# by npm/pnpm or by Node's default PID-1 signal behaviour.
RUN apk add --no-cache tini

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    WEB_DIST_DIR=/app/public \
    NODE_OPTIONS=--enable-source-maps

WORKDIR /app

# `node` (uid 1000) ships with the base image. Creating another user buys nothing.
COPY --from=build --chown=node:node /prod/api ./
COPY --from=build --chown=node:node /app/apps/web/dist ./public

USER node
EXPOSE 3000

# /readyz checks Postgres, Redis and the object store. /healthz would only prove
# the process is alive, which an orchestrator can already see.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
