# Skillwright — Rebuild Roadmap

**From:** Principal engineer review — **Revision 2**
**Date:** 2026-08-16
**Basis:** ten-area audit + architecture, design, and positioning briefs + adversarial review of Revision 1
**Status:** Plan of record. Supersedes the 2026-08-10 draft.

---

## 0. What changed in this revision, and why

Revision 1 was a good engineering document and a bad plan. It priced a 490-hour project at 268 hours, put the first shareable link at hour 162 (realistically hour 318), and never mentioned the single most important fact about this repository: **it has not been touched in eleven months.**

Six changes:

1. **The verdict is now three options with honest prices and honest odds.** The cheap path — make the repo you already have runnable and deployed — is no longer forbidden. It is the recommendation, and it comes first.
2. **The rebuild is narrowed.** One repo, three packages, Express, Tailwind v3, react-router — the tools you already have. Roughly thirty first-time technologies became about eight. That removes ~90 hours and seven ways to die in a config file.
3. **Layer-by-layer became slice-first.** A deployed URL with a login screen and real data now lands at hour 50, not hour 162.
4. **Estimates are corrected upward and stated against your measured cadence, not an aspirational one.**
5. **The security, accessibility, and mobile work moved earlier** — into the phases where the code is written, not into a hardening phase eight weeks after the public ship.
6. **Every gap the adversarial reviews found is closed**: CSRF, enumeration-safe auth, session revocation on reset, secret-leak checks, responsive shell, error pages, form UX, upload UI, demo-database isolation, brand surfaces, backup rehearsal, running cost, dependency automation. Plus two appendices so the document is self-sufficient — it no longer references briefs it does not contain.

---

## 1. Verdict

### The fact the first draft left out

```
git log: 132 commits, 2025-02-16 → 2025-09-17
20 active days across 214 calendar days
45 commits on 2025-06-19; 25 on 2025-08-20; 15 on 2025-09-16 — bursts, not cadence
Gaps: 7 weeks (Mar 18 → May 7), 5 weeks (May 15 → Jun 19),
      7 weeks (Jun 20 → Aug 9), and 11 months (Sep 17 2025 → today)
```

Revision 1's risk table had an entry called **"Two-week gaps."** The observed gaps are seven weeks, seven weeks, and forty-seven weeks. A six-month, 11-hour-per-week plan written against that record is not a plan; it is a wish. Everything below is structured so that **each stopping point leaves you with something shippable**, because the base rate says you will stop at one of them.

### Is this worth doing?

**Yes — the first forty hours, unconditionally, starting this week. Conditionally after that.**

The repository as it stands is a net negative on your CV: it does not build, it cannot be run by a stranger, and the fourth row of its file listing is `node_modules/`. Forty hours converts it from a liability into a modest asset. That is the highest-return work available to you by a wide margin, and it is work Revision 1 explicitly forbade on the grounds that "it changes no reviewer's conclusion." That was an assertion, and it was wrong: a runnable, deployed, demoable repo with an honest README changes the conclusion from *"cannot evaluate"* to *"can evaluate, and it works."*

The rebuild is worth doing **after** that, and only if you clear the gates. It is a real project with a real differentiator. It is also five months of evenings that history says you may not have.

### Three options, honestly priced

| | Option A — Salvage | Option B — Narrow rebuild | Option C — Revision 1 |
|---|---|---|---|
| **Hours** | **≈40** | **≈178 to public ship**, ≈216 with hardening + pitch | ≈490 |
| **Calendar at 8 h/wk** | 5 weeks | +22 weeks (ship ≈ week 27) | ≈14 months |
| **Odds you finish** | ~90% | ~55% | ~25% |
| **Result** | The existing repo builds, runs, deploys, seeds real data, has a demo login and a README with screenshots and an honest limitations section. Not impressive. Not embarrassing. | `skillwright` — one `User` table, a generated permission matrix, uploads that are actually private, enrollment that cannot oversell, a real design system, six good screens, deployed, tested, documented. Three provable claims. | The above plus realtime, audit log, a contracts package, E2E across three browsers, and thirty first-time tools. |
| **If you stop halfway** | You have a working repo | You have a working repo (A already shipped) | You have a `docker-compose.yml` |

**Recommendation: do A this month regardless of what you decide about B. Then decide about B with a shipped repo already behind you. Do not start C.**

Realtime and the audit log are not deleted — they become **increments on a live repository** (§6), each entered by choice after the ship. That is strictly better than being phases inside an unshipped one.

### Headline recommendation

| | |
|---|---|
| **Name** | **Skillwright** — *Where skills are made.* Repo slug `skillwright`, demo at `skillwright.dev`. **Applies to Track B only.** Do not spend one minute of Track A's forty hours on branding. |
| **Positioning** | *"A permissions-first training platform. It happens to teach welding."* The domain is the stage, not the pitch. |
| **Action** | Track A in the existing repo, existing name, deployed to `*.fly.dev`. Track B in a fresh repo, new history, old repo kept as a **specification artifact** and pointed at the new one. |
| **Target** | **Track B shipped and public at ≈218 cumulative hours.** Do not chase "exceptional" in this domain. |
| **Three signature claims (Track B core)** | Policy-as-data with a generated, CI-enforced permission matrix · enrollment that cannot oversell, proven under 200 concurrent requests · private files that are actually private. |
| **Two more, if increments happen** | Realtime that survives a tunnel (B+1) · an audit log you cannot forget to write (B+2). |

### What survives from the old code

Not percentages — percentages about software that does not exist yet are decoration. Here is what specifically ports:

| Survives | Detail |
|---|---|
| **The academic decomposition** | `Department → Course → Enrollment → Resource → Comment`. Carry the cardinalities over verbatim. `Enrollment @@unique([studentId, courseId])` plus a status enum is textbook and stays exactly as written. |
| **The domain decisions** | Enrollment state transitions. What capacity means when approval is asynchronous. `isPublic OR (enrolled AND APPROVED)` visibility. Per-side unread counts. Cursor pagination on a chat feed. The `CommentReplies` self-relation shape. These took 40–60 hours to get right and rediscovering them elsewhere is the slowest work in any project. |
| **Email copy** | Six templates in `backend/src/utils/sendEmail.ts` (553 lines) are the same header/footer copy-pasted six times. The prose survives; the markup does not. |
| **The realtime design** | Auth in `io.use()` *before* the connection handler. DB re-check of ban status on handshake rather than trusting a claim. Membership-verified room joins. Room-per-conversation topology. All four are correct and above the level of most projects at this tier. Zero lines survive literally. |
| **Frontend fragments** | `Home.tsx` copy (the words, not the JSX), the five image assets, the chat's visual proportions, the shape of `router/routes.ts`, the data-driven `menus.tsx`. |

### The two real counter-arguments

**1. You already stopped once, for eleven months, and nothing in this plan explains why.** If the answer is *"I got busy,"* then the plan must survive multi-month gaps — and no plan does, which is the entire argument for Track A landing something shippable in five weeks. If the answer is *"I lost interest in this domain,"* then a five-month rebuild of the same domain is the worst available response, and you should do Track A, tag it `v1.0.0`, and start something you have a personal stake in. Not another generic CRUD brief — trading "training institute" for "gym management" buys nothing and costs two months.

**2. Two of the three core claims do not require the rebuild.** The permission matrix and the oversell test could be a 40-hour standalone repo — `skillwright-policy`, three endpoints, two provable properties, a README. If the domain genuinely is "the stage, not the pitch," then rebuilding the entire stage is the part that does not follow. This is a legitimate third path and you should consider it honestly before committing to Track B.

---

## 2. State of the code today

Grounded in the audit's own evidence. This section exists so that when Track B's phase B3 feels endless, you can reread it and remember why.

### The first ninety seconds

A reviewer opens `github.com/kaleem-Durrani/Millat-vocational-training` and sees a bare file listing with **no README** — the only README in the repo is `frontend/README.md`, still the verbatim Vite template telling the reader to set `react: { version: '18.3' }` in a React 19 project. Row four of that listing is `node_modules/`: **1,509 of 1,814 tracked files (83%)**, added in commit `16a6c70 "first commit"` (1,530 files, 624,432 insertions). `.gitignore:1` lists `node_modules` but git does not untrack already-tracked paths, so the rule has never applied. `.git` is 17 MB, fully unpacked.

The three most recent commits on `main` are `style: Update typography and spacing`, `style: Enhance typography and spacing in Home component`, and `refactor: Clean up commented code`. The last thing the author did, eleven months ago, was adjust font sizes.

### It does not build

`frontend/package.json:8` defines `"build": "tsc -b && vite build"`. `tsc -b` emits **131 errors across 50 files** and never reaches vite:

- `src/pages/admin/conversations/components/index.ts:7` — `TS2307: Cannot find module './CreateConversationModal'`. A dangling import committed to main.
- `src/common/types/index.ts:3` — `TS2308` ×2, duplicate `Student`/`Teacher` exports from two barrels. The ambiguity silently resolves to the wrong one.
- `src/services/index.ts:17-23` — 12 errors re-exporting `PaginatedResponse`/`QueryParams` from six modules that declare them locally without exporting.
- 25 × `TS2339` — `Property 'department' does not exist on type 'Student'`, `Property 'items' does not exist on PaginatedResponse`. The hand-written frontend types have drifted from what the API returns.

`npx eslint .` reports **270 problems** (154 `no-explicit-any`, 87 unused vars, 18 `exhaustive-deps`) against the *stock Vite config* with no type-aware rules enabled. The backend has no linter at all.

The dependency list has its own tells: root `package.json` pins `express ^4.21.2` against `@types/express ^5.0.0` — the types are for a major version that is not installed. `frontend/package.json` depends on `@hookform/resolvers ^5.0.1` while `react-hook-form` itself is absent.

### There is no production path

Root `package.json:7-10` has exactly two scripts: `dev` and `seed:admin`. **No build. No start. No test. No lint.** `tsconfig.json:6` declares `outDir: ./backend/dist` and nothing ever emits there. `backend/prisma/` contains one file — `schema.prisma` — with **no `migrations/` directory, ever** (`git log --all -- '**/migrations/**'` is empty). `npx prisma validate` from the repo root **fails**: Prisma cannot find the schema, and there is no `prisma.schema` key in package.json, so `npm install` on a fresh clone does not generate a client.

`backend/src/index.ts:39` hardcodes `origin: "http://localhost:5173"`. There is no Dockerfile, no compose file, no `.github/` directory, and no YAML file of any kind in the repository.

And the one script that does exist is broken: `nodemon --dump` reports `watching extensions: js,mjs,cjs,json`. The backend is entirely `.ts`. **Editing a backend TypeScript file has never triggered a restart.**

### The structural defect

Three identity tables — `Admin` (`schema.prisma:17-33`), `Teacher` (`:35-60`), `Student` (`:62-85`) — each carrying its own `email @unique`, `password`, `otp`, `otpExpiry`, `isVerified`. Roughly 20 duplicated columns. Measured downstream cost:

| Duplication | Measurement |
|---|---|
| `auth.studentController.ts` (444) vs `auth.teacherController.ts` (438) | 94 diff lines of ~880 — **~91% identical** |
| `auth.studentRoutes.ts` vs `auth.teacherRoutes.ts` (46 each) | **0 diff lines** after normalizing the role word |
| `StudentResourceComments.tsx` (588) vs `TeacherResourceComments.tsx` (595) | **41 diff lines** — the two largest frontend files |
| `student/.../MessageInput.scss` vs `teacher/.../MessageInput.scss` (164 each) | **byte-identical**, same md5 |
| `admin/.../StatisticsCard.tsx` vs `teacher/.../StatisticsCard.tsx` (46 each) | **byte-identical** |
| `TeacherFilter.tsx` vs `StudentFilter.tsx` (77 each) | 6 diff lines |
| `authMiddleware.ts:53-138` | three ~28-line guards differing only in which table they query |
| `conversation.routes.ts:32-44` | 12 routes = 6 handlers mounted twice because the guard differs |

The copies have already **diverged into a security bug**: `auth.studentController.ts:306-310` enforces an OTP-resend cooldown; `auth.teacherController.ts:303-307` dropped it, so teacher accounts have an unthrottled, unauthenticated mail-bomb endpoint that student accounts do not.

And the schema physically cannot express the app's own feature: `Conversation { teacherId, studentId }` (`:182-194`) cannot seat an admin, so `frontend/src/pages/admin/conversations/AdminConversations.tsx` ships a 40-line Ant `Alert` reading **"Feature Under Development"** while 462 lines of fully-written sibling components sit unreferenced beside it.

### The findings that end a review

- **`backend/src/routes/auth.adminRoutes.ts:24`** — `router.post("/signup", signupAdmin)` under a comment reading `// Public routes`, no auth middleware, no validator. The controller creates the row with `isActive: true, isVerified: true` hardcoded, directly beneath its own doc comment claiming `@access Private (Only existing admins can create new admins)`. **Anyone on the internet can mint themselves a full admin account.**
- **`conversation.controller.ts:99, 160, 257`** — three bare `async (req, res)` handlers with no `asyncHandler` and no try/catch, each throwing on failure paths. Express 4 does not observe the rejection. Any authenticated user takes the process down with one `GET` to a nonexistent conversation ID.
- **`resource.controller.ts:291-295`** — `extractPublicId` splits the Cloudinary URL on `/` and takes the last segment, discarding the `millat-vocational-training/` folder prefix that `cloudinary.ts:37` added. Every `destroy()` call has targeted a nonexistent ID and returned `{result:'not found'}`, never checked. **Every file ever uploaded — including every "private" one and every "deleted" one — is permanently, publicly downloadable.**
- **`resource.controller.ts:85-89`** — `updateResource` deletes the old asset *before* uploading the replacement. Any upload failure is unrecoverable data loss.
- **`generateOTP.ts:3`** — `Math.floor(100000 + Math.random() * 900000)`, stored in plaintext, with no rate limiting anywhere in the app, no attempt counter, and one column pair serving both email verification and password reset. A 10⁶ keyspace, sprayable in under 90 minutes.
- **`errorMiddleware.ts:37-42`** — the global error handler, on the path every 4xx and 5xx takes, contains `console.log('printing status code')`, `console.log('printing response')`, `console.log('printing response end')`. It also returns the stack in the response body.
- **`tokenUtils.ts:63-78`** — `deleteAllRefreshTokens` is fully implemented and has **zero callers**. Password reset does not invalidate sessions.
- **`frontend/src/router/ProtectedRoute.tsx:13-14`** — a committed comment reading `// localStorage.setItem('user', JSON.stringify({ id: '1', name: 'Test User', userType: 'admin' }))`, labelled "command for checking the mock authentication". It is an accurate, working client-side privilege-escalation recipe sitting in the auth file.
- **`frontend/src/router/routes.ts:5-43`** — all 27 `lazy()` calls resolve `import('../pages')`, a barrel re-exporting all 31 pages. **Code splitting produces exactly one chunk.** The login page ships the entire admin console.
- **`frontend/src/index.css:13`** — `font-family: 'Times New Roman', Times, serif` on the `*` selector. The entire product renders in a serif system font while `tailwind.config.js:22` declares an `Inter var` that is never loaded.
- **Four indexes in 269 lines of schema**, all on `RefreshToken`. `Message.conversationId` is unindexed, so every chat open is a sequential scan. `Conversation.studentId` is not covered by `@@unique([teacherId, studentId])`, so every student inbox load scans.
- **`student.controller.ts:604-638`** — `findFirst` → `count` → `create`, three unsynchronized statements. Capacity is trivially exceedable.
- **Eleven endpoints return bcrypt password hashes, OTP codes and OTP expiries** to the client, because the controllers return raw Prisma rows with no projection.
- **Zero tests. Zero CI. Zero migrations. Zero `aria-*` attributes across 120 components. Zero error boundaries. Zero `prefers-reduced-motion` queries.**

### The counter-reading, which is also true

`npx tsc --noEmit` on the **backend** returns **0 errors across 53 files under `strict: true`**. Refresh tokens are opaque `crypto.randomBytes(40)` values persisted server-side with rotation — revocable, which many working professionals get wrong. The socket handshake verifies a distinct `purpose: 'websocket'` claim and re-checks ban status against the DB. `services/api.ts:54-119` implements a single-flight refresh mutex with a replayed failure queue — genuinely correct concurrency reasoning. `.env` was never committed across 132 commits. Ownership checks on courses, conversations and comments are present and correct. `frontend/src/common/types/auth.types.ts:1-35` already sketches the unified `User` model the database should have had. `backend/src/issues.txt` shows the author independently identified the auth duplication, the inconsistent `asyncHandler`, the `Math.random()` OTP, and the missing rate limiting.

**This is not incompetence. It is a developer with real instincts who was fighting their own data model and ran out of time.**

---

## 3. Sequencing logic

Read this before the phase tables. Five decisions drive the order, and three of them reverse Revision 1.

**1. Ship the thing you already have before you build the thing you want.** Track A is not a warm-up and it is not a consolation prize — it is a hedge that costs 40 hours and pays out in every branch of the tree. If you never start Track B, you have a working repo. If you start Track B and stop in month three, you still have a working repo. If you finish Track B, Track A's deployment, seed data, demo-mode design, and screenshots all transfer, and its old UI becomes the "before" half of the most persuasive README asset available to you.

**2. One vertical slice goes before every generalized layer.** *(This reverses Revision 1.)* Revision 1 sequenced layer-by-layer: all schema → all contracts → all policy → all API → all UI, putting the first screen at cumulative hour 148 and the first shareable link at 162. That maximizes time-to-first-screenshot, which is exactly the metric that predicts abandonment for a solo developer whose failure mode is stopping. Instead, phase B1 builds **login → course catalog → course detail → request enrollment → teacher approves**, end to end: 7 models, 6 endpoints, 8 policy actions, 4 screens, deployed. **Hour 50, not hour 162.** Generalize afterward, against something you can already screenshot. The policy layer still precedes the *rest* of the API — but not the first screen.

**3. Deployment is a week-2 problem, not a week-24 problem.** The most common failure in rebuilds is deferring deploy until "it's ready," at which point cookie handling, CORS, migration-on-boot, and build-in-CI all explode simultaneously. Track A deploys in its final phase; Track B deploys inside B1. Every subsequent phase pushes to that same environment. Structured logging (pino + a request ID) ships with the first deploy, not in a hardening phase twenty weeks later — otherwise you debug production with `console.log` for five months.

**4. Design tokens and accessibility are foundations, not polish.** The instinct is to treat both as finishing work. That is precisely the mistake the current repo made: 213 hardcoded hex values across 32 files, 166 inline style objects, a `primary` colour ramp with **zero usages**, and zero `aria-*` attributes — all because the tokens and the a11y rules arrived after the components did. In Track B, `tokens.css`, the three self-hosted fonts, the wordmark, `eslint-plugin-jsx-a11y` at `error`, and `@axe-core/react` in dev all land in **B1, before the first primitive is written.** Retrofitting either is a phase you never budget correctly.

**5. Every phase has a gate and a tripwire.** A gate is a binary condition that must hold before the next phase starts. A tripwire is an hour count — **at 1.5× the estimate, cut the phase's lowest-priority bullet, write it into `docs/known-limitations.md`, and move on.** A documented known limitation reads better than an unfinished feature, and a phase that runs 3× is how a project dies.

### Plan of record

| | Phase | Hours | Cum. | Wk @ 8h | Wk @ 12h | Gate |
|---|---|---:|---:|---:|---:|---|
| **A0** | Make it clonable | 2 | 2 | 1 | 1 | `git ls-files \| wc -l` < 320 |
| **A1** | Close the review-enders | 4 | 6 | 1 | 1 | Four named findings fixed, each with a manual repro note |
| **A2** | Cheap security wins | 3 | 9 | 2 | 1 | `crypto.randomInt` OTP, global rate limit, no stack in responses |
| **A3** | Make it build | 12 | 21 | 3 | 2 | `npm run build` exits 0 in both packages |
| **A4** | Make it runnable | 4 | 25 | 4 | 3 | Fresh clone → seeded DB → app running, from README steps only |
| **A5** | Real seed + demo mode | 6 | 31 | 4 | 3 | Three demo buttons log you in as three roles with populated data |
| **A6** | Deploy | 5 | 36 | 5 | 3 | Public URL, `/healthz` green, no cold start |
| **A7** | README + evidence | 4 | **40** | **5** | **4** | **🚩 GATE 1 — a stranger uses it from a link** |
| | | | | | | |
| **B0** | Ground Zero | 6 | 46 | 6 | 4 | `pnpm dev` runs api + web against compose Postgres |
| **B1** | Walking skeleton | 44 | 90 | 12 | 8 | **🚩 GATE 2 — deployed URL, login, real data, one role-shaped screen** |
| **B2** | Auth completeness | 26 | 116 | 15 | 10 | Full lifecycle tested; old cookie 401s after reset |
| **B3** | Policy matrix + domain API | 44 | 160 | 20 | 14 | Matrix generated; oversell test green; uploads private |
| **B4** | UI completion | 40 | 200 | 25 | 17 | Six named screens at 375 px in both themes |
| **B5** | **SHIP (public)** | 18 | **218** | **28** | **19** | **🚩 GATE 3 — link on the CV** |
| **B6** | Hardening | 24 | 242 | 31 | 21 | CI: typecheck, lint, unit, matrix, integration, E2E, axe — green |
| **B7** | The pitch | 14 | **256** | **32** | **22** | README a stranger can summarize in three minutes |
| | | | | | | |
| **B+1** | Realtime depth *(optional)* | 70 | 326 | 41 | 28 | Offline → 3 queued sends → reconnect → correct order, no dupes |
| **B+2** | Audit log + admin *(optional)* | 32 | 358 | 45 | 30 | A mutation cannot be written that skips the audit |

**On the numbers.** These are corrected estimates, not the first draft's. They assume you have not used pnpm workspaces, Prisma migrations, shadcn, presigned S3 uploads, Fly, or Neon before — which is true — and they include the learning. Revision 1's ~268 h was the same plan priced at practised-hand speed; the honest number for *that* plan was ~490 h. This plan is smaller, and its ship point is 218 cumulative hours instead of 318.

**On the cadence.** 8 h/week is the planning rate. Your measured rate on this repository is roughly 5 h/week averaged over the real span, in bursts of 8–12 hours separated by weeks of nothing. Bursts are fine — the phase boundaries are designed to be burst-sized. What kills the plan is the *gap*, and the only defence is §8 risk 8.

**If you cannot hold 8 h/week through Track A, stop at Gate 1.** That is not failure. That is the plan working.

### 3.1 Bookkeeping between sessions

*(Added 2026-08-16.)* This plan is the backlog. It is not a record of what happened, and it is not a record of what went wrong. Three files carry that, and all three are kept current from now on:

| File | Answers | Written when |
|---|---|---|
| `NEXT.md` | "What was I in the middle of?" | Before you stop, while the context is still loaded |
| `docs/PROGRESS.md` | "Where are we, and how did we get here?" | After anything lands, newest entry at the top, dated |
| `docs/LESSONS-LEARNED.md` | "Have we already solved this?" | The moment something costs more than twenty minutes to work out |

`PROGRESS.md` records what changed and the state it left the repository in — **not intentions**, which is what this plan is for. It also carries the verification status of each entry, because "written" and "observed passing" are different facts and conflating them is how a project starts lying to itself.

`LESSONS-LEARNED.md` only takes entries with a real chance of recurring: a dependency that does not exist, a type augmentation that cannot merge, a platform behaviour that will bite again on the next machine. Not typos.

Both live under `docs/`, which is otherwise gitignored, so both are named explicitly in `.gitignore`'s exception list alongside `docs/adr/` and `docs/permissions.md`. A progress log that disappears on a fresh clone is useless.

---

## 4. Track A — Salvage (≈40 h)

> **Goal:** The repository you already have builds, runs, deploys, and can be used by a stranger from a link — with an honest README that names what is wrong instead of hiding it.

Rules for this track, and they matter more than any individual task:

- **Do not refactor.** Not the three identity tables, not the duplicated controllers, not the styling. Every hour spent on architecture here is an hour stolen from Track B, where it will be done properly.
- **Do not rename anything.** The repo stays `Millat-vocational-training`. Branding is Track B's problem.
- **Do not add features.** The only new *behaviour* is demo mode, and that is infrastructure.
- **Fix or disclose.** Anything you do not fix goes in Known Limitations, by name. A reviewer who reads *"private resources are served from public Cloudinary URLs; see #12"* respects you. A reviewer who finds it themselves does not.

---

### A0 — Make it clonable (2 h)

- [ ] Move the working copy to `C:\Users\Legion\code\millat-vt`. **The space in `Millat vocational training` is a live hazard for every shell script and every Docker bind mount you are about to write.** Five minutes, zero risk, permanent.
- [ ] `git rm -r --cached node_modules uploads` and commit. This is the single most valuable commit in the repository's history.
- [ ] Rewrite `.gitignore` **by pattern, not by filename** — the current one is a 19-line blocklist naming personal scratch files individually:
  ```
  node_modules/
  dist/
  build/
  coverage/
  uploads/
  .env*
  !.env.example
  *.log
  .DS_Store
  *.tsbuildinfo
  ```
  (`frontend/tsconfig.app.tsbuildinfo` and `tsconfig.node.tsbuildinfo` are untracked in your working tree right now — catch them here.)
- [ ] Delete the planning corpus: all 9 root `.txt` files, `backend/src/issues.txt`, `backend/src/controllers/{FPP.docx, features.txt, Presentation_Features_Summary.txt, FPP_Enhancement_Recommendations.txt}`, `frontend/src/components/navigation/navigationDesignGuide.txt`, `frontend/create-pages.js`. **Read `issues.txt` and `api-discrepancies.txt` once first** — convert their live items into GitHub issues, then delete. Nothing `.txt` or `.docx` stays in `src/`.
- [ ] Add `LICENSE` (MIT).
- [ ] `git gc --aggressive`. The 17 MB unpacked `.git` will not shrink much (history is history) but the working tree will.

**DoD:** `git ls-files | wc -l` drops from 1,814 to under 320. Zero tracked files under `node_modules/`. A fresh clone is under 5 MB of working tree.

---

### A1 — Close the four review-enders (4 h)

Each of these ends a code review on its own. Fix all four, and write a one-line repro note in the commit body for each — those notes become README/issue content later.

- [ ] **Public admin signup.** `backend/src/routes/auth.adminRoutes.ts:24` — move `router.post("/signup", signupAdmin)` behind `adminProtect`, or delete the route entirely and keep `seed:admin` as the only way an admin is created. Deleting is safer and cheaper. **Do this before you deploy anything, in A6 order terms — this route on a public URL is a live compromise, not a portfolio flaw.**
- [ ] **Process-killing handlers.** `conversation.controller.ts:99, 160, 257` — wrap all three in the existing `asyncHandler`. Then grep the whole controllers directory for `async (req` without `asyncHandler` and wrap every hit; there are more than three.
- [ ] **The upload deletion bug.** `resource.controller.ts:291-295` — `extractPublicId` must reconstruct the full public ID including the `millat-vocational-training/` folder prefix that `cloudinary.ts:37` adds. Take everything after `/upload/` , drop the version segment (`v1234567890/`), drop the file extension. Then **check the return value** — `{result: 'not found'}` must throw, not pass silently.
- [ ] **Delete-before-upload.** `resource.controller.ts:85-89` — upload the replacement first, update the DB row, then delete the old asset. If the delete fails, log it; the record is already correct.
- [ ] **Restore the lost cooldown.** `auth.teacherController.ts:303-307` — copy the OTP-resend cooldown from `auth.studentController.ts:306-310`. Same file, same fix, in `auth.adminController.ts` if it is missing there too.

**On private files:** the real fix is Cloudinary `type: 'authenticated'` delivery with signed URLs, and it is roughly 2 hours. Do it if you have the appetite. If you do not, **relabel the feature**: remove the word "private" from the resource UI, ship it as "visible to enrolled students" (which is what the *listing* enforces), and put the truth in Known Limitations. Do not ship a checkbox that says private and is not.

**DoD:** the four named findings are fixed, each with a repro note. `git log` shows four small, well-described commits.

---

### A2 — Cheap security wins (3 h)

Everything here is under 30 minutes and closes an audit finding.

- [ ] `generateOTP.ts:3` — `crypto.randomInt(100000, 1000000)`. One line.
- [ ] `express-rate-limit` mounted globally (100 req/15 min per IP) and strictly on `/auth/*` (10 req/15 min per IP, and a per-account counter on OTP verify with a 5-attempt lockout). Set `app.set('trust proxy', 1)` so the limiter sees the real IP behind Fly.
- [ ] `errorMiddleware.ts:37-42` — delete the three `console.log('printing…')` calls. **Delete the stack from the response body in every environment**, not just production.
- [ ] Delete `frontend/src/router/ProtectedRoute.tsx:13-14` — the working client-side privilege-escalation comment.
- [ ] Wire `deleteAllRefreshTokens` (`tokenUtils.ts:63-78`) into the password-reset handler. It is already written and has zero callers.
- [ ] Sweep the controllers for raw Prisma row returns on user objects and add `select` projections that exclude `password`, `otp`, `otpExpiry`. Eleven endpoints leak these. If a full sweep is too long, add a single `sanitizeUser()` helper and apply it at the eleven known sites.
- [ ] `backend/src/index.ts:39` — CORS origin from `process.env.CORS_ORIGIN`, defaulting to `http://localhost:5173`.

**DoD:** no response body in any environment contains `stack`, `password`, `otp`, or `otpExpiry`. An OTP guess loop is locked out after 5 attempts.

---

### A3 — Make it build (12 h)

This is the largest single block in Track A and the one that will feel worst. It is 131 errors in 50 files, and roughly 100 of them collapse into four root causes.

- [ ] **`src/pages/admin/conversations/components/index.ts:7`** — the dangling `./CreateConversationModal` import. Delete the export line and the component's call sites. The admin conversations feature ships an "Under Development" alert anyway; do not build the modal.
- [ ] **`src/common/types/index.ts:3`** — resolve the duplicate `Student`/`Teacher` exports. Pick one barrel as authoritative, delete the other's re-export. Then check which one the app was *actually* getting and whether call sites depended on the wrong shape.
- [ ] **`src/services/index.ts:17-23`** — the 12 `PaginatedResponse`/`QueryParams` errors. Declare each **once** in `src/common/types/api.types.ts`, export it, delete the local copies in `adminService.ts:13` and `departmentService.ts:9`, and import from the one place.
- [ ] **The 25 × `TS2339`.** These are real drift: the hand-written frontend types disagree with what the API returns. For each, check the controller's actual `select`/`include` and correct the *type*, not the call site. Where the API returns `{ data, total, page }` and the type says `{ items }`, the type is wrong.
- [ ] Delete `frontend/src/common/constants/api.ts` (127 lines, zero usages, already drifted — `LIST: '/department'` vs the server's `/api/departments`). Its errors go away with it.
- [ ] Add `"build"`, `"start"`, `"lint"` to the **root** `package.json`. Root `build` = `tsc -p tsconfig.json && npm --prefix frontend run build`.
- [ ] Fix the express types mismatch: `@types/express` down to `^4.17.21` to match `express ^4.21.2`.
- [ ] Add a minimal `.github/workflows/ci.yml`: install, build both packages, lint frontend. **Badge in the README.** Green from the day A3 ends — this is the cheapest credibility signal in the whole track.

**Do not** fix the 270 eslint problems. Set `no-explicit-any` to `warn`, fix the 87 unused vars with `--fix` where it is safe, and leave the rest. The build passing is the goal; the lint being pristine is Track B's job.

**DoD:** `npm run build` exits 0 from the repo root. CI is green. Tripwire: 18 h — if you are past it, delete the admin conversations tree wholesale (it is 502 lines of a feature that ships an "under development" alert) and re-measure.

---

### A4 — Make it runnable (4 h)

- [ ] `"prisma": { "schema": "backend/prisma/schema.prisma" }` in root `package.json`, so `npx prisma` works from the root and `npm install` generates the client.
- [ ] **Create the first migration.** `npx prisma migrate dev --name init` against a clean database, and **commit `backend/prisma/migrations/`**. If the dev database has data you care about, baseline it with `prisma migrate diff --from-empty --to-schema-datamodel` then `migrate resolve --applied`.
- [ ] Fix nodemon: `nodemon --ext ts,json --exec ...`. Editing a backend file has never triggered a restart; it will now.
- [ ] `docker-compose.yml` with **one** service: `postgres:17-alpine`, healthcheck `pg_isready`, named volume. No Redis, no MinIO, no Mailpit — Track A does not need them.
- [ ] `.env.example` with every variable the app reads, commented. Grep for `process.env` to build the list; there is no central place today.
- [ ] `README.md` quickstart section: clone → `docker compose up -d` → `npm install` → `npx prisma migrate deploy` → `npm run seed` → `npm run dev`. **Then run it yourself from a fresh clone in a fresh directory and fix whatever breaks.** This step is not optional and it always finds something.

**DoD:** a stranger following the README's numbered steps on a clean machine reaches a running app. You verified this by doing exactly that.

---

### A5 — Real seed data + demo mode (6 h)

The app today literally cannot be demoed: registration requires an OTP through a real SMTP account, and `adminSeeder.ts` creates one admin row, so a reviewer who gets it running lands on empty tables.

- [ ] Replace `backend/src/db/seeders/adminSeeder.ts` (53 lines, one admin from env) with a real seed. Deterministic (`faker.seed(42)`), idempotent, and **guarded so importing it does not write to the database** — the current file self-executes at module scope (`:48-51`). Produce:
  - 6 departments with real trade names (Welding & Fabrication, Automotive Technology, Electrical Installation, HVAC & Refrigeration, CNC Machining, Industrial Plumbing)
  - 12 instructors, 80 students, 3 admins
  - 18 courses with realistic fill, **including one at 29/30**
  - 60 resources (mixed public/private, PDF/video/link), comments 2 levels deep
  - 12 news/events items with comments
  - 14 conversations, ~400 messages across several days with mixed read state
  - Deterministic avatars via DiceBear `notionists` URLs — **never a gray placeholder grid**
  - **Three demo accounts with fixed credentials**, printed to the console at the end
- [ ] **Demo mode.** Three "View as Student / Instructor / Administrator" buttons on the login screen. Each hits `POST /auth/demo/:role`, which is **404 unless `process.env.DEMO_MODE === 'true'`**, issues a normal session for a fixed seeded account, and bypasses OTP. Roughly 40 lines. Non-negotiable — nobody registers an account and waits for an email.
- [ ] Add `"seed"` to root scripts.

**DoD:** `npm run seed` populates every list in the app in under 30 seconds and is safe to run twice. Three clicks on the login screen reach three different populated dashboards.

---

### A6 — Deploy (5 h)

- [ ] **Neon** Postgres (free tier). **Fly.io** app, one `shared-cpu-1x` 512 MB machine.
- [ ] Two-stage `Dockerfile`: `deps → build → runtime`, non-root user, `NODE_ENV=production`. `.dockerignore` covering `node_modules`, `.git`, `uploads`, `frontend/dist` (built inside).
- [ ] **Serve the built frontend from the Express app** — `express.static('frontend/dist')` plus an SPA fallback. One origin, one deploy, no CORS in production, no cookie-domain problem. This is worth ten minutes of thought and saves a category of failure that Revision 1 budgeted a risk row for.
- [ ] `GET /healthz` (process alive) and `GET /readyz` (`SELECT 1`). Fly healthcheck on `/readyz`.
- [ ] `fly deploy` runs `prisma migrate deploy` as a release command.
- [ ] Set `DEMO_MODE=true` on this app. It is a demo; that is the point. Make sure the admin signup route is gone (A1) before this goes live.
- [ ] A free uptime monitor (UptimeRobot / BetterStack) on `/readyz` at 60-second interval. **A dead demo link on a CV is worse than no link.**

**DoD:** `https://millat-vt.fly.dev` loads in under 3 seconds cold, three demo buttons work, no console errors, and the uptime monitor is green.

---

### A7 — README + evidence capture (4 h)

- [ ] **Capture the "before" screenshots first.** Run the app and screenshot six surfaces into `docs/legacy/`: login, admin table, dashboard, course detail, chat, an error state. **Once this UI is replaced in Track B, it cannot be photographed again without standing the old version back up.** The before/after pair is the single most persuasive artefact available to you and it is destroyed by the passage of time. Fifteen minutes now, unrecoverable later.
- [ ] **README.md**, in this order: project name → one-sentence description → **live demo link with the three demo roles named** → 3 screenshots → tech stack → three-command quickstart → **Known Limitations** → license.
- [ ] The Known Limitations section is the part that makes this repo respectable rather than mediocre. Write it honestly and specifically:
  > **Known limitations.** This is a working prototype with a documented backlog, being rebuilt as [skillwright](link) — see #1.
  > - Three separate identity tables (`Admin`/`Teacher`/`Student`) cause ~40% duplication in the auth layer. This is the root cause of most items below.
  > - Uploaded files are served from public Cloudinary URLs; resource visibility is enforced at the listing layer, not at the object layer.
  > - No automated tests and no migration history before `init`.
  > - Admin↔user messaging is not implemented; the conversation model seats exactly one teacher and one student.
  > - Course capacity is checked non-transactionally and can be exceeded under concurrent approval.
- [ ] Repo hygiene: About-box description, topics (`react`, `typescript`, `prisma`, `postgres`, `express`, `socket-io`), pin it on your GitHub profile, tag `v1.0.0`.
- [ ] Replace `frontend/README.md` (still the Vite template) with a two-line pointer to the root README.

**🚩 GATE 1.** Send the link to one person who has never seen it and watch them use it without help. If they get somewhere useful in ten seconds, Track A is done. **Update your CV, LinkedIn, and profile README the same week** — this is a task, not an afterthought.

**Decision point.** If Track A took more than eight weeks of calendar time, you do not currently have the cadence for Track B. Stop here, deliberately. A shipped modest project beats an abandoned ambitious one by an enormous margin.

---

## 5. Track B — Narrow rebuild (≈178 h to public ship)

> **Goal:** `skillwright` — a permissions-first training platform with three claims a reviewer can verify in ninety seconds each.

### The stack, and what was cut from it

Revision 1 named roughly thirty first-time technologies and applied a 1.3× multiplier to four of them. This is the corrected list.

| Keep — these *are* the claims | Cut — cost without signal |
|---|---|
| **Prisma + committed migrations** — never done; core to the story | **Turborepo** → plain pnpm workspaces. Turbo's caching does nothing at three packages and its config is an evening. |
| **Postgres constraint-based concurrency** — the oversell claim | **ts-rest** → shared zod schemas in `packages/shared`. ~90% of the drift-safety, no young library on the critical path of five phases. |
| **A hand-written policy module** — your own code, the whole differentiator | **Better Auth** → hand-rolled sessions (~150 lines). Revision 1 budgeted 6 h of contingency *and* named a fallback — that is a document not trusting its own choice. You already wrote correct server-side opaque-token rotation; it is the one thing the audit praises unreservedly. |
| **Presigned S3 uploads (R2 / MinIO)** — the private-files claim | **Fastify** → stay on **Express 5**. Express 5 forwards async rejections to the error handler natively, which deletes the `asyncHandler` bug class outright. Same framework you know, one major version up. |
| **shadcn/ui + Radix on Tailwind v3** — v3 is already installed and works | **Tailwind v4** — `@theme inline` on a first design-system attempt is a needless variable. |
| **TanStack Query** — deletes the 310-line `useApi` | **TanStack Router** → **react-router 7** data router, already installed. `loader`-based guards fix the `ProtectedRoute` flash, which was the actual complaint. |
| **react-hook-form + zod** — the resolver is already a dependency | **BullMQ + Redis** — two queues, one of which is "send an email". A promise you do not await plus a nightly cron covers both. |
| **Playwright (chromium only)** | **Testcontainers** → a Postgres service container in GitHub Actions, and the compose Postgres on a `_test` database locally. Docker Desktop + WSL2 + Testcontainers on Windows is a reliably lost evening. |
| **axe + jsx-a11y** — zero-to-CI-enforced is a real differentiator | **cmdk command palette, the marketing landing page, Scalar, osv-scanner, Recharts (until B+2)** — decoration. |
| **pino + Sentry** | **A separate `packages/policy` npm package** → a folder in `packages/shared`. You are not publishing a 200-line file from a project that has not shipped a screen. |

That is roughly **90 hours removed** and seven fewer ways for the project to die in a config file.

**Workspace layout — three packages, not six:**

```
skillwright/
  apps/api/          Express 5, Prisma, all server code
  apps/web/          Vite, React 19, react-router 7
  packages/shared/   src/schema/   zod DTOs + request/response contracts
                     src/policy/   the policy module (pure functions)
                     src/brand.ts  the single place the name is spelled
  packages/db/       → NO. Prisma lives in apps/api/prisma. The web app
                       imports types from shared, never from Prisma.
```

---

### B0 — Ground Zero (6 h)

> **Goal:** A named, clean repository where `pnpm dev` brings up the API and the web app against a Postgres container.

**Target 6 h. Tripwire 9 h.** Revision 1 said this phase "is the phase most likely to be rushed. Don't." That is backwards for this author: twelve hours of workspace scaffolding before a single line of product code is exactly how an eleven-month gap starts. **Rush it. Add each tool the hour you need it, not before.**

**Tasks**

- [ ] **Name check before you spend money.** Verify in one sitting: npm scope `@skillwright`, GitHub org/repo `skillwright`, `skillwright.dev` and `.com`, and a USPTO/EUIPO word-mark search for "Skillwright" in software/education classes. **Have two ranked backups.** A conflict discovered at week 20 costs the rename twice. Then register `skillwright.dev` (~$12/yr) and buy `.com` if free.
- [ ] `git init` at `C:\Users\Legion\code\skillwright`. **Note the removed space** — same hazard as A0.
- [ ] Keep `millat-vt` deployed and live. Add a five-line pointer at the top of its README to `skillwright` plus the live demo link. Do **not** archive it until Track B ships — a working demo now beats a private archive.
- [ ] `.gitignore` by pattern (the A0 list, plus `.turbo/`, `playwright-report/`, `test-results/`).
- [ ] `pnpm-workspace.yaml`, root `package.json` (private, `engines.node: ">=22"`, `packageManager` pinned), `.nvmrc`, `.editorconfig`. **No turbo.json.**
- [ ] Three packages as above. Shared tsconfig base in the root, extended by each.
- [ ] `docker-compose.yml` with **one** service: `postgres:17-alpine`, healthcheck, named volume. MinIO arrives in B3. Mailpit arrives in B2.
- [ ] `apps/api/src/env.ts` — a zod schema over `process.env`, exported as a typed frozen object, validated at boot with a readable failure listing every missing key at once. **Every variable read exactly once, here.** `.env.example` generated from the schema keys, with comments, and committed.
- [ ] `packages/shared/src/brand.ts` — `{ name, tagline, domain, supportEmail, emailFrom, assetFolder, copyrightHolder }`. Everything else imports it. See Appendix C for what this does and does not cover.
- [ ] `scripts/check-brand.ts` — greps `apps/*/src` and `packages/*/src` for the brand string and fails on any hit outside `brand.ts`. Wired into CI **from commit two**, because it is unenforceable retroactively.
- [ ] Root scripts: `dev`, `build`, `test`, `lint`, `typecheck`, `db:migrate`, `db:seed`, `db:reset`, `db:studio`. `pnpm dev` = `docker compose up -d --wait && pnpm -r --parallel dev`.
- [ ] `.github/workflows/ci.yml` — install, typecheck, lint, build, brand check. Green on an empty test suite. **Badge in the README from commit two.**
- [ ] **Dependabot** (`.github/dependabot.yml`), weekly, grouped by ecosystem. Six months of a solo project accumulates a lot of CVE noise otherwise.
- [ ] **Commit convention**, written into `CONTRIBUTING.md` in three lines: conventional prefix, subject states the change, body states the *why* or is empty. **No generated prose.** The old repo's 132 commits of *"This commit introduces…"* was a finding; in a fresh repo history is a first-class artefact.
- [ ] `LICENSE` (MIT), `README.md` skeleton, `NEXT.md`, `CHANGELOG.md`, `docs/adr/0001-fresh-repo.md`.

**DoD**

`git clone && pnpm install && pnpm dev` starts Postgres, the API, and the web dev server. CI is green including the brand check. The domain is registered and DNS delegated. `.env.example` is committed and generated from the zod schema.

---

### B1 — Walking skeleton (44 h) ⭐

> **Goal:** A deployed URL where a stranger clicks "View as Student", sees a real course catalog, requests enrollment; clicks "View as Instructor", approves it. Ugly is fine. Real is required.

This is the phase Revision 1 did not have, and it is the most important phase in the plan. Everything is built narrow and end-to-end. Generalization comes later, against something you can screenshot.

**Entry conditions:** B0 done.

**Tasks — data (10 h)**

- [ ] `apps/api/prisma/schema.prisma` — **7 models only**: `User`, `TeacherProfile`, `StudentProfile`, `Session`, `Department`, `Course`, `Enrollment`. (Full core schema in Appendix A; the rest arrive in B2/B3. Migrations are working now, so adding a table later is a normal, cheap operation — which is why Revision 1's "declare `AuditEvent` now to settle the shape" advice is dropped.)
  - `User` with `email @db.Citext @unique`, `role Role`, `status UserStatus`, `deletedAt`, plus 1:1 profiles.
  - `Course.durationValue Int` + `durationUnit DurationUnit` — never a free-text `duration` string.
  - `Course.capacity Int` and `Course.approvedCount Int @default(0)`.
  - **Explicit `onDelete` on every single relation. No exceptions.** The old schema declared three, all on `RefreshToken`.
  - Indexes: `User[role, status]`, `Enrollment[courseId, status]`, `Enrollment[studentId, status]`, `Course[departmentId]`, `Course[teacherId]`, profile `[departmentId]`, `deletedAt` on every soft-deletable model.
- [ ] `pnpm db:migrate --name init`. **Commit `prisma/migrations/`.** Second migration adds `CHECK (approved_count <= capacity)` and `CHECK (approved_count >= 0)` in raw SQL.
- [ ] One `PrismaClient` singleton in `apps/api/src/db.ts`, query logging in dev. **One client, forever** — `socketHandler.ts:6` in the old repo constructed a second one.
- [ ] `apps/api/prisma/seed.ts` — the A5 seed content, minus resources/comments/conversations for now. Deterministic, idempotent, guarded against import-time execution. 6 departments, 12 instructors, 80 students, 3 admins, 18 courses **including one at 29/30**, DiceBear avatars, three fixed demo accounts printed at the end.

**Tasks — auth core (10 h)**

- [ ] **Hand-rolled sessions.** `Session { id, tokenHash, userId, expiresAt, createdAt, lastUsedAt, ip, userAgent }`. Cookie carries an opaque `crypto.randomBytes(32).toString('base64url')`; the DB stores its SHA-256. Sliding 7-day / absolute 30-day. Cookie is `__Host-sw_session; HttpOnly; Secure; SameSite=Lax; Path=/`. **Single origin — the API serves the built SPA, exactly as in A6** — so there is no cookie-domain problem, no CORS in production, and no split-host failure mode to design around.
- [ ] `requireAuth` middleware decorating `req.actor: Actor = { id, role, status }`. **One place.** `status !== 'ACTIVE'` rejects here, so suspension is instant — the old `adminProtect` never checked `isActive` at all.
- [ ] Login and logout only. **Registration, verification, and reset are B2.** The seed creates verified users; that is enough to build against.
- [ ] **Demo mode, designed here rather than bolted on at ship time.** `POST /auth/demo/:role` returns 404 unless `env.DEMO_MODE === true`, and refuses outright if `env.DEPLOY_ENV === 'production'`. The session it issues carries `provenance: 'DEMO'`. The policy matrix (B3) gets a demo-actor row. A test asserts the route 404s when the flag is unset.
- [ ] `apps/api/src/lib/errors.ts` — `AppError { code, status, isOperational }`; an error middleware mapping Prisma codes (`P2002`→409, `P2025`→404, `P2003`→409) and returning RFC 9457 `application/problem+json` with a `errors[]` array for field-level validation failures. **Stack traces never appear in a response body, in any environment.** No `NODE_ENV` gating — that gating is why the current app leaks stacks to anonymous callers on every 4xx.
- [ ] **pino + pino-http from the first line of server code**, with a ULID `requestId` propagated through `AsyncLocalStorage` so service code and background work log it too. Redaction on `authorization`, `cookie`, `password`, `token`, `email`. Revision 1 put this at week 23; that means twenty weeks of debugging production with `console.log`.

**Tasks — policy core (4 h)**

- [ ] `packages/shared/src/policy/` — a **folder**, imported by both apps.
  - `actor.ts` — the `Actor` type and the `Action` string-literal union.
  - `policy.ts` — rules as data. Eight actions to start:
    ```ts
    export const policy = definePolicy({
      'course:read':        { STUDENT: allow, TEACHER: allow, ADMIN: allow },
      'course:create':      { STUDENT: deny,  TEACHER: allow, ADMIN: allow },
      'course:update':      { STUDENT: deny,  TEACHER: ownsCourse, ADMIN: allow },
      'enrollment:request': { STUDENT: isSelf, TEACHER: deny, ADMIN: deny },
      'enrollment:read':    { STUDENT: isSelf, TEACHER: ownsCourse, ADMIN: allow },
      'enrollment:approve': { STUDENT: deny,  TEACHER: ownsCourse, ADMIN: allow },
      'user:read':          { STUDENT: isSelf, TEACHER: isSelf, ADMIN: allow },
      'user:update':        { STUDENT: isSelf, TEACHER: isSelf, ADMIN: allow },
    });
    ```
  - **Every rule is a pure function with no I/O.** Subjects are loaded by the caller and passed in. This is what lets the same `can()` run in the browser.
  - `can(actor, action, subject)` plus the combinators `allow`, `deny`, `or`, `and`, `isSelf`, `ownsCourse`, `enrolledApproved`.
- [ ] `authorize('course:update')` as an Express middleware: load subject → evaluate → throw `AppError('FORBIDDEN', 403)` naming the failed rule.
- [ ] Unit tests for the eight actions. **The full matrix and the generated docs are B3** — this phase ships the function, not the artifact.

**Tasks — contract + web (14 h)**

- [ ] `packages/shared/src/schema/` — zod DTOs for the 7 models plus request bodies and query params. Entity shapes are **checked against Prisma's generated types**: `satisfies` against `Prisma.CourseGetPayload<{ select: typeof courseDetailSelect }>` so a schema that omits or misnames a field fails to compile. One `PaginationQuery` with `limit` **capped at 100** (the old `Number(limit)` with no bound at `student.controller.ts:937` is a DB-exhaustion lever).
- [ ] Six endpoints: `GET /api/courses`, `GET /api/courses/:id`, `POST /api/enrollments`, `GET /api/enrollments`, `POST /api/enrollments/:id/approve`, `GET /api/me`. **Plural nouns. Role never appears in a URL** — `GET /courses/:id` returns a role-shaped projection derived from the actor.
- [ ] **Design foundations, before the first component** (§3 point 4):
  - `apps/web/src/styles/tokens.css` — the full three-tier block from Appendix B. Primitives → semantic → component. **Only the semantic tier is redefined for dark.**
  - Three self-hosted fonts via `@fontsource-variable`: **Bricolage Grotesque** (display ≥28 px), **Inter Variable** (UI/body, `cv05` + `ss01`), **IBM Plex Mono** (all data — counts, codes, timestamps, capacity `18/30`). **No Google Fonts link. No `font-family` on `*`, ever.**
  - Tailwind v3 `theme.extend` mapping semantic tokens to utility names; `darkMode: 'class'`; the blocking inline theme script in `index.html` `<head>` to prevent flash.
  - **Lint rules banning raw hex, `bg-blue-*`, `text-gray-*`, and inline `style={{color|background}}` in `src/**`.** The 213 hardcoded hexes came back once; do not let them come back twice.
  - `eslint-plugin-jsx-a11y` at **`error`** and `@axe-core/react` in dev, both from this phase. Zero-to-CI-enforced accessibility is a real differentiator and it is only cheap if it is never retrofitted.
  - **Wordmark (1 h):** set "Skillwright" in Bricolage Grotesque, lock the lockup, export SVG light/dark. It feeds the topbar, the favicon, the OG image, and the README. One hour, used everywhere.
  - **Motion** (`motion`, formerly framer-motion) installed, with a single `useReducedMotion` guard wrapper. The old repo has **zero** `prefers-reduced-motion` queries; every transition you write goes through the guard.
- [ ] Eight primitives only: `Button` (5 variants; `IconButton` requires `aria-label` **at the type level**), `Input`, `FormField` (auto-wires `id`/`aria-describedby`/`aria-invalid`), `Card`, `Badge`/`StatusChip`, `Skeleton`, `EmptyState` (**three variants** — `empty` / `no-results` / `error`; conflating them is why a failed request currently looks identical to an empty table), `AppLayout`.
- [ ] `AppLayout`: sticky (**not** `position: fixed; width: 100vw`) 56 px topbar, 264 px sidebar on `--surface-default` with a hairline right edge. **No gradient sidebar.** Below `lg` the sidebar collapses into a Radix `Sheet` and the topbar gains a menu trigger. Role comes from `useSession()`, **never from the URL path**. Identical chrome for all three roles; role is expressed by a workspace chip, different nav content, and a different landing route.
- [ ] react-router 7 data router. Guards in `loader` → `throw redirect()`. **Declarative, not effect-based** — the old `ProtectedRoute` renders `null` for a frame and flashes the authenticated shell to unauthorized users. Per-route `lazy()` pointing at **concrete module paths**; verify with `vite build` that real per-route chunks appear (the old repo's 27 `lazy()` calls all resolved the same barrel and produced one chunk).
- [ ] TanStack Query. Query keys per domain, invalidation on mutation. `usePolicy()` wrapping the same `can()`, so buttons that would 403 do not render.
- [ ] Four screens: **login** (with three demo buttons), **role dashboard** (branched content, one component), **course catalog** (filter rail, capacity bars), **course detail** (with request/approve action).

**Tasks — deploy (6 h)**

- [ ] Fly app + Neon branch, two-stage Dockerfile (`deps → build → runtime`, non-root), `fly.toml`, `.dockerignore`, `/healthz` + `/readyz`. Release command runs `prisma migrate deploy`. `deploy.yml` on push to `main`.
- [ ] `DEMO_MODE=true`, uptime monitor pointed at `/readyz`, `skillwright.dev` DNS to Fly.
- [ ] Graceful shutdown: SIGTERM → stop accepting → drain → `prisma.$disconnect()` → hard `process.exit(1)` after 15 s. Plus `unhandledRejection` / `uncaughtException` handlers.

**DoD**

`https://skillwright.dev` is live. Three demo buttons reach three populated dashboards. A student can request enrollment and an instructor can approve it, in the browser, in production. `pnpm build`, `pnpm lint`, `pnpm typecheck` all exit 0. CI green. Per-route chunks in the build output. The four screens render correctly at 375 px and in dark mode. Structured logs with request IDs are flowing.

**Time:** ≈44 h. **Tripwire 66 h** — at which point cut the course catalog's filter rail and the dashboard's stat cards, log them, and ship the gate.

**🚩 GATE 2.** If this is not live, Track B is the wrong project for your current cadence. Keep `millat-vt` as the portfolio piece and stop. This is a real decision point, not a formality.

| Disposition | Files |
|---|---|
| **REWRITTEN** | `backend/prisma/schema.prisma` → `apps/api/prisma/schema.prisma`. Read the old file for cardinalities; type the new one by hand. |
| **REWRITTEN** | `backend/src/db/seeders/adminSeeder.ts` (53 lines) → `prisma/seed.ts` (~350 lines of real demo data). |
| **DELETED** | `Admin`, `Teacher`, `Student` as separate models. `RefreshToken` (replaced by `Session`). All `otp`/`otpExpiry`/`isVerified`/`isActive`/`isBanned` columns on identity tables. `auth.studentController.ts` (444), `auth.teacherController.ts` (438), `auth.adminController.ts` (158), `auth.refreshController.ts` (128), all four `auth.*Routes.ts`, `authMiddleware.ts` (138), `protectCourseAccess.ts` (62), `checkCourseAccess.ts` (33), `tokenUtils.ts`. **~1,700 lines replaced by ~400.** |
| **DELETED** | `frontend/src/services/api.ts`'s refresh interceptor — the best 50 lines in the frontend, deleted because server sessions mean there is no refresh dance to coordinate. *The best code in a repo existing to solve a problem you should not have is itself the argument for the rebuild.* |
| **DELETED** | `frontend/src/index.css` (all 166 lines, especially `:13`). `common/constants/theme.ts` (0 imports). `common/constants/storage.ts` (0 imports, 23 raw `localStorage` calls beside it). `hooks/useApi.ts` (310 lines). `context/ThemeContext.tsx` (dead — `useTheme` has zero consumers). `components/navigation/DashboardNavigation.tsx` (436 lines of self-described mock UI with hardcoded "John Doe" and fabricated stats). The injected `<style>` block at `AuthLayout.tsx:90-119` and the Unsplash hotlink at `:126`. |
| **KEPT** | `Enrollment @@unique([studentId, courseId])` + `EnrollmentStatus` enum, verbatim. The `Department → Course → Enrollment` cardinalities. The five image assets (re-exported as AVIF+WebP with `srcset`, explicit `width`/`height`, `loading="lazy"`). `common/constants/menus.tsx` structure. `context/DepartmentContext.tsx`'s debounced-shared-list pattern, as a Query hook. |
| **REWRITTEN** | `backend/src/utils/customErrors.ts` (38) + `asyncHandler.ts` (10) + `errorMiddleware.ts` (47) → `apps/api/src/lib/errors.ts` + the error middleware. The **design** was correct and is preserved; the five `console.log('printing…')` calls are not ported, and `asyncHandler` disappears because Express 5 handles it. |

---

### B2 — Auth completeness (26 h)

> **Goal:** The full account lifecycle, with every finding from area 2 of the audit closed at the point the code is written — not in a hardening phase eight weeks after the public ship.

**Entry conditions:** B1 live.

**Tasks**

- [ ] `Verification { id, userId, purpose, codeHash, expiresAt, attempts, createdAt }`. **Purpose discriminator** (`EMAIL_VERIFY` | `PASSWORD_RESET`) — the old schema used one `otp`/`otpExpiry` column pair for both, so a verification code was a password-reset code. Codes are `crypto.randomInt(100000, 1000000)`, **stored hashed**, 10-minute expiry, **5-attempt lockout**, 60-second resend cooldown enforced **in the send path, not the route** (so it cannot be lost in a copy-paste, which is exactly how `auth.teacherController.ts` lost it), plus a daily per-account cap.
- [ ] **Enumeration-safe responses.** `POST /auth/register`, `/auth/forgot-password`, and `/auth/resend-verification` return an **identical 200 body for known and unknown emails**, and do the same amount of work (hash a dummy password on the miss path). A test asserts body parity and timing parity within tolerance. Nothing gives this to you by default.
- [ ] **Session revocation, here and not in hardening.** Password reset deletes **all** sessions for the user. `status → SUSPENDED` deletes all sessions for the user. Integration tests assert the old cookie 401s on the very next request. These are two of the audit's high-severity findings and Revision 1 scheduled them eight weeks after the app went public.
- [ ] **CSRF.** Even same-origin, `SameSite=Lax` is not a complete defence. Every state-changing route rejects a request whose `Origin` (or `Sec-Fetch-Site`) is absent or not in `env.ALLOWED_ORIGINS`. ~15 lines of middleware. Integration test posts a mutation with a foreign `Origin` and asserts 403. `docs/adr/0004-csrf.md` records why a token-based scheme was not needed at one origin.
- [ ] **Password policy**, stated in `docs/authorization.md`: ≥12 characters, zxcvbn score ≥3, and a `haveibeenpwned` k-anonymity range check that **fails open** on network error. ~30 lines, and a good interview answer.
- [ ] `helmet`, `compression`, body-size limits. Rate limits (from A2's design, done properly): strict per-IP **and per-account** on auth routes, moderate globally, `trust proxy` set.
- [ ] Email: `axllent/mailpit` added to compose (SMTP 1025, UI 8025) for local; **Resend** in production. Six templates as one `layout(bodyHtml)` function plus six ~30-line bodies in plain TS template literals — the prose ports from `sendEmail.ts` (553 lines), the markup does not. **Sends are never awaited inside a transaction.**
- [ ] **SPF, DKIM and DMARC records for `skillwright.dev`.** This is not deliverability *optimisation* (which is cut, §7) — Resend cannot send from the domain at all without them, and B2's entire flow depends on email arriving. ~30 minutes at the DNS panel.
- [ ] Auth screens: register stepper, verify-email with 6 OTP boxes (auto-advance, paste-to-fill), forgot, reset. All built with **react-hook-form + zod resolver**, and — the part nobody remembers — **`Problem.errors[]` from the API mapped back onto form fields**, so a server-side validation failure lands under the right input instead of in a toast.
- [ ] **`ErrorPage` with three variants (404 / 403 / 500)**, each with copy, an illustration, and a primary action back to the role landing route. Routed and reachable. Top-level and per-route `ErrorBoundary` wired to the 500 variant. The old repo's error pages were 13-line unstyled boxes with no navigation escape, and its `ServerError` page was routed but unreachable from any actual throw.
- [ ] **Toast system + destructive-action confirm dialog.** Every mutation gives feedback; every destructive action confirms. Neither appears anywhere in Revision 1 and both are needed by every subsequent screen.

**DoD**

Register → verify → login → forgot → reset → login-with-new-password works end to end against Mailpit locally and Resend in production. Integration tests cover all six steps plus: the old cookie 401s after reset; a suspended user's next request 401s; a foreign `Origin` mutation 403s; unknown and known emails produce byte-identical `/forgot-password` responses; a 6th OTP attempt is locked out. `/404`, `/403` and a thrown error all render a real page with a way out.

**Time:** ≈26 h. **Tripwire 39 h** — cut the HIBP check and the register stepper's multi-step UI (make it one form) before cutting anything else.

---

### B3 — Policy matrix + domain API (44 h) ⭐

> **Goal:** Authorization is exhaustively proven, and the two remaining core claims are demonstrable in CI.

**Entry conditions:** B2 green.

This phase carries the project's headline. Give it the time.

**Tasks — the matrix**

- [ ] Expand `Action` to the full union. At minimum:
  ```
  course:{read,create,update,delete}
  enrollment:{request,read,approve,reject,withdraw}
  resource:{read,create,update,delete,download}
  announcement:{read,create,update,delete,publish}
  comment:{read,create,update,delete}
  user:{read,update,suspend,list}
  department:{read,create,update,delete}
  upload:{presign,commit}
  ```
  With `resource:create` scoped to `ownsCourse` — the audit found that any teacher could plant resources in any other teacher's course, and Revision 1's policy sample never mentioned it. Likewise `announcement:update: { ADMIN: allow, TEACHER: isAuthor }`.
- [ ] **`apps/api/test/policy-matrix.test.ts`** — table-driven over every `(role × action × subject-state)` cell. Negative cases are mandatory: student → non-enrolled private resource; teacher → another teacher's course; teacher A → create resource in teacher B's course; suspended user → anything; soft-deleted subject; demo actor → every action.
  - **Do not pre-commit to a cell count.** Revision 1 asserted "214" — as a phase gate and as a README badge — before the `Action` union existed. The exhaustiveness check derives the number; the badge is generated from the test run; you state the number once it is real.
  - **An exhaustiveness check over the `Action` union fails the build if a new action has no matrix row.** This is the property that makes the claim interesting.
- [ ] `scripts/generate-permissions-doc.ts` — regenerates `docs/permissions.md` as a markdown table **from the policy itself**. CI fails if the checked-in copy differs from the generated one. Documentation that cannot go stale.
- [ ] Integration test harness: GitHub Actions `services: postgres`, migrations run once, truncate between tests. Locally, the compose Postgres on a `skillwright_test` database. **No Testcontainers on Windows.**

**Tasks — the domain**

- [ ] Modules under `apps/api/src/modules/`, each `{routes,service,mappers}.ts`. Route handlers are **≤15 lines**: resolve actor → assert policy → call one service method → return a typed envelope. Services own transactions and invariants. **No repository layer** — Prisma is the repository, and a real test database removes the mocking motive.
  - `users` (profile read/update, admin listing, suspension as `POST /users/:id/suspension` and `DELETE` — not a `PUT` toggle)
  - `departments`, `courses`, `enrollments`, `resources`, `announcements`, `comments`, `uploads`
- [ ] Remaining schema (Appendix A): `Resource`, `Upload`, `Announcement`, `Comment`. Non-negotiables:
  - **One `Comment` table** with a single `authorId` and nullable `resourceId`/`announcementId`, plus a raw-SQL `CHECK (num_nonnulls(resource_id, announcement_id) = 1)`.
  - **`Upload` as a first-class entity storing the real storage `key`** — never re-derived from a URL. This is the direct fix for the audit's worst finding.
  - `Announcement.authorId → User` (**required**) and `publishedAt DateTime?`. The old `NewsEvent` had no author relation at all.
  - `Course.syllabusUploadId → Upload?` — never a free-text `String? // URL or file path`.
  - `ResourceType` is `DOCUMENT | VIDEO | LINK`, **set explicitly by the creator, never inferred from MIME** (the old `determineResourceType` made the enum meaningless). `ASSIGNMENT` and `QUIZ` **do not exist in the enum** — they are the cut feature (§7) and must not appear in the schema, because a reserved enum value is an invitation.
  - Full index set (Appendix A), `deletedAt` on every soft-deletable model, explicit `onDelete` everywhere.
  - Generated `tsvector` columns + GIN indexes on `Course` and `Resource` for search.
- [ ] **Claim #2 — enrollment that cannot oversell.** One transaction:
  ```sql
  UPDATE "Course" SET approved_count = approved_count + 1 WHERE id = $1;
  -- CHECK (approved_count <= capacity) raises 23514 on the 31st
  ```
  The row lock taken by the `UPDATE` serializes concurrent approvals; the `CHECK` constraint is the actual guarantee. `@@unique([studentId, courseId])` with explicit `P2002` handling → friendly 409, not a raw Prisma error. **ADR-0006 explains why an atomic increment plus a `CHECK` beats both `SERIALIZABLE` + retry and a `pg_advisory_xact_lock`** — that comparison is the interesting part, and it is a better answer than the advisory lock Revision 1 proposed.
  - **The artifact:** a CI test firing **200 concurrent approval requests at a 30-seat course** and asserting exactly 30 `APPROVED` rows and 170 clean 409s. ~8 h of the phase. **Best effort-to-signal ratio in the entire plan.**
- [ ] **Claim #3 — uploads that are actually private.** `POST /uploads/presign` → policy check, MIME allowlist, per-kind size cap, an `Upload` row with `status=PENDING` and a **server-generated key** `${brand.assetFolder}/${entity}/${ulid}` — never the client's filename, and the folder comes from `brand.ts`, never a literal. Presigned `PUT` valid 5 minutes; the browser PUTs directly to R2 (MinIO locally, added to compose in this phase). Bytes never touch the API. `POST /resources` references `uploadId`; the service `HeadObject`s to verify the real content type and size, then flips to `COMMITTED` **inside the same transaction**. Downloads are always short-lived presigned GETs issued **after** the policy check passes. **The bucket is private.** A nightly cron sweeps `PENDING` uploads older than 24 h.
  - **The artifact:** an integration test that takes a private resource's storage key, requests it unsigned, and asserts 403 from the object store.
- [ ] **A response-body secret scanner as a CI check, not a convention.** A test helper wraps every integration-test response and fails on any key matching `/password|hash|token|otp|secret|sessionId/i`. Contracts make leaks unlikely; this makes them impossible to merge. Eleven endpoints leaked hashes and OTPs in the old app.
- [ ] Integration test per module via supertest. **A CI check asserting every registered route has at least one integration test.**
- [ ] **A `contract-drift` CI job.** On a scratch branch: rename a field in the Prisma schema, run `pnpm -r typecheck`, assert non-zero exit. Because `apps/web` imports its types from `packages/shared`, which `satisfies` the Prisma payload types, a rename in the database breaks the *frontend* build. This is the **artifact** for the supporting claim — you are demonstrating a property, not asserting one. (It works now because B1 already shipped a web consumer; it would have been green-for-the-wrong-reason if run before one existed.)

**DoD**

Every cell of the policy matrix is asserted; `docs/permissions.md` is generated and CI-enforced; adding an action without a matrix row fails the build. The 200-concurrent enrollment test is green and its output is quoted in the README. An unsigned request for a private object returns 403. ≥75% line coverage on `apps/api`. Every route has an integration test. No response body contains a secret-shaped key. The contract-drift job demonstrably fails on a Prisma rename.

**Time:** ≈44 h. **Tripwire 66 h** — cut `announcements` and `comments` to a later increment before cutting the matrix, the oversell test, or the upload work. Those three are the claims.

| Disposition | Files |
|---|---|
| **REWRITTEN** | All 12 controllers (5,716 lines) → 8 modules. Read as spec; type by hand. |
| **KEPT (logic, ported by hand)** | The enrollment state machine and capacity rule from `student.controller.ts:586-680` + `teacher.controller.ts:269-327` (the latter was already transactional — proof the pattern was known). The `isPublic OR (enrolled AND APPROVED)` visibility rule from `student.controller.ts:71-105`. The filtered `_count` aggregate pattern from `course.controller.ts:109-118`. The `select`-projection discipline from `student.controller.ts:143-165` — the one place it was applied correctly. `course.validation.ts:46-51`'s cross-field `endDate > startDate` rule and the E.164 phone regex, re-expressed in zod. |
| **DELETED** | Both duplicate `updateEnrollmentStatus` implementations (`course.controller.ts:451-526` and `teacher.controller.ts:258-334`, 15 diff lines of 76). Both `getAllPublicResources` implementations. Both ResourceComment CRUD implementations (`resource.controller.ts:423-577` and `student.controller.ts:743-876`). `utils/cloudinary.ts`, `middleware/uploadMiddleware.ts`, `extractPublicId` — every behaviour in that path was subtly broken. All 10 files in `backend/src/routesValidation/` including the never-imported `resource.validation.ts`, and `middleware/validateResource.ts`. `withTransactionOptions`, `uploadImage`, `broadcastMessage`, `notifyNewConversation`, and `export const test = "test"` — all zero-caller exports. |
| **CUT ENTIRELY** | News/Events as a standalone module (~360 lines of backend with zero UI consumers). It exists here as `announcements` with a real UI, or not at all. |

---

### B4 — UI completion (40 h)

> **Goal:** Six screens a stranger would call finished, on every viewport, in both themes.

**Entry conditions:** B3 endpoints live.

The owner's stated top priority is the UI, and Revision 1 gave the entire visual layer 32 hours while the audit scoped it at three to five weeks. The foundations already landed in B1; this phase is the screens, and it is deliberately the second-largest in the plan.

**Tasks**

- [ ] **Complete the primitive set.** B1 shipped 8; add: `Select`, `Combobox`, `Dialog`, `Sheet`, `Tabs`, `Toast` (B2), `Avatar`, `Tooltip`, `Pagination`, `DataTable` (TanStack Table v8), `FilterBar` (config-driven), `AsyncBoundary`, `FileDropzone`. Mark each **shadcn-default (no work)** or **token-customised (an hour)** in `docs/design.md` — most are the former, and pretending otherwise is how a design phase doubles.
- [ ] **`/design` route** — every component, every variant, every state, both themes, side by side. Half a day. It is your visual regression surface and the most directly persuasive artefact for *"did you actually design this?"* **It fails CI on any serious/critical axe violation.**
- [ ] **The six primary screens**, named so the DoD is gradeable:
  1. **Login** (+ three demo buttons)
  2. **Role dashboard** — one component, role-branched content
  3. **Course catalog** — filter rail, capacity bars, search
  4. **Course detail** — roster, resources, enrollment action, capacity state
  5. **Resource detail + threaded comments** — **one** component replacing the old `StudentResourceComments.tsx` (588) and `TeacherResourceComments.tsx` (595), which differed by 41 lines
  6. **Admin CRUD** — one `CrudPage` + `DataTable` + `FilterBar` driving departments / courses / instructors / students / announcements
- [ ] **One role-parameterized tree.** Not `pages/student/**` and `pages/teacher/**`. The old repo's parallel trees were 86 files and 10,831 lines; this is ~50 files.
- [ ] **Upload UI**: dropzone, per-file progress from the presigned `PUT`'s `onUploadProgress`, cancel, retry, and clear failure copy. B3 specified the server side completely and the client side not at all.
- [ ] **Responsive by construction.** Sidebar → `Sheet` below `lg`. Tables → stacked cards below `md`. **Every screen verified at 375 px and 320 px.** No `100vw` anywhere; use `100dvw` or grid. The audit called the current dashboard "unusable on mobile with no responsive nav pattern," and Revision 1 specified a 264 px sidebar and nothing else.
- [ ] **Loading states are skeletons that mirror the final layout** — not a centered spinner replacing a grid. **Empty, no-results and error are three distinct states**, each with copy and a call to action.
- [ ] Theme toggle in the user menu — Light / Dark / System, actually wired. Dark is a genuine second theme: borders, surfaces, and status colours all correct, verified on all six screens and not just `/design`.
- [ ] Motion only where it earns its place: route transitions, list item entry, dialog. All through the `prefers-reduced-motion` guard from B1.

**DoD**

All six named screens are usable against real seeded data, **at 375 px and in dark mode** — verified per screen, not only on `/design`. `/design` renders every component in both themes and is axe-clean. The no-raw-hex lint rule is green. `pnpm build` exits 0 with real per-route chunks. Initial JS for the login route is under 150 kB gzipped. Lighthouse ≥90 on the login and catalog routes.

**Time:** ≈40 h. **Timebox visual exploration to 4 h.** Accept shadcn defaults for 80% of components; spend your taste on exactly three things: the token file, the three `EmptyState` variants, and the dashboard's first screenful.

| Disposition | Files |
|---|---|
| **DELETED** | `login/styles.css` (223 lines — three character-identical rule pairs, a duplicated media block). Both `conversations.scss` forks. Both `MessageBubble.scss` forks (85 vs 149 lines, diverged geometry). `ExploreCourses.module.css` (dead — its one referenced class is kebab-case while the code reads camelCase, so `styles.courseCard` is `undefined`). `components/common/Table/` (the one shared primitive nobody used; its column map is a pure type cast). All 24 `!important` declarations, all 166 inline style objects, all 213 hex literals. `frontend/src/pages/teacher/**` and `pages/student/**` as *parallel trees*. |
| **REWRITTEN** | `context/AuthContext.tsx` (256) → a session hook over TanStack Query. **One** `forceLogout` listener (currently two, one closing over a permanently-stale `userType`), memoized value, no `localStorage` parsing. `utils/errorHandler.ts` (252 lines, over-engineered but well-reasoned) → ~80 lines with no `any`. |
| **KEPT** | `Home.tsx` **copy** — the words, not the JSX. **Its contact block is placeholder data** (`+92 123 456 7890`, `123 Education Street`, `info@millatvocational.edu`); either make it real or label it explicitly as demo data. Never ship a fake phone number. |

---

### B5 — SHIP (18 h) 🚩

> **Goal:** A stranger uses this in ten seconds without an account, and the link goes on your CV that week.

**Entry conditions:** B4 screens working.

- [ ] **Demo isolation, which is a live footgun if you get it wrong.** The demo runs on a **separate Neon branch and a separate Fly app** (`demo.skillwright.dev`). `demo-reset.yml` truncates and reseeds hourly — and **the workflow refuses to run unless `DATABASE_URL` contains the demo branch ID**, asserted in the workflow, not in a comment. Revision 1 scheduled an hourly truncate-and-reseed without ever saying the demo database was separate from production.
- [ ] `scripts/screenshots.ts` — a Playwright script logging in as each role, navigating, and capturing at 1440×900 `deviceScaleFactor: 2`, no chrome, no scrollbars. Screenshots regenerate on demand and never go stale. Capture: student dashboard (light), admin dashboard (light + dark pair), course catalog, teacher approval queue, resource comments.
- [ ] Favicon and app identity from the B1 wordmark: an Ember-filled mark at 32/180/512 + `site.webmanifest`. Per-route `<title>`. `<html lang="en">`. OG image at 1200×630 using the wordmark.
- [ ] **README v1** — wordmark → one-sentence positioning → live demo link **above the fold** → badges (CI, permission matrix, coverage, license) → hero screenshot → three-sentence "what it is" → the three claims, each **falsifiable and linked to the test that proves it** → three-command quickstart with demo credentials → architecture Mermaid diagram → ADR index.
- [ ] **The before/after pair**, using `docs/legacy/` from A7. This is the single most persuasive thing in the README and it costs nothing because you already captured it.
- [ ] **Backup rehearsal.** Confirm Neon PITR is on and **restore once to a scratch branch**. An untested backup is a belief, not a backup.
- [ ] Repo hygiene: About-box description, topics, `v1.0.0` tag, `SECURITY.md`.
- [ ] Zero `console.log` in shipped code. Reviewers open devtools.
- [ ] **Update every external link the day this ships**: CV, LinkedIn, GitHub profile README, and the `millat-vt` pointer README. Archive `millat-vt` private *after* the new demo is confirmed live.

**DoD**

You can send the URL to someone with no context and they are inside the product, as a specific role, with real data, in under ten seconds. `git clone && docker compose up && pnpm dev` reproduces it locally in under two minutes **from a clean clone on a second machine** — verified, not assumed. The demo reset has run successfully twice. Demo login returns 404 when `DEMO_MODE` is unset (asserted by test).

**🚩 GATE 3.** This is the real finish line. **If you are burned out here, stop.** A live, deployed, tested, documented, CI-green project with a generated permission matrix and a proven concurrency invariant already beats the overwhelming majority of portfolio repositories. B6 and B7 make it memorable rather than merely credible, and they should be entered by choice, not obligation.

---

### B6 — Hardening (24 h)

> **Goal:** The things a reviewer checks that you cannot fake.

- [ ] **Playwright E2E, chromium only** (three browser projects is theatre for a portfolio), against the compose stack. Five golden paths:
  1. register → verify → login
  2. student browses → requests enrollment → teacher approves → course appears
  3. teacher uploads a resource → enrolled student downloads it → **non-enrolled student gets 403** → **the raw object URL, unsigned, also 403s**
  4. **teacher A attempts to create a resource in teacher B's course → 403**
  5. admin suspends a user → that user's next request fails mid-session

  Traces and video on failure uploaded as CI artifacts.
- [ ] **Accessibility to CI-enforced.** `@axe-core/playwright` across 6 routes × 2 themes, failing on any serious/critical violation. Manual keyboard-only walkthrough of the five paths, documented in `docs/a11y.md`. Targets: semantic landmarks, `<main>` around the outlet, accessible names on every icon-only control (enforced at the type level from B1), skip link, visible `focus-visible` rings, 24×24 minimum targets with 44×44 as the design default, usable at 320 px and 400% zoom, `prefers-reduced-motion` honoured. (The lint rule and dev-time axe have been running since B1, so this phase finds tens of violations, not hundreds.)
- [ ] **Visual regression:** Playwright `toHaveScreenshot()` on `/design` and the six primary screens, both themes, baselines committed. This is what makes `/design` a regression surface rather than a gallery.
- [ ] **Observability completion.** Sentry on API and web, release-tagged by git SHA, sourcemaps uploaded in CI, `tracesSampleRate: 0.1`, PII scrubbing on. (pino and request IDs have been in since B1.)
- [ ] **Security verification.** Per-IP and per-account rate limits verified by test. `pnpm audit --prod` in CI. Confirm no secret-shaped keys in any response (the B3 check, extended to E2E).
- [ ] Coverage thresholds: 100% on `packages/shared/src/policy`, ≥75% on `apps/api`, ~40% on `apps/web` (deliberately low — testing shadcn wrappers is theatre).
- [ ] **Performance, measured not guessed.** `EXPLAIN ANALYZE` these five, against a **10× seed** (800 students, 180 courses, 600 resources): course catalog search, course detail with roster, student enrollment list, resource list for a course, admin user list with filters. Confirm index usage, record p95 before/after in `docs/performance.md`, and **write in ADR-0007 that you added indexes and measured rather than adding a cache.** That is a stronger answer than a Redis layer nobody asked for.
- [ ] `docs/known-limitations.md` — every tripwire cut you made, by name, with a one-line reason.

**DoD**

CI runs typecheck, lint, brand check, unit, policy matrix, integration, E2E, axe, visual regression, and dependency audit — all green, in under 12 minutes.

---

### B7 — The pitch (14 h)

> **Goal:** Make a reviewer read the code.

- [ ] **README v2**: wordmark → one-sentence positioning → anchor pills → badges (CI, permission matrix, coverage, a11y, license) → **hero screenshot** → three-sentence "what it is" → **the three claims, each with a linked test** → the before/after pair → design-system section → light/dark pair → remaining screenshots → architecture Mermaid → three-command quickstart with demo credentials → ADR index. The last line is *"There is no step three."*
- [ ] `docs/` as a real directory: `permissions.md` (generated), `authorization.md`, `contracts.md`, `concurrency.md`, `uploads.md`, `a11y.md`, `performance.md`, `erd.md` (Mermaid, generated from the schema), `design.md`, `known-limitations.md`, `brand-surfaces.md`, `ops.md`, `adr/0001..0008`.
- [ ] **8 ADRs, each ≤300 words:** 0001 fresh repo · 0002 unified `User` · 0003 policy as data · 0004 same-origin sessions + CSRF · 0005 hand-rolled sessions over a vendor library · 0006 atomic increment + `CHECK` over `SERIALIZABLE` and advisory locks · 0007 indexes over a cache · 0008 shadcn over Ant Design.
- [ ] Regenerate all screenshots with `pnpm screenshots` so they match the shipped UI exactly.
- [ ] `/design` deployed on the live demo and linked from the README.
- [ ] Final sweep: zero `console.log`, zero `TODO`, zero commented-out JSX, no orphan files. `git ls-files | wc -l` ≈ 350, not 1,814.

**DoD**

Someone who has never seen the project reads the README in three minutes and can state what is interesting about it without opening the code.

---

## 6. Increments after the ship

These are **not phases**. Each is a self-contained project on a live repository, entered by choice, shipped independently, with its own README section and its own claim. If you never do them, nothing is unfinished.

### B+1 — Realtime depth (≈70 h)

> **Goal:** A chat that survives a tunnel — the one thing in this project a reviewer has not seen a hundred times.

This was Revision 1's phase 7 at 44 h with a note saying *"this will overrun."* It will; 70 is the honest number. As an increment on a shipped repo it is a strict improvement: it either lands and upgrades the pitch to four claims, or it does not and the shipped project is unaffected.

**Build in strict priority order. The first three are the story; the rest is garnish.**

1. **Schema + sequencing.** `Conversation`, `ConversationParticipant { userId, lastReadAt, leftAt }`, `Message { senderId, seq BigInt, clientMsgId }` with `@@unique([conversationId, seq])` and `@@unique([senderId, clientMsgId])`. Indexes `Message[conversationId, seq]`, `ConversationParticipant[userId, leftAt]`. **Admins are ordinary participants** — the old `Conversation { teacherId, studentId }` physically could not seat one, which is why `AdminConversations.tsx` shipped a "Feature Under Development" alert next to 462 lines of working components. `seq` is allocated inside the send transaction; ordering stops depending on cuid comparison against a `createdAt` sort, which is what makes the old cursor at `conversation.controller.ts:124-132` provably skip or duplicate messages at page boundaries.
2. **Reconnect with gap backfill.** Client persists `lastSeq` per conversation. On reconnect: `conversation:backfill { id, sinceSeq }` → the server replays exactly the gap, in order. `connectionStateRecovery` handles sub-2-minute drops.
3. **Idempotent optimistic send.** Client generates a ULID `clientMsgId`, renders the bubble at 60% opacity immediately, sends. The unique constraint on `(senderId, clientMsgId)` means a retry after timeout can never double-post. Failure rolls back with a retry affordance.
4. Offline outbox in IndexedDB, flushed in order on reconnect.
5. Presence via room membership; typing with a 3-second server-side TTL.

**Everything else:**
- socket.io 4, authenticating **from the same session cookie** (`withCredentials: true`) — no bearer token exists to steal. This deletes the whole WS-token subsystem: `generateWebSocketToken`, `/auth/refresh/websocket-token`, the `purpose` claim, and the frontend's `url.includes('/auth/')` interceptor hack that currently force-logs-out users mid-chat. Re-check `status === 'ACTIVE'` against the DB on every connect.
- Rooms `user:{id}` and `conversation:{id}`. **The server never trusts a client-supplied room name, on any event** — `can()` gates join **and** typing **and** read. Today `typing_start` / `typing_stop` / `message_read` accept a client-supplied conversation ID and re-broadcast with no membership check whatsoever.
- Read state as **one `lastReadAt` write per participant**, not an `updateMany` across every message in the thread.
- Per-socket rate limiting: 20 messages / 10 s, 5 typing events / s. In-memory is fine at one machine; **Redis and the socket.io Redis adapter are needed only if you run more than one Fly machine, and you will not.**
- Chat UI: one role-parameterized module. Three panes at `xl`, two at `lg`, **single-pane stack below 1024** — never two panes on a phone. Own messages `--brand-subtle` with an asymmetric corner; others `--surface-default` + hairline. **No tails** — the corner asymmetry does the job and removes the 149-vs-85-line geometry divergence between the two forked SCSS files. Grouping within 5 minutes. Read receipts tinted `--text-brand`, not blue.
- Accessibility: the message list is `role="log" aria-live="polite" aria-relevant="additions"`; each message `role="article"` with `aria-label="{sender}, {time}"`. Typing announced politely. This is currently zero — a realtime chat where a screen reader never announces an incoming message.
- `useWebSocket.ts` rewritten with callbacks held in a ref and connect/disconnect in one effect keyed on session. The current version registers handlers over a permanently-stale mount-time closure, which is why unread counts and read receipts silently do not work **in both forked copies**.

**DoD:** integration tests drive a real socket through a forced disconnect and assert a gap-free, duplicate-free backfill; a retry does not duplicate; a cross-conversation emit is rejected; the rate limit trips. **The artifact:** a ≤1.5 MB, 15-second GIF at the top of the README — devtools Offline, three messages queued with pending indicators, network restored, all three reconcile in correct order with no duplicates.

### B+2 — Audit log + admin surfaces (≈32 h)

> **Goal:** Policy says who *may*. Audit says who *did*. Neither can be bypassed.

- `apps/api/src/lib/audit.ts` — a **Prisma client extension** intercepting every mutation on a registered model set, writing an append-only `AuditEvent { actorId, action, entityType, entityId, before, after, ip, createdAt }`. Because it lives in the data-access layer, **you cannot write a controller that bypasses it.** Actor resolved from the `AsyncLocalStorage` context that has existed since B1.
- `before`/`after` JSON diffs with a **redaction allowlist** — never password hashes, tokens, or email bodies.
- **`AuditEvent` has no update or delete path**, enforced at the database level: the migration revokes `UPDATE` and `DELETE` on the table from the application role. Append-only as a property, not a convention. `audit:read` is `ADMIN`-only in the matrix.
- Admin timeline UI: filterable by actor / entity type / action / date range, each entry deep-linking to the affected record, cursor-paginated.
- `Notification` wired: enrollment status change, new resource in an enrolled course, announcement published. **Delivery depends on B+1** — if realtime has not shipped, notifications degrade to poll-on-focus and the README says so. **Re-add the bell** that commit `9475530` removed; `BellOutlined` is currently imported at `AppLayout.tsx:18` and never rendered.
- Admin dashboard with **real** charts (Recharts): enrollment trend over 30 days, students per department, capacity utilization sorted by fill %. Backed by **one** `/admin/stats` endpoint — not four paginated list calls made only to read `.total`, which is what the current dashboard does.
- Soft-delete UX: `deletedAt` set, hidden by default, an "Archived" filter, and restore. This replaces the four hand-written child-count guards (`department.controller.ts:262-270`, `admin.controller.ts:326-330` and `:514-518`, `course.controller.ts:344-348`) that currently make it impossible to retire a department that was ever used.

**DoD:** suspending a user produces an audit entry with the before/after status; a test asserts a write issued through a raw client bypassing the extension **fails CI**; a test writes a password change and asserts no hash appears in `before`/`after`.

| Disposition | Files |
|---|---|
| **DELETED** | All four child-count delete guards. `CreateStudentModal.tsx` (145 lines whose submit handler only fires `notification.info('Student creation feature is not implemented yet')`). The commented-out Actions columns in `TeacherTable.tsx:118-131`, `StudentTable.tsx:107-120`, `DepartmentTable.tsx:100-125` — committed on purpose by `035b9db`, which is why the admin panel is read-only in the UI despite a working CRUD backend. |

---

## 7. The cut list

Every item here is something the codebase has, half-has, or would naturally grow. **Cut all of it.**

### Do not port

| Cut | Why |
|---|---|
| News/Events as a standalone module (~360 lines backend, 0 UI consumers) | Admins publish announcements nobody can read. It becomes `Announcement` with an actual UI or it does not exist. |
| `DashboardNavigation.tsx` (436 lines) | Self-described mock UI, hardcoded "John Doe", fabricated stats, rendered nowhere, deprecated AntD v4 APIs. |
| Three-table identity | Root cause of ~40% of backend duplication and of the diverged OTP cooldown. |
| `useApi`/`useMutation`/`usePaginatedApi` (310 lines) | TanStack Query does it better and removes the variable-length-dependency-array React violation. |
| Hand-written frontend model types (312 lines) | Replaced by `packages/shared`. |
| `create-pages.js` | The scaffolder that stamped 25 identical placeholder pages — the origin of the copy-paste architecture. |
| Both course-access middlewares | Two subtly different checks for the same resource, chosen by habit. `protectCourseAccess` was mounted with no authentication in front of it, so its entire branch is unreachable dead code. |
| The 13-file `.txt`/`.docx` planning corpus | Mine for README content, then delete. Nothing goes in `src/`. |

### Do not build, at any tier

**Roles & identity.** No fourth role — a parent/coordinator/super-admin adds ~70 matrix cells for zero new insight. No SSO / OAuth / SAML / magic links — that is *identity* work in a project whose story is *authorization*. No org hierarchy, no white-labelling.

**Features that look like progress.** No payments. **No assignment/submission/grading engine** — it is a genuinely good project and it is a *different* project; delete the login screen's "Submit assignments and check grades" promise rather than implementing it, and keep `ASSIGNMENT`/`QUIZ` out of the `ResourceType` enum so the invitation never exists. **Pick realtime OR assessment, not both.** No certificates. No video streaming, transcoding, live classes, or whiteboards. No analytics until B+2's audit events justify them — charting `COUNT(*)` is the canonical tell of a CRUD-only project.

**No AI features.** No course recommender, no chatbot tutor, no AI quiz generator. In 2026 this reads as a red flag: it is nearly always one provider call behind a button, and it signals reaching for a trend instead of an engineering problem. Your differentiators are correctness properties. Keep it that way.

**Architecture you do not need.** No microservices — splitting one app is a *negative* signal. No Kafka/RabbitMQ/event sourcing. No Kubernetes, Terraform, or service mesh — one well-explained multi-stage Dockerfile and a real CI pipeline say more than a Helm chart nobody reads. No custom component library from scratch. No GraphQL. No React Native / PWA install flow. **No repository layer** — Prisma is the repository; `CourseRepository.findById(id) { return prisma.course.findUnique(...) }` adds a file per model and removes Prisma's relational query power.

**Polish that is actually a time sink.** **No public marketing landing page** — §1 says no amount of UI polish makes this domain interesting, and an asymmetric hero with scroll-triggered animation is the purest form of that mistake. The demo link goes straight to the login screen with three role buttons; that *is* the front door. **No ⌘K command palette** — it is a party trick on a six-screen app. No email deliverability *optimisation* (no warm-up, no reputation work) — **but SPF, DKIM and DMARC are mandatory setup, not optimisation**; Resend cannot send from the domain without them and the whole auth flow depends on it. No in-app PDF/Office viewer — signed URL, new tab. No i18n until someone opens an issue. No rich text editor — markdown with preview.

### Technology cuts (see §5 for the full table)

Turborepo · ts-rest · Better Auth · Fastify · Tailwind v4 · TanStack Router · BullMQ · Redis · Testcontainers · Scalar · cmdk · osv-scanner · a standalone `packages/policy` npm package. Roughly 90 hours and seven single points of failure.

### Two process cuts

**Do not rewrite the old repo's history.** `git filter-repo` invalidates all 132 hashes anyway, so you gain nothing over a fresh start, and you keep every *"Comment out actions section for future use"* commit forever.

**Do not fix the old repo's architecture during Track A.** Track A's rule is fix-or-disclose, and disclosure is free. The three identity tables stay. The duplicated controllers stay. Every hour you spend refactoring in Track A is an hour stolen from Track B, where the same work is done once and properly. *(Note that this is the opposite of Revision 1's advice, which forbade Track A entirely on the grounds that fixing the build "changes no reviewer's conclusion." It does: it changes it from "cannot evaluate" to "evaluated.")*

### The scope test

> **"Does this make one of the three signature claims more provable, or does it just add another screen?"**

If it adds a screen, cut it. Breadth is what makes this genre invisible.

---

## 8. Risks and where this stalls

| # | Risk | Why it happens here specifically | Mitigation |
|---|---|---|---|
| 1 | **You stop again** | 20 active days in 214, then eleven months of nothing. This is the base rate, not a hypothetical. Nothing in Revision 1 addressed it. | Track A ships something in five weeks. Every gate leaves a working artifact. **The structure assumes you will stop; the only question is what you own when you do.** |
| 2 | **The rewrite plateau** | Weeks of invisible work while the old app *works* and the new one does not. This kills more rebuilds than any technical problem. | B1 is a full vertical slice ending in a public URL at cumulative hour 90. A green `/healthz` is not motivation; a screenshot is. |
| 3 | **Scope creep into the assignment engine** | The old schema reserves `ResourceType.ASSIGNMENT` and `.QUIZ`; the login screen promises grades; `student.controller.ts:1096` has the TODO. Everything pulls toward it. | It is in the cut list in writing, and the enum values do not exist in the new schema. If you genuinely want it, that is **Skillwright v2** after B7 — not an insertion. |
| 4 | **Design rabbit hole** | B4 has an infinite surface and token tweaking is pleasant and produces nothing. | Timebox exploration to 4 h. shadcn defaults for 80%. Spend taste on the token file, the three `EmptyState` variants, and the dashboard's first screenful. `/design` is your stopping criterion. |
| 5 | **Hand-rolled auth takes longer than expected** | It is the one place a vendor library would genuinely save time, and it is also where a subtle mistake is expensive. | Sessions are ~150 lines and you have already written the harder version (opaque token rotation) correctly. **Scope discipline is the mitigation:** B1 ships login/logout only; registration, verification and reset are a separate phase with their own tripwire. If B2 hits 39 h, cut the HIBP check and the stepper UI. |
| 6 | **Phase tripwires get ignored** | Every one of them fires at the moment you are most invested. | Write the hour count in `CHANGELOG.md` at the end of each session. When a tripwire fires, the cut goes in `docs/known-limitations.md` **that day**, before you write another line. A documented limitation reads better than an unfinished feature. |
| 7 | **Deployment surprises** | Cookie domains, CORS, migration-on-boot. | Largely designed out: **one origin**, API serves the SPA, `__Host-` cookie, no production CORS, no split-host problem, no sticky sessions needed (one machine). Deploy lands in A6 and again in B1, while the app is small. |
| 8 | **Multi-week gaps** | Observed: 7 weeks, 5 weeks, 7 weeks, 47 weeks. Returning after a gap costs an hour of re-orientation before you write a line. | `NEXT.md` at the repo root containing exactly **one sentence**: the next concrete task, updated at the end of every session. `CHANGELOG.md`, one line per session. **A 30-minute minimum session** — even 30 minutes keeps the context warm. And accept the real shape: this author works in 8–12 hour bursts, so size the next task to fit one burst, not one evening. |
| 9 | **"Just fix the old repo" relapse** | Around B3, when the new repo has fewer working features than the old one. | This revision defuses it: **you already fixed the old repo, in Track A, and it is deployed.** The relapse has nowhere to go. |
| 10 | **Boredom with the domain** | Five months on a training portal is a long time. | Honest checkpoints at Gates 1, 2 and 3. **You have explicit permission to stop at any of them.** If you stop, do it deliberately — README, `v1.0.0`, move on — rather than letting it rot half-done. |
| 11 | **Estimate optimism** | Revision 1's numbers assumed a practised hand. These do not, but they are still estimates. | Every phase has a **1.5× tripwire** with a named first cut. If three consecutive phases trip, the plan is wrong for your circumstances and you should ship what exists at the next gate. |
| 12 | **A free tier ends and the demo dies** | Neon, Fly, R2, Resend and Cloudflare all have free or near-free tiers today. Some will change over five months. | Appendix E states the running cost. The uptime monitor (A6) alerts within a minute if the demo goes down. **A dead demo link on a CV is worse than no link.** |

---

## 9. What "done" looks like

Every item is binary. Grade against the bar for the track you actually finished.

### Bar 1 — Track A done (≈40 h)

- [ ] `git ls-files | wc -l` is under 320. **Zero** tracked files under `node_modules/`
- [ ] `npm run build` exits 0 from the repo root; CI badge is green
- [ ] Committed Prisma migrations exist, and `prisma migrate deploy` runs on deploy
- [ ] A live URL, no cold start, with three demo buttons reaching three populated dashboards
- [ ] A README with a demo link above the fold, three screenshots, a three-command quickstart, and a **specific, honest Known Limitations section**
- [ ] The four review-ending findings are fixed; no response body contains a stack, a password hash, or an OTP
- [ ] `LICENSE`, `.env.example`, About-box description, topics, `v1.0.0` tag
- [ ] Zero `.txt`/`.docx` files in the repo; the mock-auth comment is gone
- [ ] Six legacy screenshots captured in `docs/legacy/` before anything replaces them
- [ ] The link is on your CV, LinkedIn, and profile README

### Bar 2 — Track B shipped (cumulative ≈218 h)

**First ninety seconds**
- [ ] README opens with a wordmark, a one-sentence positioning claim, and a **live demo link** above the fold
- [ ] Four badges, all green and all real: CI · permission matrix · coverage · license
- [ ] A hero screenshot in the first screenful showing real seeded data — real trade names, real people, non-zero counts, no "Test User"
- [ ] The before/after pair against `docs/legacy/`

**Ten seconds of the demo**
- [ ] A stranger clicks the link and is inside the product, as a chosen role, with populated data, without registering
- [ ] The demo does not cold-start; an uptime monitor watches it
- [ ] Every list is populated: 18 courses, 80 students, threaded comments, real resources
- [ ] The theme toggle works, and dark mode is a genuine second theme

**Two minutes of running it**
- [ ] `git clone && pnpm install && pnpm dev` reaches a seeded, logged-in app in **under two minutes**, verified on a second machine
- [ ] `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm typecheck` all exit 0
- [ ] `pnpm db:reset && pnpm db:seed` is idempotent and takes under 30 seconds

**Ten minutes of reading the code**
- [ ] Exactly **one** `User` table. Zero duplicated auth controllers. Zero role words in any URL
- [ ] `packages/shared/src/policy` is the **only** place authorization is decided — HTTP and React both call `can()`
- [ ] `docs/permissions.md` is generated from the policy; CI fails if the checked-in copy differs; a new action with no matrix row fails the build
- [ ] `packages/shared/src/schema` is the only place request/response shapes exist. Zero hand-written model types in `apps/web`
- [ ] No `any` in module services or in `packages/shared`; every remaining `any` in the repo carries a one-line comment explaining it *(Prisma JSON columns and third-party generics make "zero anywhere" a promise that breaks in two weeks)*
- [ ] Route handlers ≤15 lines. Business rules in services. No repository layer
- [ ] Explicit `onDelete` on **every** relation. `deletedAt` on every soft-deletable model. Every index in Appendix A present
- [ ] Zero `console.log`, zero commented-out code, zero `TODO` in shipped source
- [ ] `docker compose up` brings the whole dependency set

**The three claims, each verifiable in ninety seconds**
- [ ] **Policy matrix** — the full cell product runs in CI; the count is generated, not asserted; `docs/permissions.md` is generated from the policy
- [ ] **Enrollment cannot oversell** — 200 concurrent approvals against a 30-seat course produce exactly 30 `APPROVED` rows and 170 clean 409s, asserted in CI, output quoted in the README
- [ ] **Private files are private** — the bucket is private, keys are server-generated, downloads are policy-gated presigned GETs, and a test asserts an unsigned request for a private object returns 403
- [ ] *(Supporting)* **Contract drift** — a CI job renames a Prisma field and shows the *frontend* build failing

**Craft**
- [ ] Zero axe violations across 6 routes × 2 themes, enforced in CI. `docs/a11y.md` documents the manual keyboard pass
- [ ] Every icon-only control has an accessible name, enforced **at the type level**
- [ ] All six named screens work at 375 px and at 320 px; the sidebar becomes a sheet; tables become cards
- [ ] Loading states are skeletons that mirror the final layout — not a centered spinner replacing a grid
- [ ] Empty, no-results and error are **three distinct states**, each with copy and a call to action
- [ ] 404, 403 and 500 are real pages with a way out; error boundaries reach them
- [ ] Real per-route chunks in the build output. Lighthouse ≥90. Login route under 150 kB gzipped JS
- [ ] One font stack, one token layer, one styling system. Zero `!important`. Zero inline style objects. Zero raw hex in `src/`
- [ ] Five Playwright golden paths green, with traces uploaded on failure
- [ ] Structured logs with a request ID that survives into service code. `/healthz` + `/readyz`. Graceful shutdown. Backup restore rehearsed once

**The interview test**
- [ ] You can explain in under two minutes each: why one `User` table instead of three; why a declarative policy instead of middleware; why an atomic increment plus a `CHECK` constraint instead of `SERIALIZABLE` or an advisory lock; why the object store is private and downloads are presigned; why you wrote your own session layer; and why you deleted the best-written file in the old frontend
- [ ] Eight ADRs in `docs/adr/`, each under 300 words, each naming the tradeoff you accepted
- [ ] You can point at a single test file and say *"this proves it"* — for all three claims

### Bar 3 — Increments (optional)

- [ ] **Realtime survives a tunnel** — the offline GIF is in the README, and an integration test drives a real socket through a forced disconnect and asserts a gap-free, duplicate-free backfill
- [ ] **Audit you cannot skip** — a Prisma extension writes every privileged mutation, `AuditEvent` has no `UPDATE`/`DELETE` grant, and a test proves a bypassing write fails

---

## 10. Closing

The honest summary is short.

The repository you have is not worth saving as *architecture*, but it is absolutely worth saving as an *artifact* — forty hours turns it from something you would rather a reviewer not open into something that works, deploys, and tells the truth about itself. Do that first, this month, before you decide anything else. It is the only part of this document with 90% odds.

The decisions buried in the old code are the expensive part and they port over almost entirely. The domain will never be interesting, so stop trying to make it interesting and make the *engineering inside it* provable instead — three properties, each with a test you can point at, is worth more than thirty screens.

And plan against your actual history, not your intentions. Twenty active days in seven months, then eleven months of silence, is the fact that should shape every deadline in this plan. That is why Track A exists, why the vertical slice comes before the layers, why every phase has a tripwire, and why there are three gates where stopping is an explicitly sanctioned outcome rather than a failure.

**The single highest-leverage thing you can do this week is `git rm -r --cached node_modules`, fix the four findings in A1, and get `npm run build` to exit 0.** That is nine hours. It makes every remaining hour count, and it is worth doing even if you never open this document again.

---

## Appendix A — Core schema

The 12 models Track B ships. Realtime (`Conversation`, `ConversationParticipant`, `Message`) is B+1; `AuditEvent` and `Notification` are B+2. Migrations work, so late tables are cheap.

| # | Model | Phase | Key fields / notes |
|---|---|---|---|
| 1 | `User` | B1 | `email @db.Citext @unique`, `passwordHash`, `name`, `role Role`, `status UserStatus`, `avatarUrl`, `deletedAt`. Indexes: `[role, status]`, `[deletedAt]` |
| 2 | `TeacherProfile` | B1 | 1:1 `User`, `departmentId`, `designation`, `bio`, `phone`. Index `[departmentId]` |
| 3 | `StudentProfile` | B1 | 1:1 `User`, `departmentId`, `enrollmentNo @unique`, `batch`, `phone`. Index `[departmentId]` |
| 4 | `Session` | B1 | `tokenHash @unique`, `userId`, `expiresAt`, `lastUsedAt`, `ip`, `userAgent`, `provenance`. Index `[userId]`, `[expiresAt]` |
| 5 | `Department` | B1 | `name @unique`, `code @unique`, `description`, `deletedAt` |
| 6 | `Course` | B1 | `departmentId`, `teacherId`, `title`, `code @unique`, `description`, `durationValue Int`, `durationUnit DurationUnit`, `capacity Int`, `approvedCount Int @default(0)`, `startDate`, `endDate`, `syllabusUploadId`, `searchVector`, `deletedAt`. **`CHECK (approved_count <= capacity)`**, `CHECK (approved_count >= 0)`, `CHECK (end_date > start_date)`. Indexes `[departmentId]`, `[teacherId]`, `[deletedAt]`, GIN on `searchVector` |
| 7 | `Enrollment` | B1 | `studentId`, `courseId`, `status EnrollmentStatus`, `requestedAt`, `decidedAt`, `decidedById`. **`@@unique([studentId, courseId])`**. Indexes `[courseId, status]`, `[studentId, status]` |
| 8 | `Verification` | B2 | `userId`, `purpose VerificationPurpose`, `codeHash`, `expiresAt`, `attempts Int`, `createdAt`. Index `[userId, purpose]` |
| 9 | `Upload` | B3 | `key @unique` (**server-generated**, `${assetFolder}/${entity}/${ulid}`), `bucket`, `contentType`, `sizeBytes`, `status UploadStatus`, `uploaderId`, `createdAt`, `committedAt`. Index `[status, createdAt]` |
| 10 | `Resource` | B3 | `courseId`, `uploaderId`, `title`, `description`, `type ResourceType` (**DOCUMENT \| VIDEO \| LINK**, set explicitly), `uploadId?`, `externalUrl?`, `isPublic Boolean`, `searchVector`, `deletedAt`. `CHECK (num_nonnulls(upload_id, external_url) = 1)`. Indexes `[courseId, createdAt]`, `[deletedAt]`, GIN |
| 11 | `Announcement` | B3 | **`authorId → User` (required)**, `title`, `body`, `publishedAt DateTime?`, `deletedAt`. Indexes `[publishedAt]`, `[authorId]` |
| 12 | `Comment` | B3 | `authorId`, `resourceId?`, `announcementId?`, `parentId?`, `body`, `deletedAt`. **`CHECK (num_nonnulls(resource_id, announcement_id) = 1)`**. Indexes `[resourceId, createdAt]`, `[announcementId, createdAt]`, `[parentId]` |

**Enums:** `Role { STUDENT TEACHER ADMIN }` · `UserStatus { PENDING ACTIVE SUSPENDED }` · `EnrollmentStatus { PENDING APPROVED REJECTED WITHDRAWN }` · `DurationUnit { WEEK MONTH YEAR }` · `ResourceType { DOCUMENT VIDEO LINK }` · `UploadStatus { PENDING COMMITTED }` · `VerificationPurpose { EMAIL_VERIFY PASSWORD_RESET }`

**Universal rules:** explicit `onDelete` on **every** relation, no exceptions. `deletedAt DateTime?` plus an index on every soft-deletable model. `createdAt`/`updatedAt` everywhere. No column named `otp`, `isVerified`, `isActive`, or `isBanned` — status is one enum, verification is one table.

---

## Appendix B — Design tokens

Three tiers in `apps/web/src/styles/tokens.css`. **Only the semantic tier is redefined for dark.** Values below are the starting set; replace with the design brief's if they differ, but keep the names — every component references the semantic tier and nothing else.

**Tier 1 — primitives** (never referenced by a component)

| Ramp | Role | 50 / 100 / 200 / 300 / 400 / 500 / 600 / 700 / 800 / 900 / 950 |
|---|---|---|
| `--iron-*` | Neutral, slightly cool | `#f7f8f8` `#eceef0` `#d9dde1` `#b9c0c7` `#8e98a3` `#6b7683` `#525c68` `#414a54` `#374049` `#252b31` `#15191d` |
| `--ember-*` | Brand — welding spark | `#fff5ed` `#ffe8d5` `#ffcfaa` `#ffad74` `#fd813c` `#fb6115` `#ec460b` `#c4320b` `#9c2911` `#7d2512` `#440f07` |
| `--blueprint-*` | Secondary / info | `#eff8ff` `#dbeefe` `#bfe2fe` `#93d0fd` `#60b6fa` `#3b9bf6` `#257ceb` `#1d64d8` `#1e52af` `#1e478a` `#173054` |
| `--verdant-*` | Success | `#f0fdf4` `#dcfce7` `#bbf7d0` `#86efac` `#4ade80` `#22c55e` `#16a34a` `#15803d` `#166534` `#14532d` `#052e16` |
| `--rust-*` | Danger | `#fef3f2` `#fee5e2` `#fecdca` `#fda29b` `#f97066` `#f04438` `#d92d20` `#b42318` `#912018` `#7a271a` `#55160c` |
| `--amber-*` | Warning | standard amber ramp |

**Tier 2 — semantic** (the only tier components use; redefined under `.dark`)

```
--surface-canvas   --surface-default   --surface-raised   --surface-sunken   --surface-overlay
--text-primary     --text-secondary    --text-tertiary    --text-inverse     --text-brand
--border-subtle    --border-default    --border-strong    --border-focus
--brand-solid      --brand-solid-hover --brand-subtle     --brand-text       --brand-ring
--status-success-{bg,fg,border}   --status-warning-{bg,fg,border}
--status-danger-{bg,fg,border}    --status-info-{bg,fg,border}
--viz-1 … --viz-6      (categorical, for B+2 charts; must survive both themes)
```

Light: `--surface-canvas: var(--iron-50)`, `--surface-default: #fff`, `--text-primary: var(--iron-950)`, `--brand-solid: var(--ember-600)`.
Dark: `--surface-canvas: var(--iron-950)`, `--surface-default: var(--iron-900)`, `--text-primary: var(--iron-50)`, `--brand-solid: var(--ember-500)`.

**Tier 3 — component** — `--btn-height-{sm,md,lg}`, `--radius-{sm,md,lg,full}`, `--shadow-{sm,md,lg}`, `--sidebar-width: 264px`, `--topbar-height: 56px`, `--focus-ring: 2px solid var(--border-focus)` with a 2px offset.

**Type** — Bricolage Grotesque ≥28 px display · Inter Variable (`cv05`, `ss01`) for UI and body · IBM Plex Mono for **all data**: counts, codes, timestamps, capacity (`18/30`). Self-hosted via `@fontsource-variable`. **No Google Fonts link. No `font-family` on `*`.**

---

## Appendix C — Brand surfaces

Phase B0's DoD is *"the name appears in exactly one **application source** file."* That is `packages/shared/src/brand.ts`, enforced by `scripts/check-brand.ts` in CI. It is **not** the only place the name exists, and pretending otherwise makes the check unfixable the first time it fires. `docs/brand-surfaces.md` enumerates the rest, and a rename means walking this list:

**Repo:** GitHub slug, About description, topics, `LICENSE` copyright holder, root `package.json` name, `pnpm-workspace.yaml`, the three package names, `docker-compose.yml` service names, `.github/workflows/*` job names.
**Infrastructure:** Fly app names (`skillwright`, `skillwright-demo`), Neon project, R2 bucket + key prefix (derived from `brand.assetFolder`), Resend domain, DNS zone + records, uptime monitor.
**Content:** seed data (the demo institute's name, `@skillwright.dev` demo emails), OG image text, wordmark SVG, favicon, every `docs/*.md`, the README.

---

## Appendix D — The six primary screens and five golden paths

**Screens** (B4's DoD grades against these by name): login · role dashboard · course catalog · course detail · resource detail + threaded comments · admin CRUD table.

**Golden paths** (B6, chromium, against the compose stack):
1. register → verify → login
2. student browses → requests enrollment → teacher approves → course appears
3. teacher uploads a resource → enrolled student downloads it → non-enrolled student gets 403 → the raw unsigned object URL also 403s
4. teacher A attempts to create a resource in teacher B's course → 403
5. admin suspends a user → that user's next request fails mid-session

---

## Appendix E — Running cost

State it so you notice when a free tier ends.

| Service | Plan | Cost |
|---|---|---|
| `skillwright.dev` | registrar | **$12 / yr** |
| Fly.io — API (`shared-cpu-1x`, 512 MB) | pay-as-you-go | **≈$4 / mo** |
| Fly.io — demo app (same size) | pay-as-you-go | **≈$4 / mo** |
| Neon Postgres (prod branch + demo branch) | free tier (0.5 GB) | **$0** |
| Cloudflare R2 (uploads, private bucket) | free tier (10 GB, no egress fees) | **$0** |
| Resend (transactional email) | free tier (3,000/mo, 100/day) | **$0** |
| Cloudflare DNS | free | **$0** |
| Uptime monitor (UptimeRobot / BetterStack) | free tier | **$0** |
| Sentry | free developer tier | **$0** |
| | | **≈$8 / month + $12 / year** |

Track A costs **$0/month** — one Fly machine on the free allowance plus a Neon free branch, on a `*.fly.dev` hostname. There is no financial reason not to do it.