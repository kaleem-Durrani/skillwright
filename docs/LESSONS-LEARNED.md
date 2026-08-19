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
