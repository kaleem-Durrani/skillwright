# ADR 0006 — Conditional atomic increment plus a CHECK constraint, not SERIALIZABLE

**Status:** Accepted · **Date:** 2026-08-16

## Context

A course has a `capacity`. Approving an enrollment must never take the approved count past it. Two teachers approving the last seat at the same moment is the classic read-modify-write race, and the read-then-write shape (`SELECT count`, compare, `INSERT`) loses it every time under load.

Three candidate fixes:

1. `SERIALIZABLE` isolation with a retry loop.
2. `pg_advisory_xact_lock(courseId)` around the whole approval.
3. A conditional atomic `UPDATE` on a denormalised counter, backed by a `CHECK` constraint.

## Decision

Option 3.

```sql
UPDATE "Course"
   SET "approvedCount" = "approvedCount" + 1
 WHERE id = $1 AND "approvedCount" < capacity;
```

Zero rows affected means the course is full: the transaction rolls back and the API returns `409 CAPACITY_EXCEEDED`. The row lock the `UPDATE` takes serializes concurrent approvals on that course and nothing else.

The real guarantee is one line below, in migration `0002`:

```sql
ALTER TABLE "Course" ADD CONSTRAINT course_capacity_check
  CHECK ("approvedCount" BETWEEN 0 AND capacity);
```

The database refuses to oversell even if the application logic is wrong, which is the only version of this guarantee worth having.

## Consequences

- **Rejected `SERIALIZABLE`:** it turns a capacity conflict into a serialization failure the application must distinguish from a real error and retry. Retry loops are correct in principle and wrong in practice, and it penalises every unrelated transaction in the same connection.
- **Rejected advisory locks:** correct, but the lock lives outside the data model. Nothing in the schema tells the next reader it exists, and it is invisible to anyone writing SQL by hand.
- Accepted cost: `approvedCount` is denormalised and must be maintained inside every transaction that changes an enrollment's status. A reconciliation query in the test suite asserts it matches the real `APPROVED` count.
- `@@unique([studentId, courseId])` handles double submission separately; `P2002` maps to a friendly `409`, not a raw Prisma error.
- Proved, not claimed: an integration test fires 200 concurrent approvals at a 30-seat course and asserts exactly 30 succeed.
