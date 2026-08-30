# Next

**The next task is B5, the ship gate: run CI, deploy, and write README v1 around a live link.**

Everything else is built. What B5 settles is the one thing nothing else can — that this
repository works somewhere other than the machine it was written on.

1. **Run CI.** `.github/workflows/ci.yml` has never executed. Every job in it has been run by
   hand locally, so the first push should be close, but a runner is not a laptop: the two
   things a local dry-run cannot answer are whether `ubuntu-latest` disagrees about anything
   and whether the service containers come up as configured.
2. **Deploy.** Needs a host and credentials. The image is built and runs; nothing has been
   pointed at the internet.
3. **README v1.** A live link above the fold, a favicon and an OG image, and one rehearsal of
   restoring from backup.

This is where the plan puts the finish line, and it is honest about why: until a clean clone
builds on a second machine and a URL answers, the rest is unverified in the way that counts.

---

## Where things stand

**Built and running.** The monorepo and the Compose stack; eight migrations and the seed;
`@skillwright/shared`; the API's plugin layer, password and TOTP auth, and thirteen modules —
departments, courses, enrollments, users, conversations, notifications, dashboard, admin,
audit events, resources, uploads, announcements and comments. The web design system, app
shell and every screen. Resources are complete end to end; announcements and threaded
comments have both an API and a UI; admin CRUD covers users, departments and courses.
Abandoned uploads are swept on a timer, enrolment and attendance export as streamed CSV,
search is ranked over trigram indexes, and the audit screen has its forensics view. Suspended
accounts can be reinstated. Committed uploads are immutable. The MFA enrolment screen shows a
QR code, confirms a code and reveals recovery codes once.

**Not built.** Realtime. There is no WebSocket layer and no queue subsystem, and the packages
for both have been removed rather than left to ship unused. Restoring them is one command if
the work is ever taken on.

**Verified on 2026-08-30.** Shared 852 tests at 100% of `src/**` · API 488 with coverage
enforced at 93.84 / 84.5 / 91.91 / 93.84 · web 385 across 43 files · db 10 — **1,735 unit and
integration tests**, plus **84 browser tests** across three viewport projects and **6** against
a real stack with a real login. `typecheck` clean in all four workspaces and in `scripts/`,
`lint` clean in all four, and `build`, `format:check`, `check:brand`, `check:mobile-first` and
`docs:permissions --check` all pass. The production image builds and serves the SPA
single-origin.

**Never executed.** Both CI workflows. The `Dockerfile` is not on this list — it was built and
run on 2026-08-23, and the six faults that surfaced are lesson 38 in
[`docs/LESSONS-LEARNED.md`](docs/LESSONS-LEARNED.md).

**UI roadmap.** Phase 1 (dialog performance) and Phase 5 (deferred features) have landed.
Phase 1's result was mostly negative and worth knowing before repeating it: measured against a
production build, the dialogs already opened with zero blocking time, so two of the four
planned fixes were built, measured worse than what they replaced, and dropped. Phases 2–4 —
shell and spacing, a unified `DataTable`, motion systematised — are not started, and none of
them blocks shipping.

---

## Running it locally

```bash
pnpm infra:up     # Postgres, Redis, MinIO, Mailpit — exits 0 when all four are healthy
pnpm dev          # infra:up, then turbo dev across api + web
```

Postgres publishes on **5433**, because a native install commonly owns 5432. Redis on **6381**
and MinIO on **9002/9003** are overrides for the machine this was built on, where other
projects hold the defaults; `docker-compose.yml` falls back to the standard ports for everyone
else. Mailpit's inbox is at <http://localhost:8025>.

Tests use their own databases, created by `pnpm db:test:setup`. The fixture **refuses to
start** against any database whose name does not end in `_test`, because it deletes every user
and department between files.

Two test processes must never share one database. `apps/api/vitest.config.ts` serialises files
within a single vitest process, which says nothing about two of them: concurrent runs leave
rows behind, `resetDatabase()` then fails on a `StudentProfile` restrict constraint, and every
later suite fails at sign-in. Give each worker its own — `TEST_DATABASE_URL` is read first.
Those databases are not migrated automatically; after a new migration, run `prisma migrate
deploy` against each one, or a suite fails with a column-not-found error that reads like a
regression and is a stale schema.

---

## Known issues

- **The notification panel has a critical accessibility violation.** axe reports
  `aria-required-children` against the open panel in both themes: _"Element has children which
  are not allowed: [role=status]"_. That is `EmptyState`'s live region, which is invalid inside
  a `role="menu"` at any depth. Wrapping it in `role="group"` — a role a menu is allowed to
  own — does not clear it. Clearing it needs either a Popover panel, which is the correct shape
  but costs the roving arrow-key focus that is the reason this is a menu, or an `EmptyState`
  that can render without its status role. `apps/web/e2e/dialogs.spec.ts` asserts the exact
  violation, so a new one fails the suite and fixing this one does too.
- **`exactOptionalPropertyTypes` is off in `apps/web`.** Turning it on costs 78 errors, mostly
  react-hook-form and Radix prop spreads where an optional prop passes through as
  possibly-undefined. The other three strict flags from `tsconfig.base.json` are on. Re-measure
  before starting — the number is the size of the job:
  `pnpm --filter @skillwright/web exec tsc -p tsconfig.json --noEmit --exactOptionalPropertyTypes`.
- **One web test is timing-dependent.** `AdminUsers.tsx` reports different coverage across
  identical runs, which is why the web coverage thresholds are pinned to the bottom of the
  observed range rather than the top.
- **Three legacy credentials need rotating.** The old `.env` held live Neon, Gmail and
  Cloudinary secrets. It was never committed — verified across all 132 commits — and now lives
  outside the repository, but the credentials themselves are still valid.

---

## Deliberately not being done

Recorded so they are not rediscovered as ideas.

- Assignments, grading, quizzes. Permanently out of scope — see
  `docs/rebuild/00-REBUILD-PLAN.md` §7.
- Payments, AI features, microservices. Same.
- Realtime chat depth — sequence numbers, backfill, presence. The highest-value remaining
  feature and the most expensive; it stays parked until it is chosen deliberately.
- Deleting `backend/` and `frontend/`. They go when the rebuild replaces them, not before;
  `scripts/check-brand.ts` excludes them and reports the count until then.

---

## About this file

One task at the top, concrete enough to start without a decision. It is not the backlog —
`docs/rebuild/00-REBUILD-PLAN.md` is that. It is updated before stopping rather than on
returning, because the version written while the context is still loaded is the useful one.
[`docs/PROGRESS.md`](docs/PROGRESS.md) is the dated log of what actually happened.
