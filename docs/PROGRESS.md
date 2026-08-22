# Progress

What has actually happened, newest first. One or two lines per entry, dated.

This file records **what changed and the state it left the repository in** — not what is planned. `docs/rebuild/00-REBUILD-PLAN.md` is the backlog and `NEXT.md` is the single next task. Entries carry their verification status, because _written_ and _observed passing_ are different facts:

- **verified** — a command was run and its output was read.
- **written** — the code exists and has never executed.

---

## 2026-08-22

**The last two golden paths were driven, and both work.** _(verified — Playwright against the compose stack, seeded data)_
A teacher signed in, opened the enrolment queue from their dashboard, and **approved one request (`200`) and rejected another with a mandatory reason (`200`)**. The roster rows flipped to Approved and Rejected with today's date, the course header moved from 13/20 places to 14/20, and the queue on the dashboard shrank by two. The reject dialog's `min(4)` gate holds from the UI side: the confirm button is disabled on an empty box and still disabled at three characters. axe on the teacher-only Students tab — a screen no previous run could reach — reports **zero violations**. Then an admin suspended a live student: `200`, the row flipped to Suspended, the audit log carries a `SUSPEND` event against the admin's name, and every session row for that account was destroyed.

**The ownership boundary was probed directly and holds.** _(verified — from inside a second teacher's authenticated session)_
Teacher B against teacher A's course: approve, reject, update, delete and list-enrolments were all refused **403 with `TEACHER:ownsCourse`** named in the detail; reading the published course is `200`, which is the `isPublished` row doing its job rather than a leak. Teacher B's view of that course carries no Students tab and no Approve button. This is golden path 4's rule — the path as written in Appendix D needs the resources module, which does not exist yet.

**A suspended session kept browsing a fully-populated app.** _(verified — reproduced, fixed, re-driven)_
Revocation is retroactive on the server and was invisible on the client. The suspended student's Settings screen `401`d and rendered an inline "we could not load you" **under a shell that still said "Student workspace", beside a profile card that still said "Active"** — and clicking Dashboard from there issued **no requests at all** and painted a complete dashboard from cache. `requireAuth` already knew how to bounce a dead session, but it reads the session through `ensureQueryData` and that entry was still cached and still fresh, so the guard kept re-answering with the old user. The query client now watches every query and mutation for `UNAUTHENTICATED` / `ACCOUNT_SUSPENDED`, drops the session entry and everything fetched under it, and re-runs the router's guards — no second opinion about where a dead session belongs. Re-driven: the next navigation lands on `/login?redirect=%2Fsettings` with the shell gone.

**A suspended person was told "You don't have access to that."** _(verified — now reads "This account has been suspended.")_
The SPA renders errors from the **code**, never the detail, because policy details carry rule names like `TEACHER:ownsCourse` and are not user copy. Login threw the generic `forbidden()` with the right sentence in the wrong field, so `ERROR_COPY.ACCOUNT_SUSPENDED` — written for exactly this case — had never once been rendered. `auth.plugin.ts` was already throwing `accountSuspended()`; login and verify-email now match it.

**The bodyless-POST trap was still live on two routes.** _(verified — 422 reproduced, then 403)_
Fastify hands a POST with no body to the validator as `null`, and an all-optional object schema rejects it — so a teacher who was never entitled to an enrolment got `422 VALIDATION_FAILED` from `/enrollments/:id/approve` instead of `403`, because validation runs before the policy preHandler. The same call carrying `{}` was correctly refused, which is exactly why no test caught it. `approve` and `withdraw` now bind `.nullish()`, matching the three routes where this was already fixed. Two regression tests send **no body deliberately**.

**The suspend dialog promised something the system cannot do.** _(verified against the route file)_
It read "This is reversible — an administrator can reinstate the account later." There is no `user:reinstate` action and no endpoint; `users.routes.ts` records the omission as deliberate. Building one costs a policy action, its matrix rows including the denials, and a regenerated `docs/permissions.md`, so the dialog now says what is true: undoing it takes a database change.

**Two defects I reported to myself and withdrew.** _(verified — both were my measurement, not the app)_
The dashboard appeared to show "Pending requests 0" above a queue of four; the tile actually reads **4**, and my regex over `innerText` had walked past the label into the _next_ tile's value. And toasts appeared to have no live region — there is one, `span[aria-live="assertive"][role="status"]`, but Radix unmounts it about a second after the toast opens and I sampled at 1.3s. Sampling across the whole window found it every time.

**Green — observed on 2026-08-22:** **819 tests** (592 policy + 218 API + 9 web) · typecheck 5/5 · lint 3/3 · build 3/3 · `format:check` · `check:brand` · `check:mobile-first` · `docs:permissions --check`.

**Still open:** `GET /courses/:id/resources` 404s on every course-detail view because the resources module does not exist, so a normal navigation logs console errors and the Resources tab falls back to the not-enrolled empty state — which tells a _teacher_ looking at a colleague's course to "request enrolment above", next to a button their role can never have. The dashboard meanwhile counts 23 resources for that same teacher.

---

## 2026-08-17

**The app was rendered in a browser for the first time, and it works.** _(verified — driven with Playwright as a student and an admin, light and dark, 390px and 1280px)_
Login, dashboard, catalogue, course detail, messages, settings and the admin console all paint against real seeded data. No stuck skeletons anywhere — the subject-free `can()` guards fixed yesterday were the reason two screens would have hung forever. The mobile viewport renders cards with a bottom tab bar and the desktop one renders a table, which is the "table is the enhancement" rule working rather than being asserted. The three mutations that were 422s for every user until yesterday were exercised end to end from the browser: **request enrolment `201`**, **send message `201`**, **save profile `200`** with a "saved" toast. The catalogue shows a `Pending` badge on the course the request had just created.

**The dev proxy pointed at a port nothing listens on.** _(verified — this blocked every screen)_
`vite.config.ts` proxied `/api` to `localhost:3000` while the API defaults to `PORT=4000` and both `.env` files say 4000. No test could see it: the integration suite calls the API directly and the SPA's tests mock the client, so the dev proxy is exercised only by a human with a browser. It now derives the target from the same `.env` the API boots with.

**The primary button had inverted the design brief's signature decision.** _(verified — zero axe violations after the fix, both themes)_
`02-design-direction.md` chose Direction A and justified it on one claim: _"the amber-with-dark-text primary button… an 8.5:1 contrast ratio, so it's more accessible than white-on-blue… most education products fight a 3.2:1 white-on-blue button their entire life."_ Its token block says `--text-on-brand: var(--iron-950)`. The implementation shipped `#ffffff`, giving **3.99:1** — the exact failure the direction was chosen to avoid. Restored to dark-on-amber. The first attempt also moved the fill to ember-500 for a better 5.67:1 on the ink — and a reviewer caught that this dropped the button's own edge against the page to 2.98:1, under the 3:1 WCAG 1.4.11 needs for an unbordered filled control. ember-600 is the only shade clearing both at rest (ink 4.54:1, edge 3.72:1), so the fill went back and only the ink changed. Interaction states brighten rather than darken, because under dark ink darkening cuts contrast. `--text-secondary` and `--text-tertiary` each moved down a step so three levels stay distinct and all clear AA, and the dark-mode overlay moved to iron-900 because tertiary text on iron-800 was 4.18:1.

**An honest a11y number required disabling animation.** _(verified)_
axe first reported ~40 contrast violations including impossible ones — 1.12:1 between colours nobody chose. It was sampling elements mid-fade. Measured with `reducedMotion: 'reduce'` after settle, the real count was **one**, and fixing it took the four main screens to **zero violations in both light and dark**.

**Still open:** the notification bell is a live unread badge on a control with no `onClick` and no link, and there is no notifications route for it to open.

---

## 2026-08-16

**The API is feature-complete for the SPA's calls, and the SPA now matches it.** _(verified — 816 tests, plus live calls against the seeded database)_
The remaining six modules landed — users, conversations, notifications, dashboard, admin, audit-events — and all nine are registered. `apps/api/src/lib/dto.ts` lifted the `toUserSummary`/`toDepartmentSummary`/`toCourseSummary` triplicate out of three services so `seatsRemaining` has one derivation. `GET /courses` gained a `courseListItemSchema` carrying `description` and `viewerEnrollmentStatus`, resolved with **one batched query per page**; those fields could not go on `courseSummarySchema`, which is embedded as `enrollment.course` where a viewer-relative field would contradict the row's own status.

**The SPA was built against guesses, and every one of them was wrong.** _(verified — the whole app now typechecks against the shared schemas)_
`apps/web/src/lib/types.ts` re-declared twelve wire shapes; it is now a re-export barrel of `@skillwright/shared/schema`, which turned a pile of silent mismatches into honest compile errors. `Messages.tsx` minted a 16-character `clientMsgId` where the schema requires a 26-character ULID — **every message send was a 422**. Settings sent `phoneNumber: ''` where the schema requires null — **every profile save was a 422**. Register navigated to `/verify-email` with no address and no session — **email verification was impossible**, and the user was told "That code is not right".

**A permission check with no subject is an off switch, and six of them were shipped.** _(verified — reproduced, fixed, and now a compile error)_
`can()` substitutes an empty subject, and a rule that reads an absent field must deny. So `policy.can('conversation:read')` was false for **every user including admins**: used as React Query's `enabled:`, it disabled the query permanently and Messages rendered a skeleton forever. The same on the Dashboard for courses and the enrolment queue. Worse, the nav filter gated the Courses entry on `course:read` and Messages on `conversation:read`, so **the Courses link was absent for every student and teacher and the Messages link for everyone**, and the notification bell was hidden from all users by a subject-free `notification:read`.
Two structural fixes so it cannot recur: `subject()` in `apps/web/src/lib/policy.ts` **no longer casts** — every `Subject` field is already optional, so the cast bought nothing and only suppressed the excess-property check that catches a misspelled key (`teacherId` for `courseTeacherId` had silently killed ten call sites on one screen). And `SUBJECT_INDEPENDENT_ACTIONS` is now exported from the policy module, recomputed from the rules in the matrix test so it cannot rot, and `NavItem.action` is typed to it — gating a nav entry on a subject-dependent action is now `TS2820`.

**Three more leaks closed.** _(verified)_
All 147 seeded notifications rendered blank: the schema requires `title`/`body` and the seed wrote only context keys, so every row failed `safeParse` and served empty strings. `notificationPayloadSchema` was also the one response in the system that did not strip extras — `.catchall(z.unknown())` over an unconstrained `Json` column written by other modules' side effects. And `include: { user: true }` loaded Argon2id hashes and TOTP ciphertext for every participant of every conversation page to render three fields; `toUserSummary` now takes the three columns it reads, so a narrowing `select` typechecks.

**Three API modules landed: departments, courses, enrollments.** _(verified — 90 API tests passing, plus live calls against the seeded database)_
Written by a multi-agent workflow against a contract derived from the auth module, then reviewed adversarially by three independent lenses. 12 files, ~3,260 lines, and **typecheck passed on the first compile**. Registered in `app.ts`; `GET /courses`, `/departments` and `/enrollments` now serve real seeded data, and `POST /courses/:id/enrollments` creates a row and an audit event. The suite is **676 tests** (577 policy + 90 API + 9 web); typecheck 5/5, lint 3/3, build 3/3, format, brand and mobile-first all clean.

**The no-oversell claim is now proven under load, and was broken until today.** _(verified — the failure was reproduced, then fixed)_
ADR 0006's own test — 200 concurrent approvals against a 30-seat course — seated **18, not 30**. Not a race: a connection-pool deadlock. The audit extension reads a before-image and writes its row through the un-extended client _on a second connection_, deliberately, while an interactive transaction holds its own for the whole callback. Past a pool of 29, every transaction held one connection and waited for another only a peer could release, and Prisma answered P2024. The audit extension now has **its own pool** (`auditPrisma`), so audit work never waits on a transaction and progress is guaranteed. The test seats exactly 30.

**Four more defects found by running the modules rather than reading them.** _(verified)_
`idSchema` was `z.string().cuid()` while the seed writes deterministic **ULIDs**, so every response carrying an id 500'd on demo data — invisible to tests, whose fixtures insert through Prisma and get cuids. Fastify hands a bodyless POST to the validator as `null`, which `.optional()` rejects, so the SPA's own `POST /courses/:id/enrollments` answered 422 before the policy gate ran. `authorize()` was the **only** place `MFA_PENDING` was refused, so any route deciding visibility by WHERE clause instead of subject served a half-authenticated caller everything their role could see — now gated centrally in the auth plugin's `onRequest`. And `resetDatabase()` could not survive a course existing: `Course.teacherId`, `Resource.authorId` and `Announcement.authorId` are all `Restrict`.

**The stack ran for the first time. Everything below is now observed, not assumed.** _(verified)_
Docker Desktop started; `pnpm infra:up` brought up Postgres, Redis, MinIO (private bucket created) and Mailpit, all healthy. `pnpm db:deploy` applied **both migrations on their first ever execution** — 19 tables (18 + `_prisma_migrations`), 11 enums, 29 FKs, 4 CHECKs from 0002, 92 indexes, `citext` and `pg_trgm` present. `pnpm db:seed` succeeded: 95 users, 18 courses, 290 enrollments, 400 messages, and **595 audit rows written by the client extension** — its first runtime proof. The API booted, `/readyz` reported `database: ok, redis: ok`, and a real login as `demo.student@skillwright.dev` returned a session cookie that `GET /api/v1/auth/me` accepted. **All 16 auth integration tests pass.** Full suite green: typecheck 5/5, lint 3/3, build 3/3, 602 tests (577 shared + 16 api + 9 web), format, brand and mobile-first checks clean.

**Five defects found by running things that had only ever been read.** _(verified — each reproduced, then fixed)_
`pnpm deploy` is a **built-in pnpm command**, so `db:deploy` never reached Prisma; all six `db:*` scripts now use explicit `run`. `docker compose up --wait` counts the one-shot `minio-init` exiting 0 as failure, so `infra:up` always returned 1 and `pnpm dev`'s `&&` could never fire. `LOG_LEVEL=silent` was **not in the db logger's level table** and fell through to the default, making "no output" produce the noisiest output there is. The API test suite pointed at the development database, where its `resetDatabase()` would have destroyed the seed — it now derives a `_test` database and refuses to run against anything else. `check:brand` was **already failing on the committed tree** (7 offences: 5 product-name literals in `apps/web`, a comment in `tokens.css`, an old-name path in `NEXT.md`) despite being recorded as passing.

**Host ports are now overridable.** _(verified)_
Other projects' containers auto-start with Docker Desktop and owned 9000, 9001 and 6379. `docker-compose.yml` reads `POSTGRES_PORT`/`REDIS_PORT`/`MINIO_PORT`/`MINIO_CONSOLE_PORT`/`MAILPIT_SMTP_PORT`/`MAILPIT_UI_PORT` with the standard values as defaults, so a fresh clone is unaffected; this machine overrides Redis to 6381 and MinIO to 9002/9003 in the gitignored `.env`.

**All 38 commits pushed.** _(verified)_
`COMMIT-PLAN.md` split the tree into 38 commits with explicit paths, every one reconciled against `git status` so no path was staged twice or missed. History force-pushed to `github.com/kaleem-Durrani/skillwright` over HTTPS after SSH auth failed — the only key on the machine was never registered with the account. `origin/main` is now the rewritten history; 170 commits total.

**Commit plan written; two running logs added.**
`.gitignore` gained `!docs/PROGRESS.md` and `!docs/LESSONS-LEARNED.md` so this file and its sibling are tracked; `docs/rebuild/00-REBUILD-PLAN.md` §3.1 records the convention.

**`apps/web` — design system, shell and thirteen screens.** _(written; typecheck/build/lint verified, nothing rendered against a live API)_
Vite 6 + React 19 + TanStack Router/Query. Tailwind v4 `@theme inline` tokens, 26 UI primitives, a mobile-first shell (bottom tabs → sidebar at `md`), 13 pages, a typed route tree with `beforeLoad` guards, and `Gate` running the same `can()` as the server. `Settings.tsx` MFA enrolment is a stub — marked `TODO(mfa-ui)`.

**`apps/api` — plugin layer and the auth module.** _(written; typecheck/build/lint verified, never booted)_
Fastify 5 with `fastify-type-provider-zod`. Seven plugins (Prisma, Redis, logger, errors, session auth, CSRF, two-dimensional rate limiting), RFC 9457 problem responses, and the full auth module including TOTP enrol/activate/verify/disable with AES-256-GCM secrets at rest. The 16 integration tests in `apps/api/test/auth.test.ts` **fail on database credentials and have never run against Postgres.**

**`packages/db` — schema, both migrations, audit extension, seed.** _(written; `db:generate` verified, no migration has ever executed)_
Unified `User` + `Role` model across 18 tables and 11 enums. `0001_init` was checked structurally against Prisma's own canonical DDL — 295 facts vs 294, 0 missing, 0 extra, all 29 FKs with their `onDelete`. `0002_constraints` has been read but never run. The audit client extension and the 1,154-line seed are unproven.

**`packages/shared` — brand, DTOs, policy engine.** _(verified — 577 tests observed passing)_
Policy-as-data over 44 actions with no I/O, so the same `can()` compiles server-side and in the browser. 194 hand-written matrix cells plus 484 generated ones prove 678 decisions. Zod DTOs for every API shape.

**Monorepo scaffolding stood up.** _(verified — `pnpm install`, `typecheck` 5/5, `build` 3/3, `lint` 3/3, `format:check`, `check:mobile-first` observed passing. **`check:brand` was recorded as passing here and was not**: re-running it on the untouched committed tree produced 7 offences. Corrected on 2026-08-16; see the entry at the top.)_
pnpm workspaces + Turborepo, strict shared tsconfig, prettier/editorconfig, Docker Compose (Postgres **5433**, Redis, MinIO, Mailpit), multi-stage Dockerfile, two CI workflows, three guard scripts, eight ADRs, README. **Docker Desktop has never been started, so no container in the compose file has ever run.**

**History rewritten in place.** _(verified)_
`git filter-repo --invert-paths --path node_modules/` removed 1,509 files from all 132 commits; `.git` went 17 MB → 1.7 MB, tracked files 1,814 → 305, every SHA changed. `origin` was removed by filter-repo and has not been re-added; publishing needs `--force-with-lease`. Backup bundle at `C:\Users\Legion\Desktop\millat-backup-20260816.bundle`. The legacy `.env` (live Neon / Gmail / Cloudinary credentials, never committed) was moved to `C:\Users\Legion\millat-legacy-secrets.env.txt`. **Those three credentials still need rotating.**

---

_Entries before 2026-08-16 are the old `Millat vocational training` app and are recoverable with `git checkout 5d151ed -- backend frontend`. They are not logged here._
