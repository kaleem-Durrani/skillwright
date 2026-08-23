# Lessons learned

Problems that cost real time and have a real chance of recurring. Each entry is written so that the _symptom_ is searchable — the thing you will actually see next time — followed by the cause, the fix, and the rule.

Not a bug list. A one-off typo does not go here; a platform behaviour, a toolchain constraint, or a class of mistake does.

---

## 1. One nonexistent dependency blocks the entire workspace install

**Symptom.** `pnpm install` fails at the very end with a 404 on `@fontsource-variable/ibm-plex-mono`. No workspace has its `node_modules`. Nothing else installed either, including the packages that were fine.

**Root cause.** IBM Plex Mono has no variable cut on Fontsource, so `@fontsource-variable/ibm-plex-mono` does not exist — only `@fontsource/ibm-plex-mono` does. The `-variable` naming pattern is real for other families, which is what makes the guess look right. pnpm resolves the whole workspace graph as one unit, so a single unresolvable specifier aborts the install for every package.

**Fix.** Use `@fontsource/ibm-plex-mono`, or a family that actually publishes a variable cut.

**Rule.** Before adding a font, icon or plugin package by inferring its name from a sibling's, confirm the exact package exists (`pnpm view <name> versions`). In a pnpm workspace the blast radius of a wrong name is the whole repo, not one app.

---

## 2. `declare module 'vitest'` cannot add matchers that live in `@vitest/expect`

**Symptom.** `expect(el).toBeInTheDocument()` type-errors with _Property 'toBeInTheDocument' does not exist on type 'Assertion<HTMLElement>'_, even though `@testing-library/jest-dom` is imported in the setup file and the matchers work at runtime.

**Root cause.** Declaration merging only merges into an interface **declared** in that module. `vitest` re-exports `Assertion` from `@vitest/expect`; it does not declare it. Augmenting `'vitest'` therefore creates a new, unrelated interface instead of extending the real one, and the augmentation silently does nothing.

**Fix.** Augment the module that declares the interface:

```ts
// apps/web/src/vitest-matchers.d.ts
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

declare module '@vitest/expect' {
  interface Assertion<T = any> extends TestingLibraryMatchers<T, void> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<unknown, void> {}
}
```

**Rule.** When a `declare module` augmentation compiles but has no effect, the target module re-exports the symbol rather than declaring it. Follow the type to its `.d.ts` and augment _there_. This applies to any re-export barrel, not just vitest.

---

## 3. Windows will not rename a directory an editor has open

**Symptom.** `Rename-Item` / `mv` on a project directory fails with _The process cannot access the file because it is being used by another process_ (`EBUSY` / `EPERM`). Closing the file in VSCode does not help; the file watcher still holds the directory handle.

**Root cause.** Windows takes a mandatory lock on a directory handle. VSCode's file watcher (and any running `tsc --watch`, `vite`, or terminal whose cwd is inside the tree) keeps that handle open for the whole session.

**Fix.** Copy, then delete, rather than rename:

```powershell
robocopy .\old .\new /E /MOVE
```

Or close the workspace entirely before renaming. `robocopy /MOVE` copies file-by-file, which never needs the directory handle itself.

**Rule.** On Windows, treat directory renames of a live workspace as unavailable. Reach for robocopy-then-delete first instead of discovering the lock at the worst moment. This will recur on every machine move or package rename.

---

## 4. Port 5432 was already taken, so compose publishes 5433

**Symptom.** `docker compose up` reports _bind: address already in use_ on 5432 — or worse, it binds fine and Prisma connects to the _wrong_ database, because a native Postgres service is already listening there.

**Root cause.** A local Postgres install (PID 6248 on this machine) owns 5432 and starts with Windows.

**Fix.** `docker-compose.yml` publishes `5433:5432`. Every connection string in `.env.example`, `packages/db/.env.example` and the docs must say **5433**.

**Rule.** Never assume a default port is free on a development machine. The silent-wrong-database failure is far more expensive than the bind error, so check `netstat -ano | findstr :5432` before blaming the ORM.

**Recurred, worse, on 2026-08-16.** Postgres was never the only clash. Other projects' containers carry `restart: unless-stopped`, so they all came back the moment Docker Desktop started and already owned **9000, 9001 and 6379** — `e-filing-minio` and `e-filing-redis` in particular. Every host port in `docker-compose.yml` is now `${NAME:-default}`, defaults unchanged so a fresh clone is unaffected, with this machine's overrides in the gitignored `.env`. Check what is already running before assuming a free port:

```bash
docker ps --format '{{.Names}}\t{{.Ports}}'
```

**Still open.** The local `packages/db/.env` on this machine is correct (5433), but the committed `packages/db/.env.example` still says **5432**. Root `.env.example` says 5433. A fresh clone that copies the db example will connect to the wrong Postgres — exactly the failure this lesson is about, shipped in the file that documents it.

---

## 5. `git filter-repo` silently removes the `origin` remote

**Symptom.** After a successful `git filter-repo` run, `git push` fails with _No configured push destination_. `git remote -v` is empty.

**Root cause.** filter-repo removes remotes deliberately: the rewritten history shares no commits with the remote, so any push would be a force-push. Dropping the remote is a guard rail against doing that by reflex. It is documented, and it is easy to miss in the output.

**Fix.** Re-add the remote explicitly, then force-push with a lease:

```bash
git remote add origin git@github.com:<owner>/<repo>.git
git push --force-with-lease --set-upstream origin main
```

**Rule.** After any history rewrite: take a bundle backup first (`git bundle create ../backup.bundle --all`), expect the remote to be gone, and never use bare `--force` — `--force-with-lease` is the one that refuses when someone else has pushed. Anyone with the old history cloned will need a fresh clone.

---

## 6. `pnpm <name>` runs pnpm's own command, not your script

**Symptom.** `pnpm db:deploy` fails with `ERR_PNPM_INVALID_DEPLOY_TARGET  This command requires one parameter`. Prisma is never invoked. The package script it was supposed to call is present, spelled correctly, and works when run from inside the package.

**Root cause.** The root script was `pnpm --filter @skillwright/db deploy`. `deploy` is a **built-in pnpm command** (it deploys a workspace package to a directory), and a built-in always wins over a same-named script. The failure names pnpm's own argument contract, which reads like a broken script rather than the wrong program entirely.

**Fix.** Say `run` explicitly:

```json
"db:deploy": "pnpm --filter @skillwright/db run deploy"
```

**Rule.** Always write `pnpm --filter <pkg> run <script>` in a package.json script, never the bare form. The names that collide are not obvious — `deploy`, `pack`, `publish`, `prune`, `link`, `add`, `remove`, `import`, `patch`, `server`, `store`, `why`, `init`, `setup`, `env`, `root`, `bin`, `list` — and the two-character fix costs nothing on the names that do not.

---

## 7. `docker compose up --wait` treats a one-shot container's success as failure

**Symptom.** Every service reports `Healthy`, the work the init container was supposed to do is verifiably done, and the command still exits 1 with `container skillwright-minio-init-1 exited (0)`.

**Root cause.** `--wait` waits for services to reach _running or healthy_. A container that exits — however successfully — reaches neither. `minio-init` creates the bucket and terminates by design, so the healthy stack always looked like a failed one.

**Why it mattered more than it looked.** `pnpm dev` was `docker compose up -d --wait && turbo run dev`. The `&&` meant the dev servers could never start, and the visible error would have been about MinIO.

**Fix.** Start the one-shot service without `--wait`, then wait on the long-running ones. `depends_on: minio: service_healthy` still sequences it correctly:

```json
"infra:up": "docker compose up -d minio-init && docker compose up -d --wait postgres redis minio mailpit"
```

**Rule.** `--wait` and one-shot containers are incompatible; name the long-running services explicitly. More generally, when a health-gated command fails, read _which_ container it names before assuming the stack is broken.

---

## 8. An unrecognised log level meant maximum verbosity

**Symptom.** Setting `LOG_LEVEL=silent` produces thousands of lines of Prisma query logs — strictly more output than any other setting. Sixteen test results are buried under them.

**Root cause.** `packages/db/src/logger.ts` is dependency-free and knew only `debug|info|warn|error`. Its lookup was `if (configured in LEVEL_ORDER)`, so `silent` — which pino accepts and `apps/api/src/env.ts` validates as legal — missed the table and fell through to the default, and the default outside production is `debug`. Asking for no output selected the noisiest output there is.

**Fix.** Map pino's full vocabulary onto the four internal levels, with `silent` as `Number.POSITIVE_INFINITY`.

**Rule.** When two components read the same environment variable, they must agree on its vocabulary — the one with the smaller vocabulary is where the bug lives. And an unrecognised value must never fall through to the _most_ dangerous or verbose branch; make the fallback the quiet, safe one, or reject the value outright.

---

## 9. The test suite pointed at the development database

**Symptom.** None yet — this was caught by reading `test/setup.ts` before running it, one command short of destroying a seed that had taken all day to produce.

**Root cause.** `setup.ts` defaulted `DATABASE_URL` to `…/skillwright`, the development database, and its `resetDatabase()` helper runs `prisma.user.deleteMany({})` and `prisma.department.deleteMany({})` between files. Under `pnpm test` on a developer machine that is unconditional data loss. It was invisible because the fallback had never executed — the tests had never run at all.

**Fix.** Derive the test database from `DATABASE_URL` rather than sharing it, put rate-limit keys in a separate Redis db index, and **refuse to start** if the resulting name does not end in `_test`:

```ts
if (!targetDatabase.endsWith('_test')) {
  throw new Error(`Refusing to run against database "${targetDatabase}"…`);
}
```

**Rule.** Any fixture that deletes rows must assert what it is connected to before the first test, not trust a default. A destructive default that has never run is not safe, only untested. CI's database name was changed to match so the guard holds in both places.

---

## 10. "Observed passing" that was never observed

**Symptom.** `pnpm check:brand` failed with 10 offences immediately after a phase whose notes recorded it as green. Seven of the ten were in files untouched for the entire session — `git status` showed them unmodified since their commit, so the check had been failing on the committed tree all along.

**Root cause.** The status was written from intent rather than from output. The two checks either side of it genuinely had been run, which is what made the claim survive review.

**Fix.** Re-ran it, fixed all ten (five product-name literals now import `BRAND`, a CSS comment reworded, and a narrow documented exemption for the three files whose job is to record history and therefore must be able to name the old paths), and corrected the false entry in `PROGRESS.md` rather than quietly overwriting it.

**Rule.** A green tick goes in the log only with the command's output in front of you. This is exactly why `PROGRESS.md` tags entries **verified** or **written** — the tag is worthless if "verified" is applied from memory. When a claim is found to be wrong, correct the old entry in place and say so; a log that silently rewrites itself cannot be trusted for the thing it exists to do.

---

## 11. Green tests, 500s on real data — fixtures and the seed generated different ids

**Symptom.** Every API test passes. The first real request to the same endpoint returns `500 INTERNAL`, and the log names the response serializer: `ZodError: [{ "validation": "cuid", "code": "invalid_string", "path": ["data", 0, "id"] }]`.

**Root cause.** Three sources disagreed about what a primary key looks like. `schema.prisma` declares `@default(cuid())`; `packages/shared/src/schema/common.ts` validated `z.string().cuid()`; and `packages/db/prisma/seed.ts` writes deterministic **ULIDs** (`01JGXDFAM0K2Z1GYCSNM5F5RCX`) so that a reseed is byte-identical. Test fixtures insert through Prisma and get cuids, so the suite never met a ULID. Only the seeded database did — which is to say, only the demo, and every screen of it.

**Fix.** `idSchema` accepts either shape, and says why in the file. The seed's determinism is worth keeping; the validator asserting a uniformity that was never true is not.

**Rule.** Fixtures must produce data the same way production data is produced, or the test suite is validating a shape that only exists in the test suite. When a test fixture and a seed disagree about _any_ generated value — ids, timestamps, slugs — the seed is the honest one, because it is what a reviewer will actually see. Smoke-test at least one real request against seeded data before calling an endpoint done.

---

## 12. Fastify hands a bodyless POST to the validator as `null`, not `undefined`

**Symptom.** `POST /courses/:id/enrollments` answers `422 VALIDATION_FAILED` with `{"path":"","message":"Expected object, received null"}` — for a route whose body schema is `.optional()` and whose caller deliberately sends no body.

**Root cause.** `z.object({...}).optional()` accepts `undefined`. Fastify sets `request.body` to `null` when a request carries no body. The two never meet, so the validation error fires in `preValidation` — _before_ `preHandler* — and the policy gate never runs. The SPA posts no body here (`CourseDetail.tsx:70`), so this was broken for real users, not only for tests.

**Fix.** `.nullish()` on the body schema and `request.body ?? undefined` at the call site.

**Rule.** Use `.nullish()`, never `.optional()`, for a Fastify body schema that is allowed to be absent. And remember the hook order: validation precedes `preHandler`, so a malformed request gets 422 rather than the 401/403 you may be asserting. A test expecting 403 that receives 422 is usually telling you the schema is wrong, not the test.

---

## 13. An out-of-transaction write from inside a transaction deadlocks the pool

**Symptom.** A load test that should seat 30 of 200 seats exactly seats 18. The errors are not conflicts but `P2024 Timed out fetching a new connection from the connection pool (connection limit: 29)`, thrown from inside the audit extension.

**Root cause.** An interactive transaction holds its connection for the entire callback. The audit extension deliberately reads the before-image and writes its row through the _un-extended_ client so the audit trail survives a rollback — which means a second connection, from the same pool. Once concurrency reaches the pool size, every in-flight transaction holds one connection and waits for another that only a peer transaction can release. That is a deadlock, and it resolves as a timeout, so it reads like slowness.

**Fix.** A dedicated `auditPrisma` client with its own small pool. Audit work never waits on a transaction, so its pool always drains and progress is guaranteed. Raising `connection_limit` is not a fix: the requirement would be two connections per concurrent transaction, and Postgres defaults to 100 total.

**Rule.** Never acquire a second connection while holding a transaction open — that includes anything a Prisma client extension, an ORM hook or a logging middleware does behind your back. If a component must write outside the enclosing transaction, give it its own pool. When a concurrency test fails _low_ rather than high, suspect resource exhaustion before suspecting the lock.

---

## 14. One authorization helper was the only place a session state was checked

**Symptom.** None visible. `GET /enrollments` returned correct data to a session that had supplied a password but not yet its TOTP code.

**Root cause.** The `MFA_PENDING` refusal lived inside `authorize()`, the per-route policy bridge. Routes whose visibility is a WHERE clause rather than a subject decision — a list scoped to the caller — legitimately skip `authorize()`, and so inherited no provenance check at all. The `onRequest` hook checked `user.status` but never `session.provenance`, so a half-authenticated caller saw everything their role could see. `GET /enrollments/:id` on the same router blocked that session correctly, which is what made the gap visible.

**Fix.** Refuse `MFA_PENDING` in the `onRequest` hook, beside the existing status checks, exempting only the `/auth/` prefix so `/auth/mfa/verify` stays reachable.

**Rule.** A check that every route must pass belongs in the hook every route runs, not in a helper most routes call. Ask of any guard: what happens on a route that does not call it? If the answer is "nothing", it is a convention, not a control. The tell here was two sibling routes disagreeing — when one endpoint refuses a caller and its neighbour serves them, the neighbour is not more permissive by design, it is unguarded.

---

## 15. A permission check with no subject denies everyone

**Symptom.** A screen renders its loading skeleton forever. No error, no failed request — the network tab shows the request was never made. It affects every user including admins.

**Root cause.** `can(actor, action, subject?)` substitutes an empty subject when the third argument is omitted, and most rules are subject-dependent: `isParticipant` reads `subject.participantIds`, `isPublished` reads `subject.publishedAt`, `ownsCourse` reads `subject.courseTeacherId`. **A rule that reads an absent field must deny** — that is correct and deliberate. So `policy.can('conversation:read')` with no subject is always `false`, and used as React Query's `enabled:` it disables the query permanently. A disabled query in React Query v5 stays `status: 'pending'`, so the skeleton never resolves.

The same trap exists server-side: a subject-free `authorize()` on a list route 403s every legitimate caller. The API modules hit it, recognised it, and documented it rather than routing around it.

**Fix.** Do not gate a **list** on a subject-free check, on either side. The server narrows rows with a WHERE clause mirroring the policy rows; the client simply runs the query. A subject-free `can()` is only correct for an action whose rule is a bare `allow`/`deny` for every role — `department:list`, `course:create`, `user:list`.

**Rule.** Before writing `can(actor, action)` with no subject, look up that action's rule for every role. If any of them reads a subject field, the call is a guaranteed denial and you have written an off switch, not a guard. The failure is silent in both directions — nothing throws, nothing logs, and the type system is perfectly happy.

---

## 16. Long-lived dev processes lie to you on Windows

**Symptom, one.** `pnpm typecheck` fails at `@skillwright/db#generate` with no TypeScript error — just `command exited (1)`. It passes the moment the dev server is stopped.

**Symptom, two.** A route returns 404 that is definitely registered in `app.ts`. Restarting does not help. The file is correct; `grep` proves it.

**Root cause.** Both are the same thing: a process you forgot is running.

The first is a file lock — a running API holds the generated Prisma client open, and Windows will not let `prisma generate` rewrite it (see lesson 3; it is the same mandatory-lock behaviour as the directory case).

The second is a port squat. A background server started **before** an edit keeps serving the old code, and a newly started one silently fails to bind because the port is taken. `curl` then answers from the stale process, so the symptom looks like the edit did not apply.

**Fix.** Before any typecheck or build, and before trusting any manual request:

```bash
netstat -ano | grep ':4000 ' | grep LISTENING   # then taskkill //F //PID <pid>
```

**Rule.** When an edit provably in the file does not appear at runtime, suspect the process before the code. Kill by PID and confirm the port is free before restarting — never assume a previous background start died, and never `taskkill //IM node.exe`, which also kills every other project's servers.

---

## 17. A required field the writer never writes

**Symptom.** 147 notifications exist, are counted correctly, and every one renders blank. The endpoint returns 200 with `payload: {"title": "", "body": ""}`.

**Root cause.** `notificationPayloadSchema` requires `title` and `body`. The seed wrote `{courseName, courseSlug, actorName}` — real, useful context, and none of the two keys the schema demands. The mapper's `safeParse` failed for every row and fell back to a blank payload, which is a _graceful_ degradation and therefore an invisible one: no 500, no error log the caller sees, just empty strings.

**Fix.** The seed now writes real `title`/`body` copy per notification type. The schema was right; the writer was wrong.

**Rule.** A schema is a contract with two sides, and tests usually only exercise one. When a producer and a consumer of the same column live in different packages, assert the round trip against real seeded data, not just against fixtures. And be suspicious of a fallback that renders something plausible — a blank string is much harder to notice than a stack trace, which is exactly why it survived to this point.

---

## 18. A helper that casts is a helper that hides

**Symptom.** Ten permission checks on one screen all denied. The Edit button was hidden from the teacher who owned the course, the Students tab never rendered, Approve and Reject were permanently disabled, and private resources were undownloadable by their own author. No error, no warning, and the code read correctly.

**Root cause.** The screen built its policy subject as `subject({ teacherId: course.teacher.id, viewerEnrollmentStatus: ... })`. The rules read `subject.courseTeacherId` and `subject.enrollmentStatus`. The keys were simply wrong — and the helper was declared

```ts
export function subject(draft: Record<string, unknown>): PolicySubject {
  return draft as unknown as PolicySubject;
}
```

so nothing checked them. The cast was justified in a comment as necessary for partial projections, but **every field on `Subject` is already optional** precisely so a partial projection is legal. The cast bought nothing and cost the excess-property check, which is the one thing that catches this.

Because a rule that reads an absent field must deny, a misspelled key and a genuine refusal are indistinguishable at runtime. There is no failure to observe.

**Fix.** `export function subject(draft: PolicySubject): PolicySubject { return draft; }` — a wrong key on an object literal is now a compile error. Note the remaining hole: TypeScript does not excess-property-check a spread, so `subject({ ...resource })` still passes silently. Name the fields.

**Rule.** Before writing `as` in a helper, check whether the target type actually rejects the input — if every field is optional, it does not, and the cast is disabling your only guard. A cast in a shared helper is worse than a cast at a call site: it removes checking from every caller at once, and its comment will explain why that was fine.

---

## 19. Delegated work needs the failure list, not just the specification

**Symptom.** Two rounds of generated modules. The first shipped an unregistered plugin, a `.optional()` body that answered 422 for a bodyless POST, and a second connection opened inside a transaction. The second round, given those three as explicit rules up front, shipped none of them — and typechecked on the first compile.

**Root cause.** A specification says what to build. It does not say which correct-looking choices are wrong in this repository. Every defect above is a decision that looks right in isolation and is wrong here: `.optional()` is the obvious choice for an absent body, `include: { user: true }` is the obvious way to load a relation, and a plugin file that exports a default is obviously finished.

**Fix.** Carry a standing "known traps" block into every delegated brief, phrased as rules with the symptom attached, and grow it from what the last round actually got wrong. `docs/LESSONS-LEARNED.md` is that block.

**Rule.** Review output twice: once against the specification, once against the list of things that have already gone wrong here. And when a reviewer reports zero findings on freshly written, never-executed code, disbelieve the report before believing the code — read the raw per-agent results rather than a summary, because a summary can lose them. Nineteen real defects were reported across three rounds while one summary field showed zero.

---

## 20. A dev proxy pointing at a port nothing listens on

**Symptom.** Every screen in the browser is empty or stuck. The API is healthy, `curl` against it returns real data, 815 tests pass, and the SPA's own unit tests are green. Nothing anywhere reports an error.

**Root cause.** `apps/web/vite.config.ts` proxied `/api` to `http://localhost:3000`. The API defaults to `PORT=4000` and both `.env` files say 4000. The number was written twice, in two files, and drifted — and _no test could see it_: the integration suite calls the API directly through `inject()`, and the SPA's unit tests mock the client. The dev proxy is exercised by exactly one thing, a human with a browser, and nobody had opened one.

**Fix.** The proxy now loads the repo-root `.env` and derives the target from `PORT`, so there is one source of truth:

```ts
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
const API_ORIGIN = `http://localhost:${process.env.PORT ?? '4000'}`;
```

**Rule.** An address written in two places is a bug with a delay on it. Derive it from the configured value rather than restating it. And note where the gap was: between two well-tested components, in the wiring neither one's tests cover. Ask what your test suite structurally _cannot_ see — for a SPA and an API tested separately, the answer is always the thing that joins them.

---

## 21. Measuring accessibility while the page is still animating

**Symptom.** axe reports roughly forty contrast violations, some absurd — ratios of 1.12 and 1.15, foreground `#e7eaee` on background `#f5f7f9`, colours no designer chose.

**Root cause.** The app fades content in. axe sampled elements mid-transition and measured the _interpolated_ colour against the background. Every one of those impossible ratios was a real element at partial opacity.

**Fix.** Measure with animation disabled and after the page settles:

```js
const context = await browser.newContext({ reducedMotion: 'reduce' });
await page.waitForTimeout(2000);
```

Forty apparent violations became **one** real one.

**Rule.** Never report an a11y number taken from an animating page. Force `reducedMotion: 'reduce'`, wait for settle, then measure. And when a tool reports something physically implausible — a 1.12:1 ratio between two colours nobody picked — distrust the measurement before you distrust the code. Reporting forty violations when there is one destroys the credibility of the one that mattered.

---

## 22. The implementation quietly inverted the brief's signature decision

**Symptom.** The primary button — the most-clicked element in the product — was white text on ember at **3.99:1**, failing WCAG AA. So was the wordmark tile.

**Root cause.** `docs/rebuild/02-design-direction.md` picks Direction A, and lists as its first memorable quality: _"the amber-with-dark-text primary button — `#171412` on `#E88C05`. Nobody in education does this… it happens to be an 8.5:1 contrast ratio, so it's more accessible than white-on-blue."_ It then justifies the whole direction on that basis: _"It solves the accessibility problem instead of fighting it. Most education products fight a 3.2:1 white-on-blue button their entire life."_

The token block spells it out — `--text-on-brand: var(--iron-950)`. The implementation shipped `--text-on-brand: #ffffff`. The single decision the direction was _chosen for_ was reversed in the file that implements it, producing the exact failure it was chosen to avoid.

**Fix.** `--text-on-brand` is the dark ink, the brand fill is `ember-500`, and interaction states go **lighter** rather than darker — with dark ink on the fill, darkening cuts contrast instead of adding it. 5.67:1. `--text-secondary`/`--text-tertiary` moved down a step each so three distinct levels all clear AA. Both themes now report **zero** axe violations across four screens.

**Rule.** When a brief names a specific value as the reason for a decision, that value is a requirement, not an illustration — assert it in a test or a token comment rather than re-deriving it from taste later. And a design system's own tokens deserve the same "does it match the spec" review as code: nothing failed, nothing warned, and the claim quietly became false.

---

## 23. Fixing one contrast axis can break the other

**Symptom.** A primary button was changed from white-on-ember to dark-on-ember to fix a 3.99:1 text failure. Text contrast went to 5.67:1 and axe reported zero violations. A reviewer then measured the button's **fill against the page** and found 2.98:1 — under the 3:1 that WCAG 1.4.11 requires for an unbordered filled control to be identifiable at all.

**Root cause.** Two different requirements point in opposite directions on the same ramp. Darkening a fill raises white-text contrast and lowers dark-ink contrast; lightening it does the reverse — and the fill's contrast against the surrounding surface moves with it. Optimising for the ratio the tool reports is not the same as satisfying the standard.

Worse, **axe did not catch the second failure**: it evaluates text contrast (1.4.3), not the non-text contrast of a component boundary (1.4.11), and it only sees the states actually rendered — never a hover tint, a highlighted row, or a panel that was closed when the scan ran.

**Fix.** Tabulate the whole ramp against every constraint at once before picking. Here exactly one shade satisfied both:

| fill          | ink on fill (≥4.5) | fill vs canvas (≥3.0) |
| ------------- | ------------------ | --------------------- |
| ember-500     | 5.67               | **2.98**              |
| **ember-600** | **4.54**           | **3.72**              |
| ember-700     | **3.19**           | 5.30                  |

**Rule.** A colour decision has at least two contrast constraints — text on the fill, and the fill against what surrounds it — plus one per interaction state. Compute the table; do not pick by improving the number you happened to measure. And treat a green axe run as evidence about rendered text only: closed overlays, hover states and component boundaries are outside what it checks, so "zero violations" is a floor, not a result.

---

## 24. A platform-behaviour fix belongs to the class, not the site

**Symptom.** A teacher who had never been entitled to an enrolment POSTed `/enrollments/:id/approve` with no body and got **`422 VALIDATION_FAILED`** instead of `403`. The same call carrying `{}` was refused correctly, with the rule named. Two other routes had been fixed for exactly this three weeks earlier, with a comment explaining it.

**Root cause.** Fastify hands a POST sent with no body to the validator as `null`, and an all-optional Zod object rejects `null`. Body validation runs **before** the policy `preHandler`, so the caller learns "malformed" about a resource they were never allowed to touch. When this first bit, it was fixed on the three routes where it had been observed — `requestEnrollment`, `markNotificationsRead`, `suspendUser` — and `approve` and `withdraw`, which have the same all-optional shape, were left alone because nothing had complained about them yet. The SPA sends `{}` on both, so no client and no test ever exercised the broken path.

**Fix.** `body: approveEnrollmentSchema.nullish()` and the same for `withdraw`, handler taking `request.body ?? undefined`. Two regression tests that send **no body deliberately**, one for the 403 and one for the owner's 200.

**Rule.** When the cause of a bug is a platform behaviour rather than a typo, the fix is not done until you have grepped for every site with the same shape and either fixed or consciously excluded each one. `grep -rn "body: \w*Schema" apps/api/src/modules/*/*.routes.ts` was a five-second query that would have found both. A test that exercises the working spelling (`{}`) passes either way, which is why the broken spelling has to be the thing the test sends.

---

## 25. An error code the client renders by is the only part of the error that exists

**Symptom.** A suspended person tried to sign in and was told **"You don't have access to that."** The API's response carried `"detail": "This account has been suspended"`, and the SPA had a sentence written for this exact case — `ERROR_COPY.ACCOUNT_SUSPENDED`, "This account has been suspended." — which had never once been rendered.

**Root cause.** The SPA renders errors from `problem.code`, never `problem.detail`, and deliberately: policy details carry rule names like `TEACHER:ownsCourse` and are diagnostics, not user copy. The API had a dedicated `accountSuspended()` helper producing code `ACCOUNT_SUSPENDED` — the auth plugin used it, but `auth.service.login` reached for the generic `forbidden('This account has been suspended')`. The right sentence in the wrong field is invisible.

**Fix.** Throw `accountSuspended()` from login and verify-email. One assertion on the **code**, not the message.

**Rule.** When a client maps code to copy, the code is the whole contract and a hand-written `detail` is a comment for developers. Reaching for the generic 403/404/409 helper silently discards the message. Before adding a `detail` that reads like something a user should see, check whether a dedicated code exists — and if you add one, add its copy in the same change, or you have shipped a string nothing can reach.

---

## 26. Driving a browser will invent defects that are not there

**Symptom.** Two findings written up and withdrawn in one session. A dashboard tile appeared to read "Pending requests **0**" above a queue listing four pending requests — a contradiction the service's own comment says "is a bug report". And every toast appeared to render with no live region, making every status message in the app unannounceable.

**Root cause.** Neither was real.

The tile reads **4**. The measurement was `document.body.innerText.match(/Pending requests[^A-Z]*\d+/i)` — but the tile puts the **value before the label**, so the regex ran past the label and captured the _next_ tile's value. The API, queried directly, said `pendingEnrollments: 4` all along.

The live region exists — `span[aria-live="assertive"][role="status"]` — but Radix unmounts it about a second after the toast opens, once it has been announced. The sample was taken at 1.3s. A `MutationObserver` plus samples at 80/200/400/700ms found it on every one.

**Fix.** For values: read the specific element, not a regex over `innerText`. For anything transient: observe the window, do not sample an instant.

**Rule.** A browser assertion is code, and it fails the same way the app does. Before reporting a UI defect, confirm it from a second, independent direction — query the API, read the element, watch the DOM over time. See also [21], which is the same mistake with animation as the cause. The cost of the check is a minute; the cost of skipping it is a fix to something that was never broken.

---

## 27. A cached identity outlives the server's revocation of it

**Symptom.** An admin suspends someone who is mid-session. The API destroys every session row immediately and answers their next authenticated request `401`. In the browser, the suspended student's Settings screen showed an inline "we could not load you" **under a shell still reading "Student workspace", beside a profile card still reading "Active"** — and clicking Dashboard from there issued **no requests at all** and painted a full dashboard from cache. They could keep browsing indefinitely.

**Root cause.** The route guard already handled this: `requireAuth` redirects a null session to `/login`, and has a `status === 'SUSPENDED'` branch besides. But it reads the session through `ensureQueryData`, and that cache entry was still present and still inside its `staleTime` — so the guard re-ran on every navigation and kept answering with the user it had been told about before the suspension. Nothing in the client treated a `401` as news. The server was correct throughout; the client simply never asked again.

**Fix.** A `QueryCache`/`MutationCache` `onError` that recognises `UNAUTHENTICATED` and `ACCOUNT_SUSPENDED`, drops the session entry and everything fetched under it, and re-runs the router's guards. It decides nothing about where a dead session goes — the guard still does. The guard against loops is that it only fires while the cache still believes someone is signed in, and the first thing it does is stop believing that.

**Rule.** Any server-side authority that can change **retroactively** — suspension, a role change, a revoked grant, a logout in another tab — needs a client-side listener, because a guard is only as fresh as the data it reads. Having the right redirect logic is not the same as it running. And when testing revocation, navigate to a screen that makes an **authenticated** request: a public endpoint answers `200` to an anonymous caller, so the app looks fine while being signed out.

---

## 28. A comment cannot hold an invariant. Only a shared function or a test can

**Symptom.** The dashboard's `resources` tile counted 24 while the resources list served 4 — the "tile reads 23 above a list of 4" failure three other counters in the same file are written to avoid.

**Root cause.** The `resource:read` visibility rules existed as a WHERE clause in two places. That was foreseen: `dashboard.service.ts` carried an explicit instruction to whoever would build the module —

> `TODO(resources): when the resources module lands it owns this mirror. Move this function into resources.service.ts as its visibilityWhere and IMPORT it here — do not leave a second copy behind, or a policy change fixes the list and silently misses the tile.`

The module landed with a second copy, and the two had drifted **inside the same change**: the new one excluded resources whose COURSE was soft-deleted, the old one did not. Nobody had ignored the instruction on purpose; the module was written by someone reading the module's own contract, and the TODO was in a file they had no reason to open.

The test that should have caught it was there too, and was named `drops a soft-deleted course out of every counter that reaches it`. It asserted two of the four counters. Not the one that was wrong.

**Fix.** `visibilityWhere` is exported from `resources.service.ts` and imported by the dashboard, which now has no clause of its own — one mirror, structurally. Plus a test that pins the tile to the list: for a teacher, a student and an admin, `stats().resources === GET /resources meta.total`, with a soft-deleted course AND a soft-deleted resource in the fixture so the equality cannot pass as `0 === 0`.

**Rule.** When you notice an invariant spanning two files, a comment asking the next person to fix it is a wish. Make it structural (one exported function) or make it fail (a test that compares the two). And a test whose name promises "every X" must assert every X — the gap between the name and the body is where this hid.

---

## 29. An object literal used as a whitelist is not a whitelist

**Symptom.** `GET /resources?sort=toString` — unauthenticated — answered 500.

**Root cause.** The sort whitelist was an object literal, so it inherits from `Object.prototype`:

```ts
const ORDER_BY: Record<string, (order) => OrderBy> = { createdAt: …, title: … };
const build = query.sort === undefined ? undefined : ORDER_BY[query.sort];
return (build ?? DEFAULT_ORDER)(query.order);
```

`ORDER_BY['toString']` is not `undefined` — it is `Object.prototype.toString`, a **function**, so it sails past the `??` and gets called. It returns a **string**, Prisma is handed `orderBy: '[object Undefined]'`, and the request dies. `?sort=valueOf` throws outright; `?sort=constructor` returns a boxed object.

The code was already careful in the way people remember to be careful — the value was matched against a table rather than interpolated into a key, and a comment said so. The hole is not the interpolation, it is the lookup.

**Fix.** `Object.prototype.hasOwnProperty.call(ORDER_BY, query.sort)` before the index. `__proto__: null` on the table also works, but not while it is typed `Record<string, Fn>` — `null` is not assignable to the value type, so the guard goes at the lookup.

**Rule.** Any time a user-controlled string indexes an object, the prototype chain is part of the input space. Use a `Map`, a null-prototype object, or an explicit `hasOwnProperty` — and test the lookup with `toString`, `valueOf` and `constructor`, not just with a nonsense key, which correctly returns `undefined` and proves nothing.

---

## 30. Parallel agents cannot share one test database

**Symptom.** A build agent reported that the API suite had collapsed: `172 of 241 tests failing across 10 of 11 files`, including files nothing had touched. Every failure was a `409` or `422` at `signIn`. Re-running by hand on the same tree: all green.

**Root cause.** Two agents working in parallel each ran `vitest` against `skillwright_test`. `apps/api/vitest.config.ts` sets `poolOptions: { forks: { singleFork: true } }` precisely so files cannot truncate each other's rows — but that guarantees serialisation **within one vitest process**, and says nothing about two processes. One run's `resetDatabase()` deleted users the other had just created; the survivor's `StudentProfile` then blocked `department.deleteMany` on a Restrict FK, `createDepartment` collided on the unique slug, and every subsequent `signIn` failed. The suite was not broken. The database was.

**Fix.** One database per agent. `test/setup.ts` already reads `TEST_DATABASE_URL` ahead of `DATABASE_URL`, so:

```
createdb skillwright_a_test && prisma migrate deploy   # per agent
TEST_DATABASE_URL=…/skillwright_a_test npx vitest run test/<file>
```

The name **must** end in `_test` — `setup.ts` refuses anything else, because `resetDatabase()` deletes every user. `skillwright_test_a` is rejected; `skillwright_a_test` is not.

**Rule.** Before fanning agents out, list the singletons they will contend for — the database, a port, a lockfile, a generated client — and give each agent its own or serialise that step. And when an agent reports a catastrophic failure in code nobody touched, suspect the shared resource before the code: re-run it alone first.

---

## 31. A `can()` with the wrong SHAPE of subject denies exactly like one with no subject

**Symptom.** Four public course resources were served to `curl` with no session at all, and were invisible in the UI to every signed-in user except an admin — including the teacher who owned the course next door and a student browsing the catalogue.

**Root cause.** The Resources tab gated its fetch on `policy.can('resource:read', viewerSubject)`, and `viewerSubject` is a **course**:

```ts
function courseSubject(course: CourseDetail): PolicySubject {
  return subject({ id, courseId, courseTeacherId, departmentId, publishedAt, enrollmentStatus });
}
```

`resource:read` is `or(isPublic, enrolledApproved)` for a student and `or(isPublic, ownsCourse, isAuthor)` for a teacher. A course has no `isPublic` — it has `publishedAt` — so that disjunct could never fire, whatever the data said. Every `Subject` field is optional, so nothing complained: not the type system, not a runtime error, not a log line.

This is [15] one step along. There the subject was **missing**; here it is **present, well-formed, and about the wrong kind of thing** — which is harder to see, because the call site looks correct and the subject is genuinely needed by the tab's other gates.

**Fix.** The list stopped asking. `resource:read` is decided per row, and a list has no single subject — so the server scopes the rows (`visibilityWhere` mirrors the same policy rows as SQL) and the client renders what it is given. The route's own gate is `course:read`, which being on the page already satisfies.

**Rule.** Before passing a subject to `can()`, check that the action's rules read fields that this kind of subject actually has. If the action is decided per row and you are gating a list, that is a category error and the answer is a WHERE clause, not a better subject. Ask what the rule reads, then ask whether the thing in your hand carries it.

---

## 32. A presigned URL constrains exactly what the signature names, and nothing else

**Symptom.** `presignPut` built its command with `ContentType` set and the limits from `UPLOAD_LIMITS` checked by zod in front of it. Both looked enforced. Measured against the MinIO in `docker-compose.yml`:

| signed headers                     | request                                              | store answers                              |
| ---------------------------------- | ---------------------------------------------------- | ------------------------------------------ |
| `content-type;host`                | PUT declaring `application/pdf`, sending `image/png` | **200, stored**                            |
| `content-type;host`                | PUT with no `Content-Type` at all                    | **200**, recorded as `binary/octet-stream` |
| `content-type;host`                | 500 bytes against a signature for 23                 | **200, stored**                            |
| `content-length;content-type;host` | 500 bytes against a signature for 23                 | **403 SignatureDoesNotMatch**              |

**Root cause.** SigV4 **query** signing puts only `host` in `X-Amz-SignedHeaders` by default. Anything else set on the command is a suggestion to the SDK, not a term of the signature — so the store never checks it. `signableHeaders` is what promotes a header into the signed set.

The declared size was worse than the declared type, because nothing caught it later either: `commit` refuses the ROW, but by then the bytes are in a bucket that has no sweeper. An authenticated caller could declare a 1 KB avatar and park half a gigabyte at that key.

**Fix.** `signableHeaders: new Set(['content-type', 'content-length'])`, and `ContentLength` on the command. `content-length` is deliberately not returned to the client: it is a forbidden header for `fetch` and XHR, so the runtime computes it from the body — which is precisely the value the signature is checked against, and a body streamed with chunked encoding sends none and is refused.

**Rule.** For any presigned upload, write down every constraint you believe is enforced, then prove each one against the real store with a request that violates it. A constraint that is not in `SignedHeaders` (or in a POST policy's conditions) is documentation. And note what the fix does **not** buy: the bytes are still never sniffed, so `contentType` remains the uploader's label — which is why every download is served `Content-Disposition: attachment` rather than rendered inline.

---

## 33. A child object's own visibility flag can outrank its parent's

**Symptom.** An anonymous caller was refused a course with `401` and, in the same breath, served that course's resource with `200` — title, description and all — through `GET /resources`.

**Root cause.** `course:read` is `isPublished` for an anonymous visitor, but `resource:read` was `isPublic`: a flag on the resource, consulted without reference to the course it hangs off. And `resource:create` is `ownsCourse` with no publication term, so a teacher can file material into a course nobody has published. Draft course, public resource, world-readable.

Nothing about this was visible until the resources module existed. The rule had been written that way for months; there was simply no endpoint that could reach it, so a latent design gap became a live leak the moment the list was built.

**Fix.** The public branch of `resource:read` and `resource:download` is now `and(isPublic, isPublished)`, with the course's `publishedAt` carried on the resource subject and mirrored in the SQL. The other branches are deliberately unchanged: an approved student keeps access to material in a course that was later unpublished, and the owning teacher is exactly who is meant to see a draft.

**Rule.** When a child row carries its own visibility flag, ask whether reading the child directly bypasses the parent's gate. The test is concrete: find the endpoint that answers about the parent, find the one that answers about the child, and make the same anonymous request to both. If they disagree, the narrower one is the intent and the wider one is a leak.

---

## 34. A `file:line` citation is only true on the day it is written

**Symptom.** Two rounds of review turned up sixteen citations pointing at the wrong lines. Several were wrong by exactly five — the width of a comment the same change had added to the cited file. One reviewer's proposed correction was itself wrong.

**Root cause.** This repository navigates by `file:line`, which is a real strength and the reason its comments are worth reading. But a line number is a snapshot: editing the cited file breaks every citation below the edit, in files the editor never opened, and nothing checks it. The failure is silent and the citation still _looks_ authoritative — which makes a stale one worse than none, because it sends the reader somewhere confidently wrong.

**Fix.** Correct them, and verify each one by opening both ends before changing it — including the ones a reviewer hands you.

**Rule.** For a citation inside the same file, a line number is fine. Across files, name the **symbol** as well — `courses.service.ts`'s `viewerEnrollmentStatus` survives a reformat; `courses.service.ts:157` does not. When you edit a file that others cite, `grep -rn "<filename>:" ` for references to it. And re-verify after running a formatter: `prettier --write` moved anchors that had been correct ten minutes earlier.

---

## 35. A bare directory name in `.gitignore` matches at every depth

**Symptom.** A new API module was written, compiled, typechecked, passed its tests — and was invisible to `git status`. It would have been committed as an `import` of a file that does not exist in the repository, and the app would not boot on a fresh clone.

**Root cause.** `.gitignore` held `uploads/`, intended for a runtime directory at the repository root. A pattern with no leading slash matches at **any** depth, so it also swallowed `apps/api/src/modules/uploads/`. Nothing warns: `git add` on an ignored path is silent unless you pass `-f`, and every other tool in the stack was perfectly happy.

**Fix.** `/uploads/` — anchored to the root, which is what it always meant.

**Rule.** Anchor any `.gitignore` entry that names a directory you mean at one specific place: `/dist/`, `/uploads/`, `/tmp/`. And after creating a new directory of source files, look at `git status` before believing the work exists — `git check-ignore -v <path>` names the offending pattern and line when it does not.

---

## 36. In Tailwind v4, `outline-none` and `outline-2` on the same element cancel each other

**Symptom.** Keyboard focus rings did not render anywhere in the application. Not faintly, not in one theme — at all. The class lists looked right, the tokens were defined, and axe reported nothing, because axe does not evaluate `:focus-visible`.

**Root cause.** Tailwind v4 compiles `outline-2` to `outline-width: 2px; outline-style: var(--tw-outline-style)`, and `outline-none` sets that same variable to `none` **on the element**. The pattern that reads naturally —

```
outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line-focus
```

— therefore paints a width and a colour over a style of `none`, which is nothing. It is not a specificity problem and no `!important` fixes it; the variable was set by the class sitting right beside it.

Confirmed by reading the computed style at every tab stop rather than by reasoning: every one reported `outlineStyle: "none"` with `outlineWidth: "2px"`.

**Fix.** Name the style explicitly in the same variant: `focus-visible:outline-solid` alongside the width, offset and colour. And gate on `focus-visible`, not on a `data-highlighted` attribute — Radix sets `data-highlighted` on mouse hover too, which paints a keyboard ring under the pointer.

**Rule.** A focus ring is invisible to every automated check this repository runs: axe does not evaluate `:focus-visible`, the mobile-first script does not look at outlines, and nothing type-checks a class string. So the ring is verified the only way it can be — by driving the page and reading `getComputedStyle(el).outlineStyle` at each tab stop, under the keyboard AND under the mouse. When adding a focusable control, copy the class list from a control that has been verified (`Input`'s `controlBase`, `DropdownMenu`'s `itemBase`) rather than assembling `outline-*` utilities by hand.

---

## 37. A `$` in a path is a shell variable, and `git add` fails all-or-nothing

**Symptom.** A commit plan of five commits ran, four landed, and the fifth left eleven files uncommitted. No error was noticed at the time, because the failing command was one line in a run of ten.

**Root cause.** TanStack Router names dynamic segments with a `$`, so route files are literally called `announcements.$announcementId.tsx`. Pasted into a shell unquoted:

```
$ echo apps/web/src/routes/_app/announcements.$announcementId.tsx
apps/web/src/routes/_app/announcements..tsx
```

`$announcementId` is an unset variable and expands to nothing. `git add` then reports `fatal: pathspec '…announcements..tsx' did not match any files` — and, crucially, **stages nothing at all**: it validates every pathspec before adding any of them, so one bad path discards the whole command. The following `git commit` had an empty index and refused, and the pair looked like it had simply produced no output.

**Fix.** Single-quote any path containing `$`:

```
git add 'apps/web/src/routes/_app/announcements.$announcementId.tsx'
```

**Rule.** When writing a command someone will paste into a shell, quote every path that contains `$`, a space, `*`, `?`, `[`, `~` or a backtick — and check the plan mechanically for them, which is one `grep -n '\$' COMMIT-PLAN*.md`. Two habits make the failure loud instead of silent: `git add --dry-run` first, which prints exactly what will be staged, and reading `git log --oneline` against the plan's commit count afterwards. The all-or-nothing behaviour is the trap — a partially-staged commit would have been obvious; an empty one is not.
