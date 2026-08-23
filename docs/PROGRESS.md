# Progress

What has actually happened, newest first. One or two lines per entry, dated.

This file records **what changed and the state it left the repository in** — not what is planned. `docs/rebuild/00-REBUILD-PLAN.md` is the backlog and `NEXT.md` is the single next task. Entries carry their verification status, because _written_ and _observed passing_ are different facts:

- **verified** — a command was run and its output was read.
- **written** — the code exists and has never executed.

---

## 2026-08-23

**Phase 1 backend is in — notifications are real.** _(verified — the full API suite re-run independently: 368/368 across 14 files, exit 0)_
One `notify()` writer (`notifications.service.ts:271-276`, one `createMany`, catches its own failures, called after the triggering transaction commits), and all seven events wired: enrolment requested/approved/rejected, resource published, announcement published (both go-live paths, actor excluded), message received, comment replied. `approve()`/`settle()` restructured to return `{enrollment, changed}` so idempotent repeat clicks never re-notify. 17 new tests pin recipient exactness, closed payloads, retry idempotency, draft→publish→unpublish→re-publish, and that a failing notify leaves the approval at 200 with the badge at 0. Deviations documented where they should be: announcements are school-wide (no course relation — audience adapted to APPROVED-enrolled students anywhere), resources publish on creation (they have no publish verb), withdrawal silence cites the plan. Committed `8105d2b`.

**The feature roadmap survived adversarial re-verification, and phased execution started.** _(verified — five independent readers fact-checked every claim against source before a line was built)_
Every load-bearing claim confirmed; their corrections are folded into [`docs/roadmap/00-FEATURE-PLAN.md`](roadmap/00-FEATURE-PLAN.md): search must combine tsvector with the pg_trgm indexes or code lookups regress (`0002:82-90`); the publish route has the bodyless-POST 422 trap (`courses.routes.ts:108-111`) and Phase 2 carries its one-line fix plus regression test; demo-role delete denials (`provenance:DEMO`) need honest UI copy or the flagship demo reads broken; attendance keyed to `enrollmentId` conflates re-used enrolment rows — date-scoped register semantics chosen deliberately; `avatarUrlFor()` takes only `userId`, so preferring an uploaded avatar threads relations through callers rather than swapping one function. Decisions recorded instead of left open: `ACCOUNT_SUSPENDED` stays unwired until a reinstate endpoint exists; the fake Settings notifications tab (`Settings.tsx:428-453`) is removed by Phase 1; **Phase 4b added** (editable profiles + `user:create` provisioning against the already-complete `createUserSchema`); **Phase 0 deferred by owner decision**. Execution order: Phase 1 backend ⇄ Phase 2, then Phase 1 frontend ⇄ Phase 3 backend, then onward.

**Announcements and comments are built, and the resource detail screen exists.** _(verified — driven in a browser as a student, a teacher and an admin)_
Seven agents in parallel, one file each. The announcements module serves list / read / create / update / publish / soft-delete with visibility as a WHERE clause mirroring the policy rows. The comments module threads one level and — the part that mattered — scopes every comment to its **parent's** visibility, importing the resources module's `visibilityWhere` rather than writing a second copy of it. `/resources/:id` is screen 5 of the six the plan names and did not exist at all; a comment was posted through it live (`201 POST /comments`). Messages and the admin overview gained pagination, and the overview now shows recent audit events instead of four counters. **axe clean** on all three new screens. **977 tests** (600 policy + 350 API + 27 web).

**The danger button failed AA on every destructive action in the app.** _(verified — axe caught it, the ramp was tabulated before choosing)_
`variant="danger"` used `text-fg-on-brand`, which is the dark ink the design direction chose for the **amber** brand fill. On oxide red that is **3.91:1**. The two themes needed different answers because the solid differs between them, so the ramp was measured rather than guessed: light gets white on oxide-600 (4.65), dark gets iron-950 on oxide-500 (5.06), and the fill still clears 3:1 against its own page in both. `--text-on-danger` is now its own token.

**The new screens shipped with no way to reach them.** _(verified — no nav entry existed)_
Routes and pages landed; the nav did not. Added ungated, deliberately: `announcement:read` is `isPublished`-based, so gating on it denies everyone and deletes the link (#15), and `announcement:create` is TEACHER/ADMIN-only, which would hide the board from the students it is for. Adding a sixth primary entry would also have pushed an admin's bottom bar past the five-target limit, where `primaryNav` silently slices the last one off — so Settings yielded its slot, since the account menu carries it at every viewport.

**A defect I reported that did not exist.** _(recorded because the withdrawal is the useful part)_
I claimed the announcement and course cards had no keyboard focus indicator, called it pre-existing, and changed both files to add one. The premise was false. My probe read the anchor's `::after` and reported the anchor as 0×0; measured properly — tab until the link IS `activeElement`, then walk the ancestor chain reporting every element that paints an outline and its box size — the anchor is **607×20 and paints a `solid 3px` ring**. Both files are reverted; `Courses.tsx` is byte-identical to its committed state. Four wrong measurements of the same thing before the fifth was right, which is [26] exactly, and the cost was entirely avoidable.

**A teacher can now add course material without an API client.** _(verified — a real PDF, through the form, in a browser)_
The Resources tab has an "Add a resource" affordance and a per-row Edit/Delete menu, and the dialog serves both create and edit. Driven end to end: **`201 POST /uploads/presign` → `200 POST /uploads/commit` → `201 POST /resources`**, the new row at the top of the list, no console errors, and **axe clean on the open dialog**. A student sees no Add button and no row menu. The accepted types and the size limit are on screen before the picker rather than after a 422, and a file that breaks them is refused on selection.

An edit changes metadata only. `updateResourceSchema` has no `uploadId`, so the file behind a row cannot be swapped, and the dialog says so rather than offering a control the API would refuse.

**Every message the upload client wrote for the user was being thrown away.** _(verified — the whole translation layer was dead)_
`uploadFile` turns the object store's failures into sentences a person can act on — "that link has expired, or the file changed since you chose it". `toast.fromError` replaced all of them with "Could not add that resource", because it trusts only `ApiError.userMessage` and is right not to trust an arbitrary `Error.message`: that could be a `TypeError` from a bug. The fix is a distinct `UploadError` class, so the one error type whose message IS user copy is shown directly and everything else keeps the safe path.

**A failed save after a successful commit orphaned the bytes, once per retry.** _(verified by reading the flow)_
A 409 on the POST — or a session that expired during a long PUT — left a COMMITTED upload with nothing pointing at it, and pressing the button again uploaded the file a second time. The committed upload is now remembered across retries, keyed on the `File` object itself, so a retry reuses it and choosing a _different_ file still uploads the new one. Nothing sweeps orphans; that is why this mattered.

**Two accessibility defects in shared components, not in the new screen.** _(verified in the browser's own accessibility tree)_
`Checkbox` rendered its label and its hint inside the wrapping `<label>`, and everything inside a label is the control's accessible NAME — so a checkbox whose hint explained a policy in two sentences announced as a **57-word name with no description at all**. And `Button` set the native `disabled` attribute while `loading`, which removes it from the tab order: in a dialog whose every field is disabled during a save, that left **zero focusable elements**, the focus trap had nothing to hold, and focus escaped to the document body for the whole request — minutes, on a large upload. The checkbox's hint is now a description (`name` 5 words, `description` the policy text, confirmed live) and a busy button stays focusable with `aria-disabled` + `aria-busy`, its click intercepted so Enter cannot double-submit.

**`api.ts` carried an option that invited a session leak.** _(verified — zero callers)_
`raw?: boolean`, commented "used only by the direct-to-object-store upload PUT". Uploads arrived and did not use it. They could not have: every request through that client sets `credentials: 'include'` and prefixes `API_BASE`, so routing the PUT through it would have sent the `__Host-sw_session` cookie to the object store. It also needed an `as BodyInit` cast, which this repo forbids. Deleted.

**A citation pointed at a lesson that had never been written.** _(verified — the document contained no mention of "outline")_
Two reviewers flagged that the new code cited `docs/LESSONS-LEARNED.md` for the Tailwind v4 `outline-none`/`outline-2` behaviour. They were right: those focus rings were fixed in an earlier session and recorded only in commit messages. Rather than re-anchor the citation, the lesson is now written — #36 — which makes it true and records a trap every new focusable control in this repo has to know.

**Green — observed on 2026-08-23:** **921 tests** (600 policy + 294 API + **27 web**, up from 9) · typecheck 5/5 · lint 3/3 · build 3/3 · `format:check` · `check:brand` · `check:mobile-first` · `docs:permissions --check`.

**Still open:** no byte-level upload progress — `fetch` exposes no upload-progress event, and moving the PUT onto XHR is its own change. Nothing sweeps abandoned uploads.

**Golden path 3 is driven, and the object store itself refuses an unauthorised read.** _(verified — a real file, through a browser, end to end)_
A teacher signed in, presigned an upload, PUT a genuinely valid PDF, committed it and filed it as a course resource; the Download button — which had rendered with no `onClick` since the day it was written — fetched a signed URL and returned **the exact 69 bytes that went in**, under the original filename rather than the ULID key. Then, against a public and a private resource in turn: the owning teacher and an approved student pull the bytes; a non-enrolled student is **403** on the private one; an anonymous caller is **401 on download while still 200 on read**, which is the narrowing `resource:download` exists to draw; and **the raw unsigned object URL answers 403**. That last one is the only assertion in this repository that proves the bucket refuses an unauthorised read rather than the policy layer refusing on its behalf. **axe: zero violations** on the tab with the new controls. All five golden paths have now been driven.

**A presigned PUT constrains only what the signature names.** _(verified — measured against MinIO, not assumed)_
`ContentType` was set on the command and looked enforced. SigV4 query signing puts only `host` in `SignedHeaders`, so it was a suggestion the store never read: a PUT declaring `application/pdf` and sending `image/png` was **200, stored**, and a 500-byte body against a signature for 23 bytes was **200, stored**. That second one mattered most — `UPLOAD_LIMITS.maxBytes` was enforced only by the zod check in front of it, so an authenticated caller could declare a 1 KB avatar and park half a gigabyte at that key. `commit` refuses the row; the bytes stay, in a bucket with no sweeper. Both headers are signed now and the store answers **403 SignatureDoesNotMatch**. What it still does not buy: the bytes are never sniffed, so `contentType` remains the uploader's label — the comments that called it "verified server-side" now say so.

**A resource marked public inside an unpublished course was world-readable.** _(verified — probed before the fix, and again after)_
`resource:create` is `ownsCourse` with no publication term, so a teacher can file material into a course nobody has published, and `resource:read`'s anonymous rule was `isPublic` alone. Measured against the running API: anonymous got **401 on the draft course and 200 on its resource**, title and description included, plus a row in `GET /resources`. The public branch of `resource:read` and `resource:download` is now `and(isPublic, isPublished)`, with the course's `publishedAt` carried on the subject and mirrored in the SQL and on the web client. Re-probed: **401, and zero rows**. The other branches are untouched on purpose, and four tests pin what the narrowing must not have cost — an approved student keeps access after their course is unpublished, and the owning teacher still sees their own draft.

**The new module was invisible to git.** _(verified with `git check-ignore`)_
`.gitignore` held a bare `uploads/`, which matches a directory of that name at **any** depth, so `apps/api/src/modules/uploads/` was on disk, compiling, passing its tests and impossible to commit. It would have shipped as an `import` of a file not in the repository. Anchored to `/uploads/`. Found by a review agent, not by me.

**`pnpm typecheck` had never looked at the test suite.** _(verified — twelve files, and eight of them were wrong)_
`apps/api/tsconfig.json` sets `rootDir: "src"`, so `test/` cannot be added to its `include`. There is now a `tsconfig.test.json` that typechecks both under the same strict flags. It immediately found that eight of the twelve suites declared `let app: FastifyInstance` — the exact thing `app.ts` documents as forbidden: _"Anything that holds an instance built here … should name this type. Plain `FastifyInstance` is a type error, not a widening."_ It was a type error the whole time. Nothing was checking.

**Also fixed:** migration 0003 makes `Resource.uploadId` `RESTRICT`, retiring the deadlock `NEXT.md` has carried since the schema was written — `SetNull` plus the 0002 CHECK meant "clear the column, and also never let it be clear", so deleting a backing upload always failed, with an error about a column the caller never named. `syllabusUploadId` was written from the request body unchecked, letting a teacher bind a colleague's private file to their own course; one `assertUploadClaimable` now serves resources, syllabi and avatars, and checks committed-ness too. The `Content-Disposition` sanitiser cleaned only the quoted fallback while `filename*` — the form browsers prefer — was built from the raw name, so a right-to-left override survived percent-encoded; and the same name came back raw in the download JSON. Eleven `file:line` citations pointed at the wrong lines, several by exactly the width of a comment this change had added to the cited file.

**Still open:** the test suites write objects into the same MinIO bucket as development and nothing removes them — 83 objects for two live resources. There is no create-resource form; `POST /resources` is reachable only by an API client.

**The resources module is built, registered and driven in a browser.** _(verified — six endpoints, plus the nested list the SPA had been calling since before it existed)_
`GET /resources`, `GET /resources/:id`, `POST`, `PATCH`, `DELETE` (soft), and `GET /courses/:courseId/resources`. The nested list is gated on `course:read` rather than `resource:read`, because a non-enrolled student is still entitled to a course's PUBLIC resources and a resource-shaped gate would 403 a caller who should get a filtered list — the rows are narrowed by `visibilityWhere`, which mirrors the `resource:read` policy rows as SQL. `GET /resources` carries no subject gate at all, for the reason lesson 15 records: a subject-free `can()` would deny every caller including admins. Download stays unbuilt on purpose; it needs MinIO presigning and collides with the `Resource.uploadId` SetNull-vs-CHECK conflict.

Written by a multi-agent workflow — three builders on disjoint files, then four review lenses each piped into a verifier whose job was to refute. **24 findings survived refutation, 15 did not.**

**The dashboard tile and the resources list had already drifted apart, inside one change.** _(verified — 24 vs 4, now 24 = 24)_
`dashboard.service.ts` carried an explicit instruction to whoever would build this module: move the visibility mirror into `resources.service.ts` and import it back, _"do not leave a second copy behind, or a policy change fixes the list and silently misses the tile."_ The module landed with a second copy, and the two disagreed immediately: the new one excludes resources whose COURSE is soft-deleted, the old one did not, so the tile counted rows no list would ever return. `visibilityWhere` is now exported and imported, and a test pins `stats().resources` to `GET /resources` `meta.total` for three roles with both a soft-deleted course and a soft-deleted resource in the fixture, so the equality cannot pass as `0 === 0`. The test that should have caught it was already there, named _"drops a soft-deleted course out of every counter that reaches it"_ — it asserted two counters of four, and not the one that was wrong.

**An anonymous caller could 500 the list with `?sort=toString`.** _(verified — reproduced by reading the lookup, then fixed and pinned)_
The sort whitelist was an object literal, so `ORDER_BY['toString']` is not `undefined` — it is `Object.prototype.toString`, a function, which passes the `?? DEFAULT` guard, gets called, returns a **string**, and hands Prisma `orderBy: '[object Undefined]'`. `?sort=valueOf` throws outright. Guarded with `hasOwnProperty`; three regression cases assert the resulting **order**, not merely a 200, because a fallback that ordered by nothing would answer 200 too.

**Public resources were served to `curl` and hidden from the UI.** _(verified — four rows, invisible to every signed-in non-admin, now visible to all)_
`CourseDetail.tsx` gated the Resources tab on `policy.can('resource:read', viewerSubject)` where `viewerSubject` is a **course** — and a course has no `isPublic`, only `publishedAt`, so that disjunct could never fire. A teacher looking at a colleague's course, and any student not enrolled, saw "Resources are for enrolled students" over a list the API would have served them anonymously. The tab no longer asks: the server scopes the rows and the client renders what it is given. The empty state stopped claiming "the teacher has not published anything", which a viewer seeing only the public slice cannot know, and lost an "Add a resource" button that called `() => undefined`.

**The `(root)` field-error path was unreachable.** _(verified against a running server, then fixed)_
`errors.plugin.ts` tested `instancePath.length > 0` **before** stripping the leading slash. A whole-body refinement has an empty zod path, which arrives as `'/'` — length 1 — so it took the first branch and stripped it to `''`. `PATCH /resources/:id` with `{}` answered `errors: [{ path: '', … }]`, while the identical refinement thrown from service code reported `(root)`. `Settings.tsx:67-70` is written against `(root)`.

**Five citations in the new comments pointed at the wrong lines.** _(verified line by line)_ In a codebase that navigates by `file:line`, a confident wrong anchor is worse than none. A sixth proposed correction was itself wrong and was dropped rather than applied.

**Two false alarms of my own, both stopped before damage.** _(recorded because the near-miss is the useful part)_ I fanned two agents out to run `vitest` against the one shared test database — the exact collision that had wedged it during the first workflow and produced a report of "172 of 241 failing" in files nothing had touched. Stopped it, gave each agent its own migrated database, and relaunched — then noticed I had relaunched the script before wiring the databases into it, and stopped it again.

**Green — observed on 2026-08-23:** **863 tests** (592 policy + 262 API + 9 web) · typecheck 5/5 · lint 3/3 · build 3/3 · `format:check` · `check:brand` · `check:mobile-first` · `docs:permissions --check`. In a browser, against seeded data, the Resources tab now serves an approved student 4/4, a non-enrolled student 0/4 with honest copy, the owning teacher 4/4 and an admin 4/4 across a private and a public course; anonymously the API answers 4 public, 0 private, and a 20-row global shelf that matches the database exactly. **axe: zero violations** on the Resources tab, which has never before had data to render.

**Still open:** there is no UI for creating, editing or deleting a resource — `POST`, `PATCH` and `DELETE` are reachable only by an API client. Download is unbuilt.

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
