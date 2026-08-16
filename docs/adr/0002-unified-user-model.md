# ADR 0002 — One `User` table, role as a column

**Status:** Accepted · **Date:** 2026-08-16

## Context

The previous schema had three identity tables — `Admin`, `Teacher`, `Student` — each with its own email, its own password hash, and its own login path. The consequences were not theoretical:

- The same address could register three times, once per table, with three different passwords.
- Every relation that could point at "a person" needed nullable `teacherId` _and_ `studentId` columns. `Comment` carried four nullable columns to express one author.
- Messaging was physically unable to seat an admin, which is why the admin chat screen shipped a "Feature Under Development" placeholder.
- "Who did this?" had no single answer, so an audit log was impossible to write.

## Decision

One `User` table. `role` is a `Role` enum column. Role-specific fields live in 1:1 satellite profiles (`TeacherProfile`, `StudentProfile`) that hold only what is genuinely role-specific — qualification and department for a teacher, enrollment number for a student.

Email is `citext` and unique, so `A@b.com` and `a@b.com` cannot both exist.

## Consequences

- One login path, one password policy, one session table, one suspension mechanism.
- Every author, owner and participant relation is a single non-null `userId`. `Comment` lost four nullable columns.
- Authorization becomes expressible: `can(actor, action, subject)` takes one actor shape, which is what makes ADR 0003 possible at all.
- Changing a user's role is an `UPDATE`, not a cross-table migration.
- Accepted cost: a query for "all teachers" must filter on `role`, and the profile tables need a join. Both are indexed (`@@index([role, status])`) and neither is on a hot path.
- Accepted cost: nothing in the database prevents a `STUDENT` row from having a `TeacherProfile`. Only the service layer enforces that pairing.
