# Contributing

## Commits

Three lines, at most:

1. **Prefix** — a conventional-commit type and optional scope: `feat(enrollments):`, `fix(policy):`, `chore(deps):`, `docs:`, `refactor:`, `test:`, `perf:`, `build:`, `ci:`.
2. **Subject** — what changed, imperative, lower case, no trailing period, under 72 characters.
3. **Body** — why, or nothing at all. If the diff explains itself, leave the body empty. Never restate the diff in prose.

```
feat(enrollments): reject approval past capacity with 409

SERIALIZABLE turns a capacity conflict into a serialization failure the
caller has to distinguish from a real error. The conditional UPDATE makes
the conflict the answer instead of an exception. See ADR 0006.
```

```
fix(policy): deny resource:create in a course the teacher does not own
```

Breaking changes get a `!` after the type (`feat(api)!:`) and a `BREAKING CHANGE:` footer.

No generated commit messages. A message that could have been written by reading the diff was not worth writing.

## Before you push

```bash
pnpm typecheck && pnpm lint && pnpm format && pnpm test
pnpm check:brand && pnpm check:mobile-first
```

CI runs all of these plus integration tests, a build, and `generate-permissions-doc --check`. Nothing here is a suggestion — every one of them can fail a pull request.

## Branches

Branch from `main`. Name it `<type>/<short-slug>` — `feat/totp-enrolment`, `fix/session-sliding-expiry`. Rebase before merging; the history is linear and stays that way.

## Adding a permission

1. Add the action to the policy in `packages/shared/src/policy/`. `ACTIONS` is derived from the policy object's keys, so this is the only place it is declared.
2. Add its rows to `apps/api/test/policy-matrix.test.ts`, **including the denials**. A rule with only positive cases has not been tested.
3. Run `pnpm docs:permissions` and commit the regenerated `docs/permissions.md`.

Skipping step 3 fails CI, which is the intent.

## Things that will be sent back

- A permission checked anywhere other than through `can()`.
- A type hand-written on the client that the schema already describes.
- `any` without a one-line comment justifying it.
- `console.log`. Use the logger.
- A `max-width` media query, a raw hex colour, or a stock Tailwind palette class in `apps/web/src`. See ADR 0008.
- A new dependency without a sentence in the pull request saying what it replaces.

## Decisions

Anything that would be expensive to reverse gets an ADR in `docs/adr/`, under 300 words, in Context / Decision / Consequences form. Name the tradeoff you accepted — an ADR that lists only advantages is marketing.
