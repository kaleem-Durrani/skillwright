# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- pnpm + Turborepo monorepo: `apps/api`, `apps/web`, `packages/shared`, `packages/db`.
- Docker Compose development stack — Postgres 17, Redis 7, MinIO (private bucket), Mailpit.
- Prisma schema for the unified `User` model, sessions, TOTP credentials, courses, enrollments, uploads, resources, announcements, threaded comments, conversations, notifications, and an append-only audit log.
- `scripts/check-brand.ts` — the product name may be spelled in one file; the previous product name in none.
- `scripts/check-mobile-first.ts` — seven desktop-first patterns rejected in `apps/web/src` (ADR 0008).
- `scripts/generate-permissions-doc.ts` — regenerates `docs/permissions.md` from the policy module; `--check` fails CI when the two disagree.
- CI pipeline: typecheck, lint, format, brand check, mobile-first check, unit tests including the policy matrix, integration tests against real Postgres and Redis, build, and the permissions-doc check.
- `contract-drift` workflow — renames a Prisma column on a scratch branch and asserts that `pnpm -r typecheck` **fails**. A passing typecheck fails the job.
- Multi-stage `Dockerfile`: non-root, production dependencies only, the built SPA served single-origin by the API, tini as PID 1, `HEALTHCHECK` on `/readyz`.
- ADRs 0001–0008 in `docs/adr/`.
- `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `NEXT.md`, MIT `LICENSE`.

### Changed

- Repository history rewritten in place to remove `node_modules` from every commit: 1,814 tracked files to 305, `.git` from 17 MB to 1.7 MB (ADR 0001).

### Removed

- Nothing yet. `backend/` and `frontend/` remain tracked until the rebuild replaces them.

---

[Unreleased]: https://github.com/kaleem-Durrani/skillwright/commits/main
