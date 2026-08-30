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
# The corepack build INTO node:22.13.0 carries a stale npm-registry signing-key
# allowlist: fetching the pnpm version pinned below (via `pnpm fetch`/`pnpm install`)
# fails with "Cannot find matching keyid", because npm rotated its package-signing
# key after this image was published and old corepack never learned the new one.
# Reinstalling corepack from npm pulls a build with the current keys.
RUN npm install --global corepack@latest
RUN corepack enable
WORKDIR /app
# `corepack enable` only installs a shim that lazily fetches the pinned pnpm
# release (from registry.npmjs.org, into corepack's own cache — a different thing
# entirely from the pnpm PACKAGE store `pnpm fetch` populates below) the first
# time something actually runs `pnpm`. Triggering that fetch HERE, in the one
# ordinary — not cache-mounted — layer both `deps` and `build` descend from, means
# neither of those two independent branches pays for that download itself: without
# this, each would trigger and repeat it separately, since `deps` and `build` never
# share a filesystem with each other, only with `base`. `package.json` (which
# carries the `packageManager` pin `pnpm` reads) is the only file this needs.
COPY package.json ./
RUN pnpm --version

# ---------------------------------------------------------------------------
# deps — populate the pnpm store from the lockfile alone, so this layer is
#        invalidated only by a dependency change, never by a source edit
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# build — fetch from the lockfile, then a full offline workspace install, then
#         the turbo build
# ---------------------------------------------------------------------------
FROM base AS build

# There was a separate `deps` stage here that ran `pnpm fetch`, and the build stage
# re-declared the same cache mount to "reattach the store it populated". That does not
# work, and the way it fails is quiet: BuildKit never builds a stage nothing depends on,
# so with the `COPY --from=deps` gone, `deps` was orphaned and `pnpm fetch` never ran at
# all. Builds kept succeeding only because an earlier layout had left the cache mount
# populated — until a new dependency was added, at which point the offline install
# failed with ERR_PNPM_NO_OFFLINE_TARBALL for exactly that one package.
#
# The fetch belongs in the stage that consumes it. Copying only the three files that
# determine the dependency graph first keeps the property the two stages were for: this
# layer is invalidated by a lockfile change and by nothing else, so editing source does
# not re-download the world.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store     pnpm fetch

COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store     pnpm install --frozen-lockfile --offline

# Prisma client must exist before anything typechecks or compiles.
RUN pnpm --filter @skillwright/db exec prisma generate

RUN pnpm turbo run build --filter=@skillwright/api... --filter=@skillwright/web...

# Production-only tree for the API, with its workspace dependencies injected.
RUN pnpm --filter @skillwright/api deploy --prod /prod/api

# The Prisma client is generated a second time, INSIDE the deployed tree. The
# generated client is emitted next to whichever @prisma/client resolves from the
# schema, so generating it in the build workspace leaves nothing behind in
# /prod/api. The `prisma` CLI used to do it is the one already installed in THIS
# workspace by the frozen-lockfile install above — not a version fetched fresh via
# `npx prisma@<version>` — so it is version-matched to @prisma/client by the exact
# same lockfile resolution, with no extra registry round-trip and no dependency on
# a package-version-inference trick to name it.
#
# `pnpm deploy` places @skillwright/db in /prod/api's node_modules as a SYMLINK
# into pnpm's content-addressable store (it is only ever a transitive dependency
# of @skillwright/api, never hoisted to a real top-level directory of its own).
# Prisma's own schema-to-client resolver, unlike plain `require`/`import`,
# deliberately does not follow symlinks while walking up from the schema's
# directory looking for node_modules — so handed that symlinked path directly, it
# never reaches the store directory that actually holds @prisma/client, and fails
# claiming the client cannot be resolved at all. `realpath` first, so the CLI
# walks up from @skillwright/db's real, physical location instead.
RUN SCHEMA="$(realpath /prod/api/node_modules/@skillwright/db/prisma/schema.prisma)" \
 && pnpm --filter @skillwright/db exec prisma generate --schema "$SCHEMA"

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

# /readyz checks Postgres and Redis — NOT the object store, which this comment used
# to claim. routes/health.ts settles it: two checks, `database` and `redis`. The gap is
# real and deliberate for now: an S3 blip would pull a container that can still serve
# every page out of the load balancer, so uploads 500 while the container reports
# ready. Widen the probe only with that trade in mind. /healthz would prove only that
# the process is alive, which an orchestrator can already see.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
