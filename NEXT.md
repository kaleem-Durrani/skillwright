# Next

**Build uploads and `GET /resources/:id/download`, then drive golden path 3 — the last one never exercised, and the only one that is about security rather than workflow.** The path is: a teacher uploads a resource, an enrolled student downloads it, a non-enrolled student gets 403, **and the raw unsigned object URL 403s too**. That last clause is the point: it is the one assertion in this repository that the object store, not just the policy layer, refuses an unauthorised read. `upload:presign` and `upload:commit` are already in the policy matrix, `docs/permissions.md` documents them, the `Upload` model exists and the seed already writes upload-backed resources — so the missing pieces are the presign/commit endpoints, the download redirect behind `resource:download` (anonymous `deny`, deliberately narrower than `resource:read`), and MinIO wiring that is already running in Compose.

Two things this will force, both recorded below and neither decidable without it: the **`Resource.uploadId` SetNull-vs-CHECK deadlock**, which bites on the first `Upload` delete and has never happened; and the **Download button in `CourseDetail.tsx`**, which renders today behind `policy.can('resource:download', …)` with no `onClick` at all. Creating a resource from the UI arrives with this work, because uploading is how a resource gets created — the LINK-only form is not worth building twice.

---

## Why this file exists

This project is built in evenings. The gap between two sessions is sometimes a day and sometimes six weeks, and the expensive part of a six-week gap is never the code — it is the twenty minutes of re-reading your own repository to work out what you were in the middle of and what you had already decided.

One sentence at the top of this file removes that cost. It is the first thing to read on returning and the last thing to update before stopping.

**Rules:**

- One task. Not a backlog — `docs/rebuild/00-REBUILD-PLAN.md` is the backlog.
- Concrete enough to start without a decision: name the file, name the function, name the test that turns green.
- Update it _before_ you stop, not when you next start. The version written while the context is still loaded is the useful one.

## Where things stand

**Done and _running_:** the monorepo and the Compose stack; both migrations; the seed; `@skillwright/shared`; the API's plugin layer, auth with TOTP, and **ten modules** — departments, courses, enrollments, users, conversations, notifications, dashboard, admin, audit-events and now resources; the web design system, app shell and every screen.

**Not started:** announcements, comments and uploads — API and UI both. Resources have no create/edit/delete UI: `POST`, `PATCH` and `DELETE /resources` are reachable only by an API client. Realtime (socket.io) and BullMQ jobs are wired as dependencies but no code uses them yet.

**Green — observed passing on 2026-08-23, not assumed:** **four of the five golden paths have been driven end to end.** Path 1 register → verify → login; path 2 browse → request → **teacher approves** → seated, plus reject with its mandatory reason; path 5 **admin suspends → the victim's next navigation lands on /login**; and path 4's rule — one teacher acting on another's course — probed from a second teacher's session, where approve, reject, update, delete and list-enrolments all `403` naming `TEACHER:ownsCourse` while reading the published course stays `200`. **Path 3 is the only one left**, and it is the task at the top of this file. The app has been driven as a student, a teacher and an admin, light and dark, at 390px and 1280px. **axe: zero violations** across six screens in both themes — including the teacher-only Students roster and the Resources tab — with one known Radix false positive when an overlay is open (`aria-hidden-focus` on `#root`, which Radix's own modal scoping sets while focus is trapped). Plus `typecheck` 5/5 · `lint` 3/3 · `build` 3/3 · **863 tests** (592 policy + 262 API + 9 web) · `format:check` · `check:brand` · `check:mobile-first` · `docs:permissions --check`.

**Still never executed:** the `Dockerfile` and both CI workflows. Everything else in this repository has now run at least once.

## Starting a session

```bash
pnpm infra:up     # Postgres, Redis, MinIO, Mailpit — exits 0 when all four are healthy
pnpm dev          # infra:up, then turbo dev across api + web
```

Postgres publishes on **5433**. Redis is on **6381** and MinIO on **9002/9003** _on this machine only_ — other projects' containers own the defaults and auto-start with Docker Desktop. The overrides live in the gitignored `.env`; `docker-compose.yml` defaults to the standard ports for anyone else. Mailpit's inbox is at http://localhost:8025.

Tests run against a separate `skillwright_test` database, derived automatically from `DATABASE_URL`. The fixture **refuses to start** against any database whose name does not end in `_test`, because it deletes every user and department between files.

## Known conflicts to resolve

- **`Resource` delete deadlock.** `Resource.uploadId` is `onDelete: SetNull`, but migration 0002 adds `CHECK (num_nonnulls("uploadId","externalUrl") = 1)`. Deleting an `Upload` that backs a resource nulls the column, the CHECK fails, and the DELETE aborts — so `SetNull` behaves as `Restrict` with a confusing error. Make the FK `Restrict` (honest) or relax the CHECK. **Both migrations now apply cleanly, so this is a runtime conflict only — it bites on the first `Upload` delete, which has not happened yet.**
- **Docker `dist` contract.** `apps/api` is `noEmit` + `tsx` because `shared`/`db` publish TypeScript source, but the `Dockerfile` `CMD` expects `node dist/main.js`. The image has still never been built.
- **MFA enrolment UI is a stub.** `Settings.tsx` calls `/auth/mfa/enroll` and throws the response away — no QR rendered, `/auth/mfa/activate` never called, recovery codes never shown. Marked `TODO(mfa-ui)`. The API side is proven: the TOTP enrol → activate → gated login → disable test passes.
- **`packages/db/.env.example` still says port 5432** while everything else says 5433. A fresh clone that copies it connects to the wrong Postgres.
- **`apps/web/tsconfig.json` does not extend `tsconfig.base.json`.** It redeclares every option and sets `exactOptionalPropertyTypes: false`, omitting `noUncheckedIndexedAccess` — so the workspace with the most code is the one not held to the repo's strict standard. Closing it is a decision, not a defect; measure the fallout first.
- **`role="none"` around the panel's empty/loading states does not do what it looks like.** Presentation/none re-parents its children to the menu, so the non-menuitem content is still owned by `role="menu"`. The correct fix is a Radix Popover for a panel whose content is not a list of verbs — deferred because it costs the roving focus.
- **Parallel agents must not share `skillwright_test`.** `apps/api/vitest.config.ts` serialises files within ONE vitest process (`singleFork`), which says nothing about two processes: two runs at once leave rows behind, `resetDatabase()` then dies on a `StudentProfile` Restrict FK, and every later suite fails at `signIn`. Give each worker its own database — `test/setup.ts` reads `TEST_DATABASE_URL` first and refuses any name not ending in `_test`, so `skillwright_a_test` works and `skillwright_test_a` is rejected. `skillwright_a_test` and `skillwright_b_test` exist and are migrated.
- **There is no way to reinstate a suspended account.** No `user:reinstate` action, no endpoint — `users.routes.ts:169-176` records the omission as deliberate. The suspend dialog used to promise otherwise and now says undoing it takes a database change. Building it costs a policy action, its matrix rows including the denials, and a regenerated `docs/permissions.md` (CONTRIBUTING.md:40-46).
- **Every login writes two audit rows** — a `LOGIN` and an `UPDATE User` with a **null actor**, the second from the extension picking up the `lastLoginAt` write. Harmless, but it doubles the volume of the table the audit screen reads and an actorless UPDATE is noise in a log whose purpose is attribution.
- **`apps/web/src/lib/api.ts` hand-declares `PaginationMeta`, `Paginated<T>` and `CursorPage<T>`** while `packages/shared/src/schema/pagination.ts` defines them. `CursorPage<T>` is wrong — it says `{ data, nextCursor }`, the wire sends `{ data, meta: { nextCursor, hasMore } }`. Nothing imports it yet, so it is a trap rather than a live bug.

## Credentials

The legacy `.env` held live Neon, Gmail and Cloudinary secrets. It was never committed (verified across all 132 commits) and now lives at `C:\Users\Legion\millat-legacy-secrets.env.txt`, outside this repo. **Those three still need rotating.**

## Parked

Things deliberately not being done, recorded so they are not rediscovered as ideas:

- Assignments, grading, quizzes. Out of scope, permanently — see `docs/rebuild/00-REBUILD-PLAN.md` §7.
- Payments, AI features, microservices. Same.
- Deleting `backend/` and `frontend/`. They go when the rebuild replaces them, not before; `scripts/check-brand.ts` excludes them and reports the count until then.
