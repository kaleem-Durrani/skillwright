# Next

**Render the app against the live API and walk the five golden paths by hand.** Start `pnpm dev`, sign in as `demo.student@skillwright.dev` / `demo-password-123`, and confirm each screen actually paints: catalogue with enrolment badges, course detail, messages (send one — that path was a 422 until today), notifications, settings save, and the admin console as `demo.admin@skillwright.dev`. Everything below is proved by tests and by `curl`; **no screen of this app has ever been rendered against a real API.** Write down what breaks before building anything new.
---

## Why this file exists

This project is built in evenings. The gap between two sessions is sometimes a day and sometimes six weeks, and the expensive part of a six-week gap is never the code — it is the twenty minutes of re-reading your own repository to work out what you were in the middle of and what you had already decided.

One sentence at the top of this file removes that cost. It is the first thing to read on returning and the last thing to update before stopping.

**Rules:**

- One task. Not a backlog — `docs/rebuild/00-REBUILD-PLAN.md` is the backlog.
- Concrete enough to start without a decision: name the file, name the function, name the test that turns green.
- Update it _before_ you stop, not when you next start. The version written while the context is still loaded is the useful one.

## Where things stand

**Done and _running_:** the monorepo and the Compose stack; both migrations; the seed; `@skillwright/shared`; the API's plugin layer, auth with TOTP, and **all nine modules** the SPA calls — departments, courses, enrollments, users, conversations, notifications, dashboard, admin, audit-events; the web design system, app shell and every screen, now compiling against the shared schemas rather than hand-written guesses.

**Not started:** resources, announcements, comments and uploads — API and UI both. Realtime (socket.io) and BullMQ jobs are wired as dependencies but no code uses them yet.

**Green — observed passing on 2026-08-16, not assumed:** `infra:up` · `db:deploy` · `db:seed` · API boot with `/readyz` green · live catalogue, department, enrolment, conversation, notification, dashboard, admin and audit reads against the seeded database, as both a student and an admin · a live anonymous registration · a credential scan across every endpoint returning clean · `typecheck` 5/5 · `lint` 3/3 · `build` 3/3 · **816 tests** (592 policy + 215 API + 9 web), including 200 concurrent approvals seating exactly 30 · `format:check` · `check:brand` · `check:mobile-first` · `docs:permissions --check`.

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
- **`apps/web/src/lib/api.ts` hand-declares `PaginationMeta`, `Paginated<T>` and `CursorPage<T>`** while `packages/shared/src/schema/pagination.ts` defines them. `CursorPage<T>` is wrong — it says `{ data, nextCursor }`, the wire sends `{ data, meta: { nextCursor, hasMore } }`. Nothing imports it yet, so it is a trap rather than a live bug.

## Credentials

The legacy `.env` held live Neon, Gmail and Cloudinary secrets. It was never committed (verified across all 132 commits) and now lives at `C:\Users\Legion\millat-legacy-secrets.env.txt`, outside this repo. **Those three still need rotating.**

## Parked

Things deliberately not being done, recorded so they are not rediscovered as ideas:

- Assignments, grading, quizzes. Out of scope, permanently — see `docs/rebuild/00-REBUILD-PLAN.md` §7.
- Payments, AI features, microservices. Same.
- Deleting `backend/` and `frontend/`. They go when the rebuild replaces them, not before; `scripts/check-brand.ts` excludes them and reports the count until then.
