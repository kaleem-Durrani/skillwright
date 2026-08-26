# Next

**Go to B5 — the ship gate. Nothing in it has been started, and it is the only work that turns this into a link you can send someone.** In order: make the `Dockerfile` actually build (it has never been run, and `apps/api` is `noEmit` + `tsx` while the `CMD` expects `node dist/main.js` — that contract has to be settled first); make CI actually run (`.github/workflows/ci.yml` was committed in September 2025 and has never executed); deploy; then README v1 with the live link above the fold, the screenshots script, favicon and OG image, and the backup rehearsal.

The plan calls B5 "the real finish line" and gates it 🚩. Everything before it is unverified in the one way that counts: no clean-clone reproduction on a second machine, no deployed URL, no CI run.

Phase 5 of the UI roadmap (`docs/ui-roadmap/05-DEFERRED-FEATURES.md`) has landed its five deferred features — account reinstate, the three notification enum debts, the MFA enrolment screen, presigned-PUT immutability, upload progress. Admin CRUD for departments and courses, the last B4 item, shipped during the feature roadmap (`AdminDepartments.tsx`, `AdminCourses.tsx`, `CourseFormDialog`).

---

## Why this file exists

This project is built in evenings. The gap between two sessions is sometimes a day and sometimes six weeks, and the expensive part of a six-week gap is never the code — it is the twenty minutes of re-reading your own repository to work out what you were in the middle of and what you had already decided.

One sentence at the top of this file removes that cost. It is the first thing to read on returning and the last thing to update before stopping.

**Rules:**

- One task. Not a backlog — `docs/rebuild/00-REBUILD-PLAN.md` is the backlog.
- Concrete enough to start without a decision: name the file, name the function, name the test that turns green.
- Update it _before_ you stop, not when you next start. The version written while the context is still loaded is the useful one.

## Where things stand

**Done and _running_:** the monorepo and the Compose stack; all eight migrations; the seed; `@skillwright/shared`; the API's plugin layer, auth with TOTP, and **thirteen modules** — departments, courses, enrollments, users, conversations, notifications, dashboard, admin, audit-events, resources, uploads, announcements and comments; the web design system, app shell and every screen. Resources are complete end to end, and announcements and threaded comments now have both an API and a UI. Admin CRUD covers users, departments and courses. Abandoned uploads are swept on a timer (`uploads.sweeper.ts` — a plain `setInterval`, not BullMQ), enrolment CSV exports ship (`exports.test.ts`), ranked search runs on the trgm indexes, and the audit screen has its forensics dialog. Suspended accounts can be reinstated (`POST /users/:id/reinstate`, `user:reinstate`); committed uploads are immutable (the presigned PUT writes to a `_pending/` staging key that `commit` verifies and server-side-copies onto the final key); the MFA enrolment screen shows its QR, confirms a code and reveals recovery codes once; file uploads report real byte progress through `xhr.upload.onprogress`; and withdrawal, course-publish and top-level-comment events all ring someone.

**Not started:** realtime (socket.io) is wired as a dependency but no code uses it.

**Green — observed passing on 2026-08-25, not assumed:** all five golden paths were driven end to end on 2026-08-23 (the app as a student, a teacher and an admin, light and dark, at 390px and 1280px; **axe: zero violations** across nine screens in both themes, one known Radix false positive when an overlay is open). Verified fresh today: **1319 tests** (656 policy + 485 API + 178 web), `typecheck` clean in all four workspaces, `lint` clean in shared + api + web/src, `build` clean for api + web, `check:brand`, `check:mobile-first`, `docs:permissions --check`, and a from-scratch `migrate deploy` through 0008. One environmental caveat: `turbo run typecheck/build` re-runs `prisma generate` first, and on this machine that step currently fails with EPERM renaming `query_engine-windows.dll.node` — a long-running process has the engine mapped. The checked-in generated client is current (everything downstream of it compiles and passes); run the package scripts directly until whatever holds the DLL exits.

**Still never executed:** the `Dockerfile` and both CI workflows. Everything else in this repository has now run at least once.

## Starting a session

```bash
pnpm infra:up     # Postgres, Redis, MinIO, Mailpit — exits 0 when all four are healthy
pnpm dev          # infra:up, then turbo dev across api + web
```

Postgres publishes on **5433**. Redis is on **6381** and MinIO on **9002/9003** _on this machine only_ — other projects' containers own the defaults and auto-start with Docker Desktop. The overrides live in the gitignored `.env`; `docker-compose.yml` defaults to the standard ports for anyone else. Mailpit's inbox is at http://localhost:8025.

Tests run against a separate `skillwright_test` database, derived automatically from `DATABASE_URL`. The fixture **refuses to start** against any database whose name does not end in `_test`, because it deletes every user and department between files.

## Known conflicts to resolve

- **Docker `dist` contract.** `apps/api` is `noEmit` + `tsx` because `shared`/`db` publish TypeScript source, but the `Dockerfile` `CMD` expects `node dist/main.js`. The image has still never been built.
- **`packages/db/.env.example` still says port 5432** while everything else says 5433. A fresh clone that copies it connects to the wrong Postgres.
- **`apps/web/tsconfig.json` does not extend `tsconfig.base.json`.** It redeclares every option and sets `exactOptionalPropertyTypes: false`, omitting `noUncheckedIndexedAccess` — so the workspace with the most code is the one not held to the repo's strict standard. Closing it is a decision, not a defect; measure the fallout first.
- **`role="none"` around the panel's empty/loading states does not do what it looks like.** Presentation/none re-parents its children to the menu, so the non-menuitem content is still owned by `role="menu"`. The correct fix is a Radix Popover for a panel whose content is not a list of verbs — deferred because it costs the roving focus.
- **Parallel agents must not share `skillwright_test`.** `apps/api/vitest.config.ts` serialises files within ONE vitest process (`singleFork`), which says nothing about two processes: two runs at once leave rows behind, `resetDatabase()` then dies on a `StudentProfile` Restrict FK, and every later suite fails at `signIn`. Give each worker its own database — `test/setup.ts` reads `TEST_DATABASE_URL` first and refuses any name not ending in `_test`, so `skillwright_a_test` works and `skillwright_test_a` is rejected. `skillwright_a_test` and `skillwright_b_test` exist and are migrated.
- **Every login writes two audit rows** — a `LOGIN` and an `UPDATE User` with a **null actor**, the second from the extension picking up the `lastLoginAt` write. Harmless, but it doubles the volume of the table the audit screen reads and an actorless UPDATE is noise in a log whose purpose is attribution.
- **`apps/web/src/lib/api.ts` hand-declares `PaginationMeta`, `Paginated<T>` and `CursorPage<T>`** while `packages/shared/src/schema/pagination.ts` defines them. `CursorPage<T>` is wrong — it says `{ data, nextCursor }`, the wire sends `{ data, meta: { nextCursor, hasMore } }`. Nothing imports it yet, so it is a trap rather than a live bug.

## Credentials

The legacy `.env` held live Neon, Gmail and Cloudinary secrets. It was never committed (verified across all 132 commits) and now lives at `C:\Users\Legion\millat-legacy-secrets.env.txt`, outside this repo. **Those three still need rotating.**

## Parked

Things deliberately not being done, recorded so they are not rediscovered as ideas:

- Assignments, grading, quizzes. Out of scope, permanently — see `docs/rebuild/00-REBUILD-PLAN.md` §7.
- Payments, AI features, microservices. Same.
- Deleting `backend/` and `frontend/`. They go when the rebuild replaces them, not before; `scripts/check-brand.ts` excludes them and reports the count until then.
