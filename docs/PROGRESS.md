# Progress

What has actually happened, newest first. One or two lines per entry, dated.

This file records **what changed and the state it left the repository in** — not what is planned. `docs/rebuild/00-REBUILD-PLAN.md` is the backlog and `NEXT.md` is the single next task. Entries carry their verification status, because *written* and *observed passing* are different facts:

- **verified** — a command was run and its output was read.
- **written** — the code exists and has never executed.

---

## 2026-08-16

**Commit plan written; two running logs added.**
`COMMIT-PLAN.md` at the repo root splits the entire uncommitted tree into 37 staged commits with explicit paths. `.gitignore` gains `!docs/PROGRESS.md` and `!docs/LESSONS-LEARNED.md` so this file and its sibling are tracked; `docs/rebuild/00-REBUILD-PLAN.md` §3.1 records the convention. **Nothing is committed yet** — the whole rebuild is still one working tree on top of `5d151ed`.

**`apps/web` — design system, shell and thirteen screens.** *(written; typecheck/build/lint verified, nothing rendered against a live API)*
Vite 6 + React 19 + TanStack Router/Query. Tailwind v4 `@theme inline` tokens, 26 UI primitives, a mobile-first shell (bottom tabs → sidebar at `md`), 13 pages, a typed route tree with `beforeLoad` guards, and `Gate` running the same `can()` as the server. `Settings.tsx` MFA enrolment is a stub — marked `TODO(mfa-ui)`.

**`apps/api` — plugin layer and the auth module.** *(written; typecheck/build/lint verified, never booted)*
Fastify 5 with `fastify-type-provider-zod`. Seven plugins (Prisma, Redis, logger, errors, session auth, CSRF, two-dimensional rate limiting), RFC 9457 problem responses, and the full auth module including TOTP enrol/activate/verify/disable with AES-256-GCM secrets at rest. The 16 integration tests in `apps/api/test/auth.test.ts` **fail on database credentials and have never run against Postgres.**

**`packages/db` — schema, both migrations, audit extension, seed.** *(written; `db:generate` verified, no migration has ever executed)*
Unified `User` + `Role` model across 18 tables and 11 enums. `0001_init` was checked structurally against Prisma's own canonical DDL — 295 facts vs 294, 0 missing, 0 extra, all 29 FKs with their `onDelete`. `0002_constraints` has been read but never run. The audit client extension and the 1,154-line seed are unproven.

**`packages/shared` — brand, DTOs, policy engine.** *(verified — 577 tests observed passing)*
Policy-as-data over 44 actions with no I/O, so the same `can()` compiles server-side and in the browser. 194 hand-written matrix cells plus 484 generated ones prove 678 decisions. Zod DTOs for every API shape.

**Monorepo scaffolding stood up.** *(verified — `pnpm install`, `typecheck` 5/5, `build` 3/3, `lint` 3/3, `format:check`, `check:brand`, `check:mobile-first` all observed passing)*
pnpm workspaces + Turborepo, strict shared tsconfig, prettier/editorconfig, Docker Compose (Postgres **5433**, Redis, MinIO, Mailpit), multi-stage Dockerfile, two CI workflows, three guard scripts, eight ADRs, README. **Docker Desktop has never been started, so no container in the compose file has ever run.**

**History rewritten in place.** *(verified)*
`git filter-repo --invert-paths --path node_modules/` removed 1,509 files from all 132 commits; `.git` went 17 MB → 1.7 MB, tracked files 1,814 → 305, every SHA changed. `origin` was removed by filter-repo and has not been re-added; publishing needs `--force-with-lease`. Backup bundle at `C:\Users\Legion\Desktop\millat-backup-20260816.bundle`. The legacy `.env` (live Neon / Gmail / Cloudinary credentials, never committed) was moved to `C:\Users\Legion\millat-legacy-secrets.env.txt`. **Those three credentials still need rotating.**

---

*Entries before 2026-08-16 are the old `Millat vocational training` app and are recoverable with `git checkout 5d151ed -- backend frontend`. They are not logged here.*
