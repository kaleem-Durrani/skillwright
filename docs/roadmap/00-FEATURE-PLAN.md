# Feature roadmap

What to build after the rebuild, in the order worth building it.

This is a **plan of record for features**, the way `docs/rebuild/00-REBUILD-PLAN.md` was the plan of record for the rebuild. It was written after reading the whole repository rather than from a wishlist — the research it rests on is in [`01-RESEARCH.md`](./01-RESEARCH.md), and every claim here is traceable to a file.

---

## The finding that shaped this plan

Four parallel analyses were run over the codebase. Three of them independently landed on the same thing:

> **Most of what is missing is not missing. It is half-built — the schema exists, the enum exists, the index exists, and nothing reads it.**

The clearest example, and the one that reorders everything below:

**No action in the entire API ever creates a notification.** There is a `Notification` model, a `NotificationType` enum with eight members, a notifications module that lists and marks-read, a bell in the app shell with an unread badge, and a panel behind it. `grep -rn "prisma.notification.create" apps/api/src` returns **nothing**. Every notification a user has ever seen was written by `seed.ts`. Approving an enrolment, rejecting one, publishing a resource, publishing an announcement, sending a message, replying to a comment, suspending an account — none of them notify anyone. `enrollments.service.ts:449` even quotes the promise it does not keep: _"separate verb, separate audit action, separate notification."_

That is not a feature request. It is a feature that was built to the last inch and never connected.

The same pattern, verified, appears seven more times:

| Half-built                             | Evidence                                                                                                                                                                                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ranked full-text search                | Three `searchVector` `tsvector` columns with GIN indexes exist (migration `0002:54-80`) on Course, Resource and Announcement. **Not one query in the repository references them.** All three services fall back to `contains`/ILIKE, each with a comment saying the column "needs raw SQL". |
| Editable profiles                      | `TeacherProfile` and `StudentProfile` are written **only by the seed**. `updateUserSchema` has no profile fields, and there is no `user:create` action, so qualifications, staff numbers and enrolment numbers are frozen at seed time forever.                                             |
| Admin course and department management | `POST/PATCH/DELETE /courses`, `POST /courses/:id/publish`, `POST/PATCH/DELETE /departments` are all complete and tested. **No screen calls any of them.**                                                                                                                                   |
| Department detail                      | `GET /departments/:id` computes real `_count` joins for courses, teachers and students. Nothing calls it; the SPA only uses the list, for a registration dropdown.                                                                                                                          |
| Course syllabus                        | A syllabus upload can be attached and validated. `toCourseDetail` hardcodes `syllabusUrl: null` behind a `TODO(uploads)` that is now stale — uploads landed. It can be attached and never retrieved.                                                                                        |
| Avatars                                | `updateSelf` **actively 422s** any `avatarUploadId` with "Uploads are not available yet", with a passing test asserting the refusal — while uploads run in production for resources and syllabi.                                                                                            |
| Audit forensics                        | `AuditEvent` stores `before`, `after`, `ip`, `userAgent` and `requestId` on every audited write. The DTO deliberately drops all five. The data is correct in the database and no screen has ever shown it.                                                                                  |
| `RESTORE` / `REINSTATE`                | Both are computed by the audit extension when a `deletedAt` clears or a user leaves `SUSPENDED`. Neither transition has an endpoint, so neither enum member can ever be written.                                                                                                            |

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

Nothing below is worth building before the thing is reachable. B5 is complete except the deploy itself: the image builds and serves correctly, CI builds it, the README is written, the screenshots exist. What remains needs credentials rather than code — a host, a database with a separate demo branch, a `demo-reset` workflow that **refuses to run unless `DATABASE_URL` contains the demo branch id**, and the secrets.

**Do this first.** A feature nobody can reach is indistinguishable from a feature nobody built.

---

## Phase 1 — Notifications become real ⇄

_The largest gap-to-effort ratio in the project. No migration. No new policy action._

**Why first:** eight enum members, a bell, a badge, a panel and a whole module already exist and describe events that never fire. Every other feature in this plan produces events worth notifying about, so wiring the mechanism now means later phases get their notifications for one line each instead of a retrofit.

### Backend

- A single `notify()` helper in the notifications service — one place that writes a row, so no caller invents a shape.
- Wire the seven events the enum already names: `ENROLLMENT_REQUESTED` (to the teacher), `ENROLLMENT_APPROVED` / `ENROLLMENT_REJECTED` (to the student), `RESOURCE_PUBLISHED` and `ANNOUNCEMENT_PUBLISHED` (to enrolled students), `MESSAGE_RECEIVED`, `COMMENT_REPLIED`.
- `ACCOUNT_SUSPENDED` is the eighth and the odd one: the suspension destroys every session, so the notification is only visible if the account is ever reinstated. Either wire it and accept that, or delete the enum member. **Decide, do not leave it dead.**
- Notifications are a side effect of an action that already succeeded. A failed notify must never fail the enrolment. Write it in the same transaction only if you want it to be atomic, and say which you chose in a comment.

### Frontend

- The bell and panel exist. What is missing is a full `/notifications` page for more than the panel's five, and read/unread filtering.
- Per-type preferences are a natural extension and a genuine scope decision — a `NotificationPreference` model is a migration. **Recommend deferring** until the events prove noisy in practice.

**Est.** Backend 6–8 h, frontend 4–6 h.

---

## Phase 2 — Admin CRUD for departments and courses ⇄

_A frontend-only phase. The entire backend already exists, tested._

**Why early:** it is the cheapest complete feature in the plan, it closes `NEXT.md`'s remaining B4 item, and it is a pure frontend slice — which makes it the ideal partner to run alongside Phase 1's backend work if two people or two agents are going.

### Backend

**None.** `POST/PATCH/DELETE /courses`, `POST /courses/:id/publish` and `POST/PATCH/DELETE /departments` are complete, gated, and covered by tests. Verify against `docs/permissions.md` and write nothing.

### Frontend

- Extend the admin console beyond users: departments and courses, using the `DataList` pattern that already renders cards at 375px and a table from `md`.
- A course form covering code, name, description, department, teacher, duration, capacity, dates and the syllabus upload — every field the API already accepts.
- Publish and unpublish as a distinct affordance from edit, because `course:publish` is a distinct action with its own policy row.
- A department detail screen, which finally gives `GET /departments/:id` and its three counts a caller.

**Est.** Frontend 10–14 h. No backend.

---

## Phase 3 — Search that uses the search vectors →

_Depends on nothing. Placed third because it is the most visible single improvement per hour._

**Why:** three `tsvector` columns with GIN indexes were built in migration 0002 and have never been read. The catalogue currently does `ILIKE '%term%'`, which cannot rank and cannot match word stems — searching "welding" will not find "welded".

### Backend

- A raw-SQL ranked query per entity using `ts_rank_cd` against the existing `searchVector`, with `websearch_to_tsquery` so a user can type quoted phrases and `-exclusions` and get what they expect.
- One cross-entity `GET /search?q=` returning courses, resources and announcements together, **each scoped by the same visibility WHERE clause its own module already uses.** This is the trap: a global search that forgets a soft-delete filter or a publication check leaks in one query what every module carefully guards. Reuse `visibilityWhere` from each service; do not rewrite them.
- Prisma has no `tsvector` type, so this is `$queryRaw` with parameter binding. Never interpolate the query string.

### Frontend

- A search field in the app shell, with results grouped by type, keyboard-navigable, and a full results page.
- Highlight matched terms using `ts_headline` from the same query rather than a client-side regex, which would highlight the wrong thing for a stemmed match.

**Est.** Backend 8–10 h, frontend 6–8 h.

---

## Phase 4 — Finish what uploads started ⇄

_Three small closures that each currently read as a bug._

### Backend

- **Syllabus download.** `toCourseDetail` hardcodes `syllabusUrl: null` behind a stale TODO. The presign helper exists; this is a handful of lines and a test.
- **Avatars.** `updateSelf` refuses `avatarUploadId` outright, with a passing test asserting the refusal, while uploads run in production. Accept an `AVATAR`-purpose upload, and have `avatarUrlFor()` prefer it over the DiceBear fallback. Delete the test that asserts the old refusal and write the one that asserts the new behaviour.
- **The upload sweeper.** `uploads.service.ts:104` promises a job that removes abandoned `PENDING` rows, and `@@index([status, createdAt])` exists for exactly it. Build it as a scheduled task per the plan's own advice, **not** as a BullMQ queue. It must delete the object as well as the row, and it must never touch a `COMMITTED` upload.

### Frontend

- An avatar picker in Settings, reusing the upload client and the file-validation copy the resource dialog already has.
- A syllabus link on the course detail header.

**Est.** Backend 6–8 h, frontend 4–5 h.

---

## Phase 5 — Attendance →

_The first genuinely new domain feature, and the one the trade context most justifies._

**Why this and not certificates or grading:** those are cut, explicitly. Attendance is not assessment — it records presence, not a judgement of work — and in this domain presence _is_ the compliance record. The seed's own qualifications (City & Guilds, NVQ, CSWIP, F-Gas) are externally audited credentials whose awarding bodies gate eligibility on supervised contact hours. `Enrollment.status = APPROVED` answers "may this student be here". Nothing answers "was this student here."

The seed already speaks this language and the schema cannot hear it: an announcement reads _"Two students still need PPE sign-off"_, and a rejection note reads _"Prerequisite not met: complete the Level 1 course first"_ — free text a teacher typed by hand.

### Migration + policy (blocking, small)

- `AttendanceRecord { enrollmentId, sessionDate, status, markedById, note }`, a satellite on `Enrollment` — the same one-identity-plus-satellite discipline the rest of the schema uses, with explicit `onDelete` per the schema's own rule 2.
- `@@unique([enrollmentId, sessionDate])`, so marking twice corrects rather than duplicates.
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
- Surface the audit forensics that already exist and are dropped by the DTO — `before`, `after`, `ip`, `userAgent`, `requestId` — on an audit event detail view. The data has been correct in the database this whole time.

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
Phase 0   Deploy                          ← do this first, it is a gate

Phase 1   Notifications      ⇄  Phase 2   Admin CRUD (frontend only)
Phase 3   Search             ⇄  Phase 4   Finish uploads
Phase 5   Attendance         ⇄  Phase 6   Prerequisites
Phase 7   Workshop capacity  ⇄  Phase 8   Registers and audit detail
Phase 9   Cohorts
```

Phases on the same line touch different modules and can be built simultaneously without coordination. Phase 2 is frontend-only, which makes it the natural partner for Phase 1's backend-heavy work.

**Rough total:** 110–140 hours to the end of Phase 8, with Phase 9 another 30–35 on top.

---

## Rules every phase inherits

These are not style preferences. Each one is a bug this repository has already paid for, recorded in `docs/LESSONS-LEARNED.md`:

- **A list gets a WHERE clause, never a subject gate.** `can()` with an empty or wrong-shaped subject denies every caller including admins, silently. (#15, #31 — this shipped six times.)
- **A subject must carry every field the rules read**, and the client's subject must match the server's, or the UI hides what the API would allow. (#18, #31.)
- **A child's visibility is bounded by its parent's.** A per-row public flag does not outrank the container's publication state. (#33.)
- **A new action costs matrix rows including the denials, plus a regenerated `docs/permissions.md`.** That is the mechanism, not the overhead.
- **Capacity is an atomic conditional UPDATE plus a CHECK.** Never `SELECT count` then `INSERT`. (ADR 0006.)
- **Mobile-first is enforced by a script**, not intended. (ADR 0008.)
- **Verify by running, not by reviewing.** The Dockerfile was reviewed for months and produced six faults in its first hour of actually being executed. (#38.)
