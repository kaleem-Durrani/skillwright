# Next

**Build the create-resource form in `CourseDetail.tsx`, so a teacher can add course material without an API client.** Everything underneath it now exists and is driven: `POST /uploads/presign` → PUT → `POST /uploads/commit` → `POST /resources`, plus `PATCH` and a soft `DELETE`. Nothing on any screen calls the first four. The Resources tab's empty state used to offer an "Add a resource" button wired to `() => undefined`; it was removed rather than left lying, so today the feature is complete and unreachable.

The flow is settled by the API and needs no design work: `presignUploadSchema` already carries the per-purpose MIME and size limits (`UPLOAD_LIMITS`, upload.ts:36-44), the signed PUT now pins **both** content type and length so the store refuses a mismatch, and `createResourceSchema.superRefine` already enforces exactly-one-of `uploadId`/`externalUrl`. So the form is: a title, an optional description, a type, a public/private toggle, and either a file picker or a URL field. Show the size and type limits before the picker rather than after the 422, and remember that a LINK resource needs no upload at all.

While you are in there: the Resources tab still has no edit or delete affordance either, and `resource:update` / `resource:delete` are `ownsCourse` — a row menu on the teacher's own course is the natural home for both.

---

## Why this file exists

This project is built in evenings. The gap between two sessions is sometimes a day and sometimes six weeks, and the expensive part of a six-week gap is never the code — it is the twenty minutes of re-reading your own repository to work out what you were in the middle of and what you had already decided.

One sentence at the top of this file removes that cost. It is the first thing to read on returning and the last thing to update before stopping.

**Rules:**

- One task. Not a backlog — `docs/rebuild/00-REBUILD-PLAN.md` is the backlog.
- Concrete enough to start without a decision: name the file, name the function, name the test that turns green.
- Update it _before_ you stop, not when you next start. The version written while the context is still loaded is the useful one.

## Where things stand

**Done and _running_:** the monorepo and the Compose stack; all three migrations; the seed; `@skillwright/shared`; the API's plugin layer, auth with TOTP, and **eleven modules** — departments, courses, enrollments, users, conversations, notifications, dashboard, admin, audit-events, resources and uploads; the web design system, app shell and every screen.

**Not started:** announcements and comments — API and UI both. Resources have no create, edit or delete UI: those three endpoints are reachable only by an API client. Realtime (socket.io) and BullMQ jobs are wired as dependencies but no code uses them yet, which is also why nothing sweeps abandoned uploads.

**Green — observed passing on 2026-08-23, not assumed: all five golden paths have now been driven end to end.** Path 1 register → verify → login. Path 2 browse → request → **teacher approves** → seated, plus reject with its mandatory reason. Path 3 **teacher uploads a real file → enrolled student downloads the exact bytes → non-enrolled student 403 → and the raw unsigned object URL 403s** — the only assertion here that the object store itself refuses an unauthorised read rather than the policy layer refusing on its behalf. Path 4's rule, one teacher acting on another's course, probed from a second teacher's session: approve, reject, update, delete and list-enrolments all `403` naming `TEACHER:ownsCourse`, while reading the published course stays `200`. Path 5 **admin suspends → the victim's next navigation lands on /login**. The app has been driven as a student, a teacher and an admin, light and dark, at 390px and 1280px. **axe: zero violations** across six screens in both themes, with one known Radix false positive when an overlay is open (`aria-hidden-focus` on `#root`, set by Radix's own modal scoping while focus is trapped). Plus `typecheck` 5/5 — **now including the API test suite, which it had never looked at** — `lint` 3/3 · `build` 3/3 · **903 tests** (600 policy + 294 API + 9 web) · `format:check` · `check:brand` · `check:mobile-first` · `docs:permissions --check`.

**Still never executed:** the `Dockerfile` and both CI workflows. Everything else in this repository has now run at least once.

## Starting a session

```bash
pnpm infra:up     # Postgres, Redis, MinIO, Mailpit — exits 0 when all four are healthy
pnpm dev          # infra:up, then turbo dev across api + web
```

Postgres publishes on **5433**. Redis is on **6381** and MinIO on **9002/9003** _on this machine only_ — other projects' containers own the defaults and auto-start with Docker Desktop. The overrides live in the gitignored `.env`; `docker-compose.yml` defaults to the standard ports for anyone else. Mailpit's inbox is at http://localhost:8025.

Tests run against a separate `skillwright_test` database, derived automatically from `DATABASE_URL`. The fixture **refuses to start** against any database whose name does not end in `_test`, because it deletes every user and department between files.

## Known conflicts to resolve

- **Nothing sweeps the object bucket.** An `Upload` row is created at presign and only becomes `COMMITTED` when the bytes are confirmed; abandoned rows and their objects are never removed, and `uploads.service.ts` names `@@index([status, createdAt])` as the index the job would use. The test suites make this visible: they write into the same MinIO bucket as development, so it holds 83 objects backing two live resources. A sweeper needs BullMQ, which is a dependency nothing uses yet.
- **Presigned PUTs outlive `commit`.** A PUT URL is valid for 15 minutes and SigV4 carries no nonce, so the `HeadObject` checkpoint is a time-of-check/time-of-use gap: a caller can commit, have the bytes verified and the resource published, and then re-PUT different bytes of the same length and type at the same key until the signature expires. Closing it means making the verified object immutable — record the ETag at commit and re-check it in `buildDownloadUrl`, at the cost of a `HeadObject` on every download, or copy the object to a final key at commit. That is a real trade and belongs to whoever owns the storage bill.
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
