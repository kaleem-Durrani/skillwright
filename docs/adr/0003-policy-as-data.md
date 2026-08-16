# ADR 0003 — Authorization is a policy module, not middleware

**Status:** Accepted · **Date:** 2026-08-16

## Context

The previous system checked permissions wherever someone remembered to. There were four authorization middlewares plus five inline copies of the same logic. Two course-access middlewares differed subtly and were chosen apparently by habit. On one route the authorization middleware ran _before_ authentication, so its entire body was unreachable. No test asserted that a student could not read another course's private resources.

That is not unusual for the genre. It is normal. Which is exactly why doing it properly is worth doing.

The failure mode is structural: when rules live in middleware, in controllers and in `user.role === 'admin'` checks in the UI, there is no single place that states what the rules _are_, so nothing can verify them and nothing can document them.

## Decision

One module, `@skillwright/shared/policy`, exposing `can(actor, action, subject): PolicyResult`.

Three properties make it work:

1. **Pure.** Every rule is `(actor, subject) => boolean`. No I/O, no Prisma import, no `await`. The caller loads the subject; the policy only judges it. This is why the whole matrix runs as a unit test in milliseconds.
2. **Shared.** The package has no runtime dependency on the database, so the SPA imports the same rules the API enforces. A button that would return 403 never renders — and it never renders because of the same function that would have returned the 403.
3. **Exhaustive.** `ACTIONS` is derived from the policy object's keys, so a new action cannot be added without appearing in the matrix, in the generated documentation, and in the test table.

Denials return `{ allowed: false, reason, rule }`. The rule name reaches the error response and the audit log, so "403" is always answerable.

## Consequences

- `docs/permissions.md` is generated from the policy and checked in CI. Documentation cannot drift.
- The policy cannot express a rule that needs a lookup. Anything requiring a query is resolved into the `Subject` before `can()` is called — which is a constraint, and the constraint is the point.
- Client and server must run the same version of the package. The monorepo guarantees it; a split repository would not.
