# Feature roadmap, round two

What `00-FEATURE-PLAN.md` left open, plus the gaps a real training institution hits in its
first week. Written after a read-only audit of the whole tree at `f0d25b4` — 85 API
endpoints, 49 policy actions, 20 models, 21 pages, 22 routes — with every claim below
carrying a `file:line`.

Round one built the machine that runs a course intake. This round closes the loop it
cannot currently close, and removes the things that stop a school using it on day one.

---

## The finding that shapes this plan

**The student lifecycle has a terminal state with no door.**

`EnrollmentStatus.COMPLETED` is declared at `packages/db/prisma/schema.prisma:64`, marked
terminal in the transition map, and **no code anywhere in the repository writes it**. The
service says so itself: _"COMPLETED is terminal and has no endpoint in this module's
contract — it is left unreachable."_ A search across `apps/api/src`, `apps/web/src`,
`packages/shared/src` returns the enum, the transition map, a status-chip colour and a
comment.

Everything else follows from that. A vocational school exists to issue a qualification. This
application can seat a student, mark them present, publish their materials and then has
nowhere to record that they finished — and `docs/roadmap/00-FEATURE-PLAN.md:44` cut
certificates and `:44-45` cut assessment **on purpose**, on the reasoning _"Pick realtime OR
assessment, not both."_ That trade is now revisitable, because the thing that was cut was
the part of the product that actually produces the outcome.

So this plan is not a feature list. It is a lifecycle, closed:

```
seat  →  attend  →  submit  →  be assessed  →  complete  →  qualify  →  verify
         (built)   (built)      (Phase 2)      (Phase 1)   (Phase 3)   (Phase 3)
```

with the operational work that makes any of it usable (Phases 0, 4–6) and the work that
makes it trustworthy (Phases 7–9) around it.

---

## What this plan will not build

Carried forward deliberately from round one, not re-litigated:

- **Realtime / live chat.** Still the owner's explicit call. The messaging module is
  request/response and works.
- **Payments, fees and invoicing.** The school runs them elsewhere; nothing in the data
  model assumes otherwise.
- **An equipment or consumables inventory.** `00-FEATURE-PLAN.md:276` ruled on it and the
  ruling has not been disturbed. `CourseOffering.workshopCapacity` stays a guarded integer.
- **A native app.** The SPA is already installable and is Phase-9-complete on mobile.
- **Anything that needs a decision this plan cannot make.** Every one of those is in
  `docs/DEFERRED.md` with its exit condition.

---

## How the phases are shaped

Every phase is **migration + policy first, then backend, then frontend**, and the frontend
slice is written mobile-first — `docs/adr/0008-mobile-first-as-a-constraint.md` makes the
phone the baseline and the desktop the enhancement, and Phase 0c below explains why that is
currently unenforced.

Two rules carry over from round one and are restated because every phase below touches them:

- **Policy is data.** No `if (role === ...)`, ever. A new verb is a type error until it has
  an anonymous case and all three roles (`packages/shared/src/policy/policy.ts:27-89`), and
  `docs:permissions` is regenerated in the same commit.
- **A migration is applied, never pushed.** `prisma migrate deploy` in CI; if a committed
  migration is broken that is where it is found, not in production.

---

## Phase 0 — Unblock the work ⇄ (prerequisite, not a feature)

Three things currently prevent anyone from running this repository, including its author.
None is a feature; all three block the phases below.

### 0a. The CI gate is a third of what its own comments claim

The rich `ci.yml` — the one carrying the `e2e` and `e2e-real-stack` jobs, the corrected
`ci` gate, `typecheck:scripts`, and the web + db unit tests in the `unit` job — makes GitHub
create a run with **zero jobs**. `main` currently runs a reduced `ci.yml` that was verified
to schedule, and it **does not run `apps/web`'s 394 unit tests, does not run the 129 browser
tests, and does not run the 6 real-stack golden paths.** The comments still describe the
full gate. That is the exact "certifies a commit that never built" failure PROGRESS.md
records, reintroduced by the workaround.

Tracked as `docs/DEFERRED.md` D2 and D4. Ruled out already: YAML syntax, GitHub's published
JSON Schema (both files validate), the two e2e jobs, duplicate keys, BOM, CRLF, size.

**Do:** with a `gh` token, read one zero-job run's error text. If that fails, re-add the
three candidate changes one at a time so each is isolated by a run that either schedules or
does not.

### 0b. The object store has no image left to run

`minio/minio` and `minio/mc` are **deleted from Docker Hub**; `bitnami/minio` has zero
tags; the official binary download returns **410 Gone**. `pnpm infra:up` therefore fails for
anyone cloning today, and CI's `integration tests` job fails at its first step.

Tracked as `docs/DEFERRED.md` D1, which also records why `rustfs/rustfs` is a candidate but
not an automatic answer: this repository asserts that the **unsigned object URL answers
403** and that a mismatched `Content-Type` is rejected with `SignatureDoesNotMatch`, and
those are claims about MinIO's SigV4 implementation. **Whichever store is chosen, both
behaviours must be proven against it before anything else changes.**

### 0c. Mobile is the stated baseline and almost nothing enforces it

`e2e/mobile-shell.spec.ts` runs at Pixel 7 and iPhone 14 and passes — and asserts its two
substantive rules (no horizontal document scroll, 44px touch targets) on **`/login` only**.
The other 17 routes are unmeasured. `fill-height.spec.ts:88` forces 1280×900 and therefore
asserts nothing about a phone. No spec asserts that the bottom tab bar is visible below
`md`, that `main`'s padding clears it, or that no content sits under it.

**Do:** extend `mobile-shell.spec.ts` to every route, in a new phase-0 commit, before any
feature phase starts. A feature that is mobile-first only in intent is a feature that will
be retrofitted.

### 0d. Small, same commit

- `format:check` covers no `.yml` (`package.json:22`) — `docs/DEFERRED.md` D5. One word.
- 62 stale `file:line` citations, 44 of them in `policy.ts` (lesson 34: _name the symbol,
  not the line_). Mechanical, and a contributor adding an action will read them and be
  misled.

---

## Phase 1 — Completion: make the terminal state reachable →

**The cheapest gap in the repository, and the hinge for Phases 2 and 3.**

### Migration + policy

- `CourseOffering` gains `completedAt DateTime?` and, if the school wants the evidence
  behind it, `completionNote String?`.
- `Enrollment` gains `completedAt DateTime?` and `completedById` → `User` (Restrict) — who
  recorded it. Audit without an actor is the failure mode the whole audit extension exists
  to prevent.
- New action `enrollment:complete`, alongside the existing `enrollment:approve` /
  `enrollment:reject` cells. `docs:permissions` regenerates.
- An eligibility rule is the credibility question: completing a course with 40% attendance
  should be possible (life happens) but should be **visible**, not silent. A `lowAttendance`
  flag on the dialog copy beats a hard block, and the repo already has the attendance read
  to compute it.

### Backend

- `POST /enrollments/:id/complete` on the existing module, with the same
  `approve()`/`settle()` shape — return `{ enrollment, changed }` so a double-click is a
  no-op and does not write a second audit row. That pattern is already the lesson of
  `notifications.service.ts:271-276`.
- `POST /enrollments/:id/uncomplete` (or a `PATCH` back to APPROVED) for the correction
  path. An irreversible terminal state with no undo is a data-entry trap.

### Frontend

- The course detail enrolment table gets a "Complete" row action beside approve/reject,
  and a completed enrolment renders a terminal chip with its date and the actor's name.
- The status chip already has a COMPLETED colour, so this is one more row in an existing
  table.
- **Mobile:** the enrolment table is `DataTable`, which switches to a card list below `md`
  (`DataTable.tsx:150-178`). The action moves into the card's existing row menu; it does not
  become a second inline button, because the card already has three.

---

## Phase 2 — Assessment: assignments and submissions ⇄

The training itself. This is what round one cut, and it is what the school is paying for.

### Migration + policy

- `Assignment` — FK `offeringId` → `CourseOffering` (not `courseId`: a deadline belongs to
  an intake, and a template that is re-run five times a year has five different deadlines),
  `title`, `brief`, `dueAt`, `maxScore`, and `resourceId?` → `Resource` for the brief as an
  uploaded artefact.
- `Submission` — FK `assignmentId`, FK **`enrollmentId`** → `Enrollment` and not
  `studentId` → `User`. A seat is required before a hand-in, and `Enrollment` is already
  the "this student holds this seat in this intake" row. The policy already has the
  `enrolledApproved` combinator to gate on.
  `submittedAt?`, `score Decimal?`, `feedback String?`, `gradedById` → `User`,
  `gradedAt?`, `attempt Int` for resubmission.
- `SubmissionStatus` — `SUBMITTED`, `GRADED`, `RETURNED`.
- `ResourceType` gains `ASSIGNMENT`, reversing a deliberate refusal at
  `schema.prisma:75-78`. The reversal is justified in the plan, not silently.
- Four actions: `assignment:read`, `assignment:create`, `submission:read`, `submission:grade`.
  The `submission:read` matrix is the interesting one: a teacher sees their own course's,
  a student sees only their own, an admin sees all. That is the #31 shape — an absent
  subject field must deny.

### Backend

- Four endpoints in a new `assignments` module, following
  `<name>.routes.ts` / `.schema.ts` / `.service.ts` exactly as the other 16.
- The list is the interesting query: a student's assignment list is
  "every assignment on the offerings I hold an APPROVED seat in, joined to whether I have
  submitted". One query, `visibilityWhere`-style, no N+1.

### Frontend

- Student: an **Assignments** tab on the course detail page, a submission dialog with file
  upload through the existing `lib/uploads.ts` presign → PUT → commit path, and a
  grade/feedback view once graded.
- Teacher: a submissions list per assignment with a grading dialog.
- **Mobile:** a submission is a file and a note — the dialog is the whole feature and it
  already has a mobile layout. The grading table is a `DataTable` and gets the card list for
  free. Upload progress is already XHR-based with a determinate bar (Phase 5 of round one),
  so a large PDF on a phone shows real progress rather than a spinner.

### Sequencing note

Phase 2 is the largest phase in this plan and it is deliberately **after** Phase 1, not
before. Completion without assessment is a button an admin clicks; completion that records
a grade is a system of record. The first is useful, the second is not credible until the
grades exist.

---

## Phase 3 — Certificates and qualification records →

**The product a vocational school actually exists to produce.**

### Migration + policy

- `Qualification` — the catalogue: `code`, `name`, `level`, `awardingBody`.
- `StudentQualification` — FK `studentId`, FK `qualificationId`, `issuedAt`, `reference`
  (unique), `revokedAt?`, `revokedById?`, and `artifactUploadId` → `Upload`.
  **A certificate is structurally an `Upload` plus a foreign key** — `Upload` is already
  built to carry exactly this artefact, with a real key, a confirmed content type and an
  owner (`schema.prisma:514-546`).
- Actions `certificate:read` (own), `certificate:issue` (teacher on own course / admin),
  `certificate:revoke` (admin), and one that is unusual and worth arguing about:
  `certificate:verify` with **no subject**, for a public verify-by-reference route.
- **Generator:** a PDF, server-side, from the `Upload` object plus the qualification fields.
  A headless browser in the API process is heavy; a small templating library and a font is
  the alternative. Decide by measuring the first generated artefact, not by preference.

### Backend

- `GET /certificates/verify/:reference` — **unauthenticated**, returns only
  `{ name, qualification, issuedAt, revoked }` and never the referencee's owner. This is
  the route that makes a certificate worth issuing, and it is the one genuinely public
  surface this plan adds, so it gets the most scrutiny.
- The seed data has real qualifications to model against: `packages/db/prisma/seed.ts:386-393`
  lists City & Guilds Level 3, NVQ Level 4, CSWIP 3.1 and F-Gas Category I, and
  `TeacherProfile.qualification` is a single free-text `String` (`schema.prisma:206`). The
  school **hosts** qualifications it does not model. This phase starts making that real.

### Frontend

- A student's **Qualifications** tab: earned, with a download, and a revoked row that says
  so and when.
- An admin/teacher **Issue certificate** dialog, reachable from a completed enrolment.
- **Mobile:** a certificate is a file. Download-and-open is a link; the issue dialog is a
  short form. Neither needs a layout decision, which is the argument for not over-thinking it.

---

## Phase 4 — Onboarding a cohort →

**A school with a 30-person intake is currently reduced to `POST /users`, one at a time,
clicking `Add a user` thirty times.** There is no bulk import, no invite route, and no CSV.
This is the first thing a real user of this system will do and the first thing they will
give up on.

### Migration + policy

- No new model is strictly required. `User` + `StudentProfile`/`TeacherProfile` + a
  `Verification` row of purpose `EMAIL_VERIFY` already carry everything an invite needs.
  Add `Verification` rows in bulk rather than inventing an import table.
- Action `user:bulk-create`, ADMIN only, mirroring `user:create` (`docs/permissions.md`
  regenerates 46 → 47).

### Backend

- `POST /users/bulk` — a CSV or JSON array, **one transaction, one audit row per created
  user**, and a per-row result rather than a single all-or-nothing response. A school
  importing 60 people will hit 4 already-existing addresses and needs the other 56 to land.
  The response shape is `{ created, failed: [{ row, code }] }`.
- Rate-limited separately from the rest of `/users`, and size-capped.
- A dry-run mode that validates without writing, because the first thing an admin does with
  an import is upload the wrong file.

### Frontend

- An **Import cohort** button on `/admin/users`, a textarea-or-file input, the dry run, and
  a results table listing the failures with their row numbers.
- **Mobile:** this is a desktop task and should say so. The dialog is usable at 375px but
  the affordance belongs on the desktop layout; a `hidden md:flex` control with the reason
  in a comment is honest, and the repo's `check:mobile-first` script already forbids the
  `max-*` variants that "hide on desktop" would otherwise tempt.

---

## Phase 5 — Five holes where the API exists and the UI does not →

Each of these is an endpoint with a working policy gate and **no caller in the SPA**. They
are grouped because they are one shape of work and one review.

| Endpoint                                           | Who it is for | Why it matters                                                                                                                                                                         |
| -------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /enrollments/:id/withdraw`                   | STUDENT       | **A student cannot withdraw from a course they requested.** The app is about enrolment and the exit is missing. The empty-state copy already promises a reason field the API requires. |
| `POST /conversations`                              | any           | `/messages`'s empty state says _"Start one from a course page"_ — and no course page has the affordance. The copy is a lie.                                                            |
| `POST /conversations/:conversationId/participants` | any           | A thread with two people cannot become a thread with three, so group conversations are impossible.                                                                                     |
| `PATCH /users/:id`                                 | ADMIN         | An admin can create, suspend and reinstate, and **cannot correct a typo**.                                                                                                             |
| `POST /conversations/:id/read`                     | any           | Read state is local-only, so a student who reads messages on their phone sees them unread on their laptop.                                                                             |

`GET /users/:id`, `GET /enrollments/:id`, `GET /resources` and `POST /auth/logout-all` are
also uncalled; the first three are detail views worth having, `logout-all` is already
surfaced in Settings under different copy.

### Frontend

- The withdraw action belongs on the student's own course page and in the enrolment
  history, with the reason dialog the API already requires.
- A "Message" affordance on the course page, on a resource, and on a user row — all three
  feed one `POST /conversations` with a deterministic participant list.
- An admin edit-user dialog that reuses `UserCreateDialog`'s field set and the shared
  `updateUserSchema`, so validation has one source. `updateUserSchema` already exists and is
  used by `PATCH /users/me`; reusing it is the difference between one rule and two.
- **Mobile:** every one of these is a dialog or a row menu, both of which already have
  mobile layouts. The mark-read fix is not a screen at all — it is calling the endpoint on
  focus, which removes a class of "it forgot my phone" bug.

---

## Phase 6 — Account lifecycle →

- **Self-service account deletion.** `User` has `deletedAt`; nothing ever sets it, and no
  user can delete their own account. A school will be asked this by every student under
  whatever retention law applies to them. Needs: a confirm-by-typing dialog, a cool-off
  window rather than an instant delete, and an audit row — and it has to decide what happens
  to enrollments and certificates, which is why it comes after Phase 3.
- **Data export.** `GET /users/me/export` returning a JSON envelope of everything held
  about the viewer. A privacy request today is a database query by hand.
- **Withdrawal of consent / marketing preferences.** Settings had a fake notifications tab
  with four dead checkboxes promising email preferences; it was deleted in round one because
  it lied. It stays deleted until there is something behind it.

---

## Phase 7 — Retention, sweeping and backup ⇄

**Nothing in this repository grows forever, because nothing in it ever stops growing.**

- `Session`, `Verification` and `RecoveryCode` have **no sweeper**. The upload sweeper exists
  (`apps/api/src/modules/uploads/sweeper.ts`) and is deliberately tiny — it is the template
  to copy, and copying it three times is a small, high-value phase.
- `AuditEvent` grows without bound and has no retention rule. Careful: it is the compliance
  record, so its retention is a policy question, not a technical one. Do not invent a number.
- **Backup/restore is entirely absent**, and this is in `00-FEATURE-PLAN.md`'s Phase 0 as a
  rehearsal nobody has performed. A `pg_dump`/`pg_restore` against the compose Postgres,
  written as a script and run once, is worth more than any feature in Phases 8–10.

---

## Phase 8 — Make the audit claim true ⇄

`SECURITY.md` says the audit log is append-only. It is not: the `REVOKE` that would make
`AuditEvent` genuinely insert-only is **commented out**, so one of the repository's three
headline security claims rests on a comment. Either implement the `REVOKE` and grant the
app role `SELECT` + the insert path only, or amend `SECURITY.md` to say what is actually
guaranteed. **Doing neither is the one option not on the table** — a documented guarantee
that is false is worse than no guarantee.

Related, and cheap: the export (`GET /audit-events/export`) exists and is unused by the SPA.

---

## Phase 9 — Observability, scale and rate limiting →

- **Search builds unbounded `IN` lists** (`00-FEATURE-PLAN.md` Appendix, the raw-SQL
  ranking path) and will fall over well before 10k rows. It was correct when written and
  time-dependent now. Fix before the cohort counts grow, not after.
- **Rate limiting is one 300/min per-IP bucket shared with static assets**, keyed on an IP
  that is the load balancer's unless an operator reads `.env.example`. Split the API from
  the assets, and key authenticated routes on the user rather than the address.
- **No metrics, no error reporting, no tracing.** Logs go to stdout and stop. The request id
  already exists in the audit trail and in `problem+json`; surfacing it in logs and shipping
  them somewhere is the whole change.
- **No per-user upload quota.** `multipart` allows 50MB and one file (`app.ts:103-105`);
  thirty students can fill a bucket.
- **Every avatar is a third-party Dicebear request from the browser.** Round one left
  `toUserSummary` faces on DiceBear deliberately and recorded why. It is still the right
  default, but it is an availability dependency on an external host for every signed-in
  user, and that should be a decision rather than an inheritance.

---

## Suggested order, with what can run in parallel

|     | Phase              | Blocks         | Parallel with                                    |
| --- | ------------------ | -------------- | ------------------------------------------------ |
| 0   | Unblock (0a–0d)    | **everything** | nothing — it is the gate                         |
| 1   | Completion         | 2, 3           | 4, 5, 6 (none touch enrollments' terminal state) |
| 2   | Assessment         | 3              | 4, 5, 7                                          |
| 3   | Certificates       | 6              | 5, 7, 8                                          |
| 4   | Cohort import      | —              | 1, 2                                             |
| 5   | The five holes     | —              | 1, 2, 3                                          |
| 6   | Account lifecycle  | needs 3        | 7                                                |
| 7   | Retention & backup | —              | anything                                         |
| 8   | Append-only audit  | —              | anything                                         |
| 9   | Ops & scale        | —              | anything                                         |

**The critical path is 0 → 1 → 2 → 3.** Phases 4–9 are independently valuable and none of
them waits for another. If only three things ever get built, build those.

---

## Rules every phase inherits

From `docs/LESSONS-LEARNED.md` and `docs/adr/`, restated because every phase above violates
at least one of them by default:

1. **Policy is data.** No `if (role === ...)`. A new action is a type error until it has an
   anonymous case and all three roles. Regenerate `docs/permissions.md` in the same commit.
2. **Throw the error helper, never a string.** `apps/api/src/lib/errors.ts:19` — `AppError`
   is the only type route and service code may throw deliberately, and the SPA renders
   `problem.code` and never `detail`, so **the code is the whole contract**.
3. **The SPA renders the code, never the detail.** Policy details carry rule names like
   `TEACHER:ownsCourse` and are not user copy.
4. **A body that may be absent is `.nullish()`, never `.optional()`.** Fastify hands a
   bodyless POST to the validator as `null`.
5. **Visibility is a WHERE clause, never a second policy mirror.** Prisma resolves each
   module's `visibilityWhere` to an id set; if the SQL and `policy.ts` disagree, **the SQL
   is the bug.**
6. **An absent subject field denies.** This is the #31 trap and it has cost three features.
7. **Do not widen a gate to make a UI work.** That is the #15 mistake.
8. **The phone is the baseline.** Every frontend phase above says what it does at 375px,
   because the current suite proves the 44px floor on `/login` and nowhere else.
9. **Verify against the artefact, not the source.** A white screen shipped on `main` once
   because every gate read the source and none opened what it built.
10. **A comment cannot hold an invariant.** If the rule matters, the structure enforces it.
