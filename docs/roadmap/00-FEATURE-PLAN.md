# Feature roadmap

What to build after the rebuild, in the order worth building it.

This is a **plan of record for features**, the way `docs/rebuild/00-REBUILD-PLAN.md` was the plan of record for the rebuild. It was written after reading the whole repository rather than from a wishlist — the research it rests on is in [`01-RESEARCH.md`](./01-RESEARCH.md), and every claim here is traceable to a file.

**Status (2026-08-23):** every load-bearing claim was re-verified against source by five independent adversarial readers before any phase started. All were confirmed; the corrections they found are folded into the phases below rather than listed separately. **Phase 0 is deferred by owner decision** — feature phases proceed, and the deploy config waits until a host and credentials exist.

---

## The finding that shaped this plan

Four parallel analyses were run over the codebase. Three of them independently landed on the same thing:

> **Most of what is missing is not missing. It is half-built — the schema exists, the enum exists, the index exists, and nothing reads it.**

The clearest example, and the one that reorders everything below:

**No action in the entire API ever creates a notification.** There is a `Notification` model, a `NotificationType` enum with eight members, a notifications module that lists and marks-read, a bell in the app shell with an unread badge, and a panel behind it. `grep -rn "notification.create" apps/api/src` returns **nothing**. Every notification a user has ever seen was written by `seed.ts:1089` and `seed.ts:1105` — via `.upsert`, so even the seed evades that literal grep. Approving an enrolment, rejecting one, publishing a resource, publishing an announcement, sending a message, replying to a comment, suspending an account — none of them notify anyone. `enrollments.service.ts:449` even quotes the promise it does not keep: _"separate verb, separate audit action, separate notification."_

That is not a feature request. It is a feature that was built to the last inch and never connected.

The same pattern, verified, appears seven more times:

| Half-built                             | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ranked full-text search                | Three `searchVector` `tsvector` columns with GIN indexes exist in migration `0002:54-80` on Course, Resource and Announcement — deliberately absent from `schema.prisma`, which is why Prisma cannot reach them. **Not one query in the repository references them.** All three services fall back to `contains`/ILIKE, each with a comment saying the column "needs raw SQL". Migration 0002:82-90 also adds pg_trgm GIN indexes for partial-code matching ("WELD-2"), which stemming cannot do — Phase 3 must combine both, not swap one for the other. |
| Editable profiles                      | `TeacherProfile` and `StudentProfile` are written **only by the seed**. `updateUserSchema` has no profile fields, and there is no `user:create` action, so qualifications, staff numbers and enrolment numbers are frozen at seed time forever.                                                                                                                                                                                                                                                                                                           |
| Admin course and department management | `POST/PATCH/DELETE /courses`, `POST /courses/:id/publish`, `POST/PATCH/DELETE /departments` are all complete and tested. **No screen calls any of them.**                                                                                                                                                                                                                                                                                                                                                                                                 |
| Department detail                      | `GET /departments/:id` computes real `_count` joins for courses, teachers and students. Nothing calls it; the SPA only uses the list, for a registration dropdown.                                                                                                                                                                                                                                                                                                                                                                                        |
| Course syllabus                        | A syllabus upload can be attached and validated. `toCourseDetail` hardcodes `syllabusUrl: null` behind a `TODO(uploads)` that is now stale — uploads landed. It can be attached and never retrieved.                                                                                                                                                                                                                                                                                                                                                      |
| Avatars                                | `updateSelf` **actively 422s** any `avatarUploadId` with "Uploads are not available yet", with a passing test asserting the refusal — while uploads run in production for resources and syllabi.                                                                                                                                                                                                                                                                                                                                                          |
| Audit forensics                        | `AuditEvent` stores `before`, `after`, `ip`, `userAgent` and `requestId` on every audited write. The DTO deliberately drops all five. The data is correct in the database and no screen has ever shown it.                                                                                                                                                                                                                                                                                                                                                |
| `RESTORE` / `REINSTATE`                | Both are computed by the audit extension when a `deletedAt` clears or a user leaves `SUSPENDED`. Neither transition has an endpoint, so neither enum member can ever be written.                                                                                                                                                                                                                                                                                                                                                                          |

**This is where the cheapest credibility in the project is.** A feature whose schema, index, policy row and UI shell already exist is a fraction of the cost of a new one, and finishing it removes something that currently reads as broken.

---

## What this plan will not build

From `docs/rebuild/00-REBUILD-PLAN.md` §7, quoted, because a features plan that relitigates settled decisions is how scope dies:

- **"No certificates."** Named explicitly and flatly.
- **"No assignment/submission/grading engine** — it is a genuinely good project and it is a _different_ project… **Pick realtime OR assessment, not both."**
- **"No analytics until B+2's audit events justify them — charting `COUNT(*)` is the canonical tell of a CRUD-only project."**
- **"No fourth role** — a parent/coordinator/super-admin adds ~70 matrix cells for zero new insight."
- No video streaming, transcoding, live classes or whiteboards.

And the scope test every item below was filtered through:

> _"Does this make one of the three signature claims more provable, or does it just add another screen? If it adds a screen, cut it."_

### Two dependencies that are installed against the plan's own advice

`socket.io`, `@socket.io/redis-adapter` and `bullmq` are in `apps/api/package.json` and **used nowhere**. The plan did not merely omit them — it argued against them:

> _"BullMQ + Redis — two queues, one of which is 'send an email'. A promise you do not await plus a nightly cron covers both."_

and, on the Redis socket adapter:

> _"Redis and the socket.io Redis adapter are needed only if you run more than one Fly machine, and you will not."_

So this plan does **not** propose a realtime rewrite or a job runner as headline features. Where a background task is genuinely needed — the abandoned-upload sweeper, which `uploads.service.ts:104` promises and `NEXT.md` records the cost of — it is scoped as the plan itself recommends: a scheduled job, not a queue subsystem. Removing the three unused dependencies is a one-line cleanup in Phase 1.

---

## How the phases are shaped

You asked for backend and frontend interleaved per feature rather than all of one then all of the other. Every phase below is therefore:

```
(migration + policy)   only when unavoidable — small, and always first
      ↓
   backend slice       one feature's endpoints and tests
      ↓
   frontend slice      that same feature's screens, immediately after
```

**Each phase ships on its own.** Nothing in phase N+1 is required for phase N to be useful.

Two honest constraints on interleaving, both structural rather than preference:

1. **A migration blocks both sides.** Neither the API nor the SPA can use a column that does not exist. Where a phase needs one it is the first task and it is kept as small as possible.
2. **A policy change blocks the backend.** Per `CONTRIBUTING.md:40-46`, a new action needs its rows in `packages/shared/src/policy/policy.ts`, its matrix cells **including the denials** in `policy-matrix.test.ts`, and a regenerated `docs/permissions.md`. That is not overhead to route around — it is the mechanism the project's headline claim rests on.

**Phases marked ⇄ are independent of each other** and can run in parallel by separate agents with no coordination. Phases marked → must follow the one before.

---

## Phase 0 — Deploy (prerequisite, not a feature)

**Deferred by owner decision, 2026-08-23.** Everything below proceeds without it, on one condition recorded here so the debt is visible: every phase that lands while the app is unreachable is a phase whose real behaviour nobody can click. When a host and credentials exist, this phase comes off the top of the queue.

Nothing below is worth building before the thing is reachable. B5 is complete except the deploy itself: the image builds and serves correctly, CI builds it, the README is written, the screenshots exist. What remains needs credentials rather than code — a host, a database with a separate demo branch, a `demo-reset` workflow that **refuses to run unless `DATABASE_URL` contains the demo branch id**, and the secrets.

---

## Phase 1 — Notifications become real ⇄

_The largest gap-to-effort ratio in the project. No migration. No new policy action._

**Why first:** eight enum members, a bell, a badge, a panel and a whole module already exist and describe events that never fire. Every other feature in this plan produces events worth notifying about, so wiring the mechanism now means later phases get their notifications for one line each instead of a retrofit.

### Backend

- A single `notify()` helper in the notifications service — one place that writes a row, so no caller invents a shape. This is not style: the payload column is a closed `{ title, body }` written denormalised, and rows that fail `safeParse` render **blank by design** (`notifications.service.ts:54-61`) — which is exactly how the seed's 147 blank notifications happened (`seed.ts:1040-1042`). One writer, or it recurs.
- Wire seven of the eight events the enum names: `ENROLLMENT_REQUESTED` (to the course's teacher), `ENROLLMENT_APPROVED` / `ENROLLMENT_REJECTED` (to the student), `RESOURCE_PUBLISHED` and `ANNOUNCEMENT_PUBLISHED` (to APPROVED enrolled students, excluding the actor), `MESSAGE_RECEIVED` (to the other participant), `COMMENT_REPLIED` (to the parent comment's author, never on self-reply).
- `ACCOUNT_SUSPENDED` is decided rather than left open: **do not wire it yet.** Suspension destroys every session (`users.service.ts:300-309`) and no reinstate endpoint exists (`users.routes.ts:159-176` records the omission as deliberate), so the row would be invisible to its recipient for the row's whole life. The enum member stays — removing it costs a migration and loses the vocabulary — and wiring it becomes one line the day reinstate ships.
- Notifications are best-effort side effects of an action that already succeeded: written **after** the action's transaction commits, failures caught and logged, never failing the enrolment. The audit extension already runs on its own connection for the same reason. A comment at the helper says this out loud.
- Known debts recorded, not silently ignored: there is no enum member for a top-level comment (`COMMENT_REPLIED` covers replies only, `comments.service.ts:365-384` accepts `parentId: null`), none for a withdrawn enrolment (the very comment at `enrollments.service.ts:447-449` promises one), and none for `COURSE_PUBLISHED` — Phase 2 makes publish reachable and multiplies that silence. All three need an enum value, therefore a migration; none is worth blocking Phase 1, so they are listed here to be deliberate about.

### Frontend

- The bell and panel exist. What is missing is a full `/notifications` page for more than the panel's five, and read/unread filtering.
- **Settings already carries a fake "Notifications" tab** (`Settings.tsx:428-453`): four uncontrolled checkboxes and a Save button wired to nothing, promising email preferences that do not exist. Shipping real in-app events under controls that lie would compound it; remove or disable the tab as part of this phase.
- Per-type preferences are a natural extension and a genuine scope decision — a `NotificationPreference` model is a migration. **Recommend deferring** until the events prove noisy in practice; the removed tab is the honest placeholder until then.

**Est.** Backend 6–8 h, frontend 4–6 h.

---

## Phase 2 — Admin CRUD for departments and courses ⇄

_A frontend phase with exactly one backend line. The entire backend already exists, tested._

**Why early:** it is the cheapest complete feature in the plan, it closes `NEXT.md`'s remaining B4 item, and it barely touches the backend — which makes it the ideal partner to run alongside Phase 1's backend work if two people or two agents are going.

### Backend — one line, and it is the repository's own lesson

- `POST /courses/:id/publish` binds `body: publishCourseSchema` without `.nullish()` (`courses.routes.ts:108-111`), so a POST with no body is a **422 before the policy gate** — the exact bodyless-POST trap already fixed on four other routes. Bind `.nullish()` and add the regression test that sends no body deliberately.

### Frontend

- Extend the admin console beyond users: departments and courses, using the `DataList` pattern (`components/ui/DataList.tsx`) that already renders cards at 375px and a table from `md`.
- A course form covering name, description, department, teacher, duration, capacity, dates and the syllabus upload (via the upload client `lib/uploads.ts`, which already works). **Create-only fields are code and slug**: `updateCourseSchema` accepts neither (`packages/shared/src/schema/course.ts:120-135`), so the edit form must not offer them.
- Publish and unpublish through the one verb (`{ published: boolean }`) as a distinct affordance from edit, because `course:publish` is a distinct action with its own policy row. The button must send an explicit body regardless of the `.nullish()` fix above.
- **The demo environment denies deletes on purpose**: `course:delete` and `department:delete` carry `provenance:DEMO` denials (`docs/permissions.md:123,128`), so the seeded demo admin cannot delete anything. The UI must render that refusal as a sentence ("disabled in the demo environment") rather than an error-shaped dead end, or the flagship demo reads as broken.
- Copy for the two 409 paths a form can hit: deleting a department that still has members or courses (`departments.service.ts:198-205`), and setting capacity below the approved count (service check plus the 0002 CHECK constraint).
- **Teachers hold half these actions too** — `course:create/update/publish` allow TEACHER via `ownsCourse`. Burying them in the admin console leaves teachers unserved; give "Your courses" on the dashboard a create/manage path to the same form component rather than building a second one.
- A department detail screen, which finally gives `GET /departments/:id` and its three counts a caller. Note it requires a session — `department:read` denies anonymous by design (`departments.routes.ts:22-28`) — so it lives behind the app shell like everything else.

**Est.** Frontend 10–14 h, backend one line plus its test.

---

## Phase 3 — Search that uses the search vectors →

_Depends on nothing. Placed third because it is the most visible single improvement per hour._

**Why:** three `tsvector` columns with GIN indexes were built in migration 0002 and have never been read. The catalogue currently does `ILIKE '%term%'`, which cannot rank and cannot match word stems — searching "welding" will not find "welded". The reverse is also true, and it is the phase's trap: **stemming cannot match a partial code**, so a pure-tsvector swap regresses searching "WELD-2" to nothing. Migration `0002:82-90` built pg_trgm GIN indexes on Course.name/code, Resource.title and Announcement.title for exactly that case.

### Backend — two slices, shipped separately

- **Slice 1 upgrades the existing `?q=` handlers in place.** All three endpoints already accept `q` (`courses.service.ts:260-270`, `resources.service.ts:300-310`, `announcements.service.ts:210-220`) and the catalogue's debounced input already sends it. Replace each `contains` fallback with a ranked query that combines both index types: `ts_rank_cd` against `searchVector` with `websearch_to_tsquery`, OR'd with a trigram `%term%` match so codes and partial words keep working. A regression test pins that `?q=WELD-2` still finds its course after the swap.
- **Slice 2 adds one cross-entity `GET /search?q=`** returning courses, resources and announcements together, **each scoped by the same visibility WHERE clause its own module already uses.** This is the trap: a global search that forgets a soft-delete filter or a publication check leaks in one query what every module carefully guards. Reuse `visibilityWhere` from resources (`resources.service.ts:236`) and announcements (`announcements.service.ts:162`); courses' is not exported yet (`courses.service.ts:224`) — exporting it is part of this slice.
- Prisma has no `tsvector` type, so this is `$queryRaw` with parameter binding — the convention four services already follow (tagged templates, bound params, never `$executeRawUnsafe`). Never interpolate the query string.

### Frontend

- Slice 1 needs no frontend change — the input exists; matching simply gets better.
- Slice 2 adds a search field in the app shell, results grouped by type, keyboard-navigable, and a full results page. Resources have no global list page today (only per-course tabs), so result rows deep-link straight to `/resources/:id`.
- Announcements has no text filter even though the API accepts `?q=` (`Announcements.tsx:112` sends only type) — wire the same input there in slice 1's spirit.
- Highlight matched terms using `ts_headline` from the same query rather than a client-side regex, which would highlight the wrong thing for a stemmed match.

**Est.** Backend slice 1 4–5 h, slice 2 4–5 h; frontend 6–8 h.

---

## Phase 4 — Finish what uploads started ⇄

_Three small closures that each currently read as a bug._

### Backend

- **Syllabus download.** `toCourseDetail` hardcodes `syllabusUrl: null` behind a stale TODO (`courses.service.ts:75-77`). The presign helper exists (`storage.ts`); this is a handful of lines and a test. Sweep the rest of the stale family in the same pass — `lib/dto.ts:73` and `auth.service.ts:86` carry sibling TODO(uploads) comments.
- **Avatars.** The `AVATAR` purpose already exists with its own limits (`packages/shared/src/schema/upload.ts:11,38`), so clients can presign and commit avatar uploads today; only attachment is refused (`users.service.ts:245-246`, asserted by `users.test.ts:382-391`). Accept the upload, delete that test, write the one asserting acceptance. Then the real work the plan understated: `avatarUrlFor()` takes only a `userId` and unconditionally returns a DiceBear URL (`packages/db/src/avatar.ts:13-21`; callers `auth.service.ts:88`, `lib/dto.ts:75`), so preferring an uploaded avatar means threading the user's upload relation through every caller, not swapping one function's body.
- **The upload sweeper.** `uploads.service.ts:102-108` records that nothing sweeps abandoned `PENDING` rows, and `@@index([status, createdAt])` (`schema.prisma:423`) exists for exactly it. Build it as a scheduled task per the plan's own advice, **not** as a BullMQ queue — no cron precedent exists in apps/api yet, so this lands the first one, deliberately tiny. Two hard edges: `storage.ts` exports no delete helper today (presign/head/key-build only), so object deletion is new infrastructure; and the sweeper must stay `PENDING`-only, because the upload client deliberately reuses a COMMITTED upload across retries — sweeping "orphaned" committed rows would break that flow. Until this phase ships attachment for avatars, every committed AVATAR upload is a leak with no path to attachment; shipping this phase is what closes it.

### Frontend

- An avatar picker in Settings, reusing the upload client and the file-validation copy the resource dialog already has.
- A syllabus link on the course detail header.

**Est.** Backend 6–8 h, frontend 4–5 h.

---

## Phase 4b — Editable profiles and provisioning ⇄ (after 4)

_The finding table names editable profiles; no phase delivered them. This one does._

`TeacherProfile` and `StudentProfile` are written only by the seed (`seed.ts:505-509`, `:543-547`), so qualifications, staff numbers and enrolment numbers are frozen at seed time forever. And there is no way to hire anyone: registration self-serves STUDENT accounts only (`auth.routes.ts:34-41`), teachers and admins exist because a seed script ran.

### Migration + policy (blocking, small)

- None for profiles themselves — the rows exist. One new action: `user:create` (ADMIN allow; TEACHER, STUDENT, anonymous deny), matrix cells including the denials, regenerated `docs/permissions.md`.
- No migration for provisioning either: `createUserSchema` already validates department, qualifications, staff/enrolment numbers and role (`packages/shared/src/schema/user.ts:84-113`) and sits unwired. Wiring it is the phase.

### Backend

- Extend `updateSelf` to upsert the caller's profile row from the shared schema's profile fields, and extend `updateUserSchema` (`user.ts:70-80`) so an admin can edit another user's profile through the existing admin update path.
- `POST /users` using `createUserSchema` verbatim, gated on `user:create`, writing an audit event through the existing extension like every other write. Password bootstrap reuses the forgot/reset-password flow that already works against Mailpit — the endpoint creates the account, the person sets their own password; no second credential path is invented.

### Frontend

- Settings grows the profile fields the API now accepts (role-appropriate), replacing frozen seed values with editable ones.
- The admin console gains "Add a user" using the same form component discipline as Phase 2.

**Est.** Policy 1 h, backend 4–6 h, frontend 3–4 h.

---

## Phase 5 — Attendance →

_The first genuinely new domain feature, and the one the trade context most justifies._

**Why this and not certificates or grading:** those are cut, explicitly. Attendance is not assessment — it records presence, not a judgement of work — and in this domain presence _is_ the compliance record. The seed's own qualifications (City & Guilds, NVQ, CSWIP, F-Gas) are externally audited credentials whose awarding bodies gate eligibility on supervised contact hours. `Enrollment.status = APPROVED` answers "may this student be here". Nothing answers "was this student here."

The seed already speaks this language and the schema cannot hear it: an announcement reads _"Two students still need PPE sign-off"_, and a rejection note reads _"Prerequisite not met: complete the Level 1 course first"_ — free text a teacher typed by hand.

### Migration + policy (blocking, small)

- `AttendanceRecord { enrollmentId, sessionDate, status, markedById, note }`, a satellite on `Enrollment` — the same one-identity-plus-satellite discipline the rest of the schema uses, with explicit `onDelete` per the schema's own rule 2.
- `@@unique([enrollmentId, sessionDate])`, so marking twice corrects rather than duplicates — the same convention as `Enrollment @@unique([studentId, courseId])` (`schema.prisma:379`).
- **A caveat verification found, recorded where the migration lives:** enrolment rows are reused forever on re-application (`schema.prisma:377-379`) and carry no `deletedAt`, so history keyed to `enrollmentId` spans a student's separate intakes of the same course in one thread. The register semantics chosen here are deliberately date-scoped — "who was present on day D for course C" reads the current APPROVED roster — so the conflation does not affect what an instructor marks. Intake-separated history arrives properly with Phase 9's template/offering split; it is not smuggled in here.
- Two actions: `attendance:mark` (TEACHER `ownsCourse`, ADMIN allow, STUDENT deny) and `attendance:read` (STUDENT `isEnrolledStudent`, TEACHER `ownsCourse`, ADMIN allow). Both compose combinators that already exist — no new rule primitives.
- Matrix cells including the denials, and `pnpm docs:permissions`.

### Backend

- Bulk mark for a session: a whole register in one request, which is how an instructor actually works — not one PATCH per student.
- A per-student attendance summary on the enrolment, and a per-course register by date.

### Frontend

- A register on the course detail Students tab: the roster, a date, and present/absent/late per row, saving as one action.
- A student's own attendance on their dashboard and course detail.

**Est.** Migration + policy 3 h, backend 10–12 h, frontend 10–12 h.

---

## Phase 6 — Prerequisites ⇄

_Cheap, and it makes the project's flagship claim more provable rather than merely adding a screen._

The catalogue is already a level ladder by design — 101 → 201/202 → 301 in every department — so the domain assumes progression and the product does not enforce it. Today a teacher spots the gap by eye and types a rejection note.

### Migration + policy (blocking, tiny)

- `Course.prerequisiteCourseId`, an optional self-relation.
- A `hasCompletedPrerequisite` combinator, composed as `and(isPublished, hasCompletedPrerequisite)` on `enrollment:request` — the same idiom as the existing `or(isPublished, enrolledApproved)`.

**This is the phase with the best ratio of new-matrix-cells to effort in the plan.** It adds a genuinely new provable rule to the generated, CI-checked permission matrix, which is exactly the bar §7 sets for what is worth building.

### Backend

- The subject loader must carry the actor's completed courses. A subject that omits the field denies silently — `docs/LESSONS-LEARNED.md` #15, #18 and #31 are all this mistake.

### Frontend

- The catalogue shows "Requires: SMAW Level 1" and disables the enrol button with the reason, rather than letting a student request something that will be refused.
- The web subject must carry the same field, or the UI hides a button the API would have allowed — the client-side half of #31.

**Est.** Migration + policy 2 h, backend 4–5 h, frontend 3–4 h.

---

## Phase 7 — Workshop capacity as a second guarded number ⇄

_The narrow version only._

A CNC instructor needs a course capped at 10 because there are ten working lathes, whatever the admissions capacity says. This is the most direct possible reuse of the mechanism the project is proudest of — the atomic conditional increment plus CHECK constraint from ADR 0006 — applied to a second bound.

**Build the guarded number. Do not build an equipment inventory.** Serial numbers, maintenance schedules and asset tracking are a different product, and would fail the scope test on the first screen.

**Est.** Migration 2 h, backend 4 h, frontend 2 h.

---

## Phase 8 — The administrator's register ⇄

_An export, not a dashboard. This is the closest call in the plan and the distinction is the whole point._

The plan says: _"No analytics until B+2's audit events justify them — charting `COUNT(*)` is the canonical tell of a CRUD-only project."_ A reporting dashboard would be exactly that tell. But an accreditor does not want a chart — they want a register they can file.

### Backend

- CSV export for an enrolment register, an attendance register (after Phase 5) and the audit feed, reusing the queries and the policy gates that already exist.
- Streamed, not buffered: a register for a full intake should not be assembled in memory.

### Frontend

- A download action on the screens that already list the data. No new screen.
- Surface the audit forensics that already exist and are dropped by the DTO — `before`, `after`, `ip`, `userAgent`, `requestId` (stored at `packages/db/src/audit.ts:259-269`, dropped at `audit.service.ts:41-53`) — on an audit event detail view. The data has been correct in the database this whole time.
- Two scoping notes so this phase promises only what it delivers: the detail view displays stored forensics and nothing more — `RESTORE` / `REINSTATE` rows still cannot be written after it ships, because no endpoint causes those transitions yet (`users.routes.ts:159-176` records both as deliberately unbuilt). And the audit wire shapes are deliberately API-local rather than in `@skillwright/shared` (`audit.schema.ts:1-18` says so), so the detail DTO extends them in place instead of migrating them into shared for one screen.

**Est.** Backend 6–8 h, frontend 4 h.

---

## Phase 9 — Cohorts and intakes →

_The one with real schema cost. Sequenced last deliberately._

`Course` currently carries one `startDate`, one `endDate` and one `capacity` — it models a single term's offering, not a repeatable template. Trade schools run repeating intakes, and the product's own copy already assumes it: `CourseDetail.tsx:980` says _"This intake is full — apply again for the spring cohort"_, and the seed announces _"Spring intake applications now open"_. Neither is backed by anything.

Splitting `Course` into a template and an offering touches enrolments, capacity, the resources relation and every screen that shows a course. It is the right model and it is a migration with real blast radius.

**Do it after the cheap wins are banked**, and treat it as a data-model correction rather than a new admin surface, or it becomes "just another screen" under the scope test.

**Est.** Migration 6–8 h, backend 12–16 h, frontend 10–12 h.

---

## Suggested order, with what can run in parallel

```
Phase 0   Deploy                          ← DEFERRED by owner decision; see its section

Phase 1   Notifications      ⇄  Phase 2   Admin CRUD
Phase 3   Search             ⇄  Phase 4   Finish uploads
Phase 4b  Profiles + provisioning   (after 4 — shares users.service.ts with it)
Phase 5   Attendance         ⇄  Phase 6   Prerequisites
Phase 7   Workshop capacity  ⇄  Phase 8   Registers and audit detail
Phase 9   Cohorts
```

Phases on the same line touch different modules and can be built simultaneously without coordination. Phase 2's single backend line makes it still the natural partner for Phase 1's backend-heavy work.

One correction to the pairing above that verification made explicit: **⇄ means different modules, not disjoint files.** Phases 5 and 6 both edit `packages/shared/src/policy/*` and each needs a migration — their policy/migration slices must land serially even though their feature slices could run apart. The same is true of 4 → 4b sharing `users.service.ts`. When two agents build a paired pair, give the shared file to one agent first and hand it over explicitly.

**Rough total:** 120–150 hours to the end of Phase 8 (including 4b), with Phase 9 another 30–35 on top.

---

## Rules every phase inherits

These are not style preferences. Each one is a bug this repository has already paid for, recorded in `docs/LESSONS-LEARNED.md`:

- **A list gets a WHERE clause, never a subject gate.** `can()` with an empty or wrong-shaped subject denies every caller including admins, silently. (#15, #31 — this shipped six times.)
- **A subject must carry every field the rules read**, and the client's subject must match the server's, or the UI hides what the API would allow. (#18, #31.)
- **A child's visibility is bounded by its parent's.** A per-row public flag does not outrank the container's publication state. (#33.)
- **A new action costs matrix rows including the denials, plus a regenerated `docs/permissions.md`.** That is the mechanism, not the overhead. (`CONTRIBUTING.md:40-46`; note its path to the matrix test is stale — the file lives at `packages/shared/test/policy-matrix.test.ts`, not under `apps/api`.)
- **Capacity is an atomic conditional UPDATE plus a CHECK.** Never `SELECT count` then `INSERT`. (ADR 0006.)
- **Mobile-first is enforced by a script**, not intended. (ADR 0008.)
- **Verify by running, not by reviewing.** The Dockerfile was reviewed for months and produced six faults in its first hour of actually being executed. (#38.)
