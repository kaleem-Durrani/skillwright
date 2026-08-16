# Next

**Build the courses module in `apps/api/src/modules/courses` — `GET /api/v1/courses` paginated and policy-filtered, `POST /api/v1/courses`, and `PATCH /api/v1/courses/:id` guarded by `assertCan(actor, 'course:update', subject)` — then add `apps/api/test/courses.test.ts` asserting that a teacher cannot update another teacher's course.**

---

## Why this file exists

This project is built in evenings. The gap between two sessions is sometimes a day and sometimes six weeks, and the expensive part of a six-week gap is never the code — it is the twenty minutes of re-reading your own repository to work out what you were in the middle of and what you had already decided.

One sentence at the top of this file removes that cost. It is the first thing to read on returning and the last thing to update before stopping.

**Rules:**

- One task. Not a backlog — `docs/rebuild/00-REBUILD-PLAN.md` is the backlog.
- Concrete enough to start without a decision: name the file, name the function, name the test that turns green.
- Update it _before_ you stop, not when you next start. The version written while the context is still loaded is the useful one.

## Where things stand

**Done:** the monorepo and Docker Compose stack; the Prisma schema with both migrations; `@skillwright/shared` (policy, Zod DTOs, brand) with the policy matrix green; the API's plugin layer (auth, CSRF, errors, logging, Prisma, Redis, rate limit) and the auth module including TOTP; the web design system and app shell; the CI pipeline with the brand check, the mobile-first check, the contract-drift job and the generated permission matrix; the eight ADRs.

**Not started:** courses, enrollments, resources, announcements, comments, conversations, uploads, notifications — and every screen that renders them.

**Green — observed passing, not assumed:** `pnpm install` · `db:generate` · `typecheck` (5/5) · `build` (3/3) · `lint` (3/3) · `format:check` · `check:brand` · `check:mobile-first` · 577 policy tests (44 actions, 194 hand-written cells, 484 generated, 678 decisions proved).

**Never executed — no runtime evidence at all:** the API itself, both migrations, the seed, the audit extension, TOTP encryption, the Dockerfile, both CI workflows. Migration 0001 _was_ verified structurally against Prisma's own canonical DDL (295 vs 294 facts, 0 missing, 0 extra); migration 0002 has been read but never run.

## Before anything else runs

Docker Desktop is not running, so nothing touching Postgres, Redis, MinIO or Mailpit has ever executed. Start it, then:

```bash
pnpm infra:up
pnpm db:deploy   # first ever execution of migrations 0001 + 0002
pnpm db:seed
pnpm --filter @skillwright/api test   # 16 auth tests, all currently unverified
```

Postgres publishes on **5433**, not 5432 — a local Postgres install already owns 5432 on this machine.

## Known conflicts to resolve

- **`Resource` delete deadlock.** `Resource.uploadId` is `onDelete: SetNull`, but migration 0002 adds `CHECK (num_nonnulls("uploadId","externalUrl") = 1)`. Deleting an `Upload` that backs a resource nulls the column, the CHECK fails, and the DELETE aborts — so `SetNull` behaves as `Restrict` with a confusing error. Make the FK `Restrict` (honest) or relax the CHECK.
- **Docker `dist` contract.** `apps/api` is `noEmit` + `tsx` because `shared`/`db` publish TypeScript source, but the `Dockerfile` `CMD` expects `node dist/main.js`.
- **MFA enrolment UI is a stub.** `Settings.tsx` calls `/auth/mfa/enroll` and throws the response away — no QR rendered, `/auth/mfa/activate` never called, recovery codes never shown. Marked `TODO(mfa-ui)`.

## Credentials

The legacy `.env` held live Neon, Gmail and Cloudinary secrets. It was never committed (verified across all 132 commits) and now lives at `C:\Users\Legion\millat-legacy-secrets.env.txt`, outside this repo. **Those three still need rotating.**

## Parked

Things deliberately not being done, recorded so they are not rediscovered as ideas:

- Assignments, grading, quizzes. Out of scope, permanently — see `docs/rebuild/00-REBUILD-PLAN.md` §7.
- Payments, AI features, microservices. Same.
- Deleting `backend/` and `frontend/`. They go when the rebuild replaces them, not before; `scripts/check-brand.ts` excludes them and reports the count until then.
