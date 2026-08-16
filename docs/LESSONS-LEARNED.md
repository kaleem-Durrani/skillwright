# Lessons learned

Problems that cost real time and have a real chance of recurring. Each entry is written so that the *symptom* is searchable — the thing you will actually see next time — followed by the cause, the fix, and the rule.

Not a bug list. A one-off typo does not go here; a platform behaviour, a toolchain constraint, or a class of mistake does.

---

## 1. One nonexistent dependency blocks the entire workspace install

**Symptom.** `pnpm install` fails at the very end with a 404 on `@fontsource-variable/ibm-plex-mono`. No workspace has its `node_modules`. Nothing else installed either, including the packages that were fine.

**Root cause.** IBM Plex Mono has no variable cut on Fontsource, so `@fontsource-variable/ibm-plex-mono` does not exist — only `@fontsource/ibm-plex-mono` does. The `-variable` naming pattern is real for other families, which is what makes the guess look right. pnpm resolves the whole workspace graph as one unit, so a single unresolvable specifier aborts the install for every package.

**Fix.** Use `@fontsource/ibm-plex-mono`, or a family that actually publishes a variable cut.

**Rule.** Before adding a font, icon or plugin package by inferring its name from a sibling's, confirm the exact package exists (`pnpm view <name> versions`). In a pnpm workspace the blast radius of a wrong name is the whole repo, not one app.

---

## 2. `declare module 'vitest'` cannot add matchers that live in `@vitest/expect`

**Symptom.** `expect(el).toBeInTheDocument()` type-errors with *Property 'toBeInTheDocument' does not exist on type 'Assertion<HTMLElement>'*, even though `@testing-library/jest-dom` is imported in the setup file and the matchers work at runtime.

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

**Rule.** When a `declare module` augmentation compiles but has no effect, the target module re-exports the symbol rather than declaring it. Follow the type to its `.d.ts` and augment *there*. This applies to any re-export barrel, not just vitest.

---

## 3. Windows will not rename a directory an editor has open

**Symptom.** `Rename-Item` / `mv` on a project directory fails with *The process cannot access the file because it is being used by another process* (`EBUSY` / `EPERM`). Closing the file in VSCode does not help; the file watcher still holds the directory handle.

**Root cause.** Windows takes a mandatory lock on a directory handle. VSCode's file watcher (and any running `tsc --watch`, `vite`, or terminal whose cwd is inside the tree) keeps that handle open for the whole session.

**Fix.** Copy, then delete, rather than rename:

```powershell
robocopy .\old .\new /E /MOVE
```

Or close the workspace entirely before renaming. `robocopy /MOVE` copies file-by-file, which never needs the directory handle itself.

**Rule.** On Windows, treat directory renames of a live workspace as unavailable. Reach for robocopy-then-delete first instead of discovering the lock at the worst moment. This will recur on every machine move or package rename.

---

## 4. Port 5432 was already taken, so compose publishes 5433

**Symptom.** `docker compose up` reports *bind: address already in use* on 5432 — or worse, it binds fine and Prisma connects to the *wrong* database, because a native Postgres service is already listening there.

**Root cause.** A local Postgres install (PID 6248 on this machine) owns 5432 and starts with Windows.

**Fix.** `docker-compose.yml` publishes `5433:5432`. Every connection string in `.env.example`, `packages/db/.env.example` and the docs must say **5433**.

**Rule.** Never assume a default port is free on a development machine. The silent-wrong-database failure is far more expensive than the bind error, so check `netstat -ano | findstr :5432` before blaming the ORM.

**Still open.** The local `packages/db/.env` on this machine is correct (5433), but the committed `packages/db/.env.example` still says **5432**. Root `.env.example` says 5433. A fresh clone that copies the db example will connect to the wrong Postgres — exactly the failure this lesson is about, shipped in the file that documents it.

---

## 5. `git filter-repo` silently removes the `origin` remote

**Symptom.** After a successful `git filter-repo` run, `git push` fails with *No configured push destination*. `git remote -v` is empty.

**Root cause.** filter-repo removes remotes deliberately: the rewritten history shares no commits with the remote, so any push would be a force-push. Dropping the remote is a guard rail against doing that by reflex. It is documented, and it is easy to miss in the output.

**Fix.** Re-add the remote explicitly, then force-push with a lease:

```bash
git remote add origin git@github.com:<owner>/<repo>.git
git push --force-with-lease --set-upstream origin main
```

**Rule.** After any history rewrite: take a bundle backup first (`git bundle create ../backup.bundle --all`), expect the remote to be gone, and never use bare `--force` — `--force-with-lease` is the one that refuses when someone else has pushed. Anyone with the old history cloned will need a fresh clone.
