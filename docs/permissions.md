<!-- GENERATED FILE — DO NOT EDIT BY HAND.
     Produced by scripts/generate-permissions-doc.ts from @skillwright/shared/policy.
     Regenerate with `pnpm docs:permissions`. CI runs it with --check and fails
     the build when this file and the policy disagree. -->

# Permission matrix

Every cell below comes from the policy module in `packages/shared/src/policy`. The
role matrix is read directly out of `POLICY`; the state matrix is produced by
calling `can()`. Nothing here was written by hand, which is why it cannot
disagree with the code — and if it ever did, the `permissions-doc` job in CI
would fail before the change could merge.

- **44** actions, derived from the policy object's own keys
- **176** cells in the role matrix
- **220** cells in the state matrix
- Asserted independently in `packages/shared/test/policy-matrix.test.ts`

## Reading a cell

| Cell | Meaning |
| --- | --- |
| `✓ allow` | Permitted unconditionally for that caller class. |
| `✗ deny` | Refused unconditionally. |
| `ruleName` | Permitted only when that named rule holds for the subject. |
| `✗ rule` | In the state matrix: refused, and the rule that refused. |

Rule names are the identifiers exported from `policy/combinators.ts`. A composed
rule reports its composition — `or(isPublic, enrolledApproved)` — so the table
says what the code says, in the code's own words.

## Role matrix

The subject is whatever the caller loaded. `allow` needs nothing; every other
rule reads named fields off `Subject` and denies when they are absent.

| Action | Anonymous | Student | Teacher | Admin |
| --- | --- | --- | --- | --- |
| `announcement:create` | ✗ deny | ✗ deny | ✓ allow | ✓ allow |
| `announcement:delete` | ✗ deny | ✗ deny | `isAuthor` | ✓ allow |
| `announcement:publish` | ✗ deny | ✗ deny | `isAuthor` | ✓ allow |
| `announcement:read` | `isPublished` | `isPublished` | `or(isPublished, isAuthor)` | ✓ allow |
| `announcement:update` | ✗ deny | ✗ deny | `isAuthor` | ✓ allow |
| `audit:read` | ✗ deny | ✗ deny | ✗ deny | ✓ allow |
| `comment:create` | ✗ deny | ✓ allow | ✓ allow | ✓ allow |
| `comment:delete` | ✗ deny | `isAuthor` | `or(isAuthor, ownsCourse)` | ✓ allow |
| `comment:read` | ✗ deny | ✓ allow | ✓ allow | ✓ allow |
| `comment:update` | ✗ deny | `isAuthor` | `isAuthor` | `isAuthor` |
| `conversation:create` | ✗ deny | ✓ allow | ✓ allow | ✓ allow |
| `conversation:join` | ✗ deny | ✗ deny | ✗ deny | ✓ allow |
| `conversation:read` | ✗ deny | `isParticipant` | `isParticipant` | `isParticipant` |
| `conversation:send` | ✗ deny | `isParticipant` | `isParticipant` | `isParticipant` |
| `course:create` | ✗ deny | ✗ deny | ✓ allow | ✓ allow |
| `course:delete` | ✗ deny | ✗ deny | `ownsCourse` | ✓ allow |
| `course:publish` | ✗ deny | ✗ deny | `ownsCourse` | ✓ allow |
| `course:read` | `isPublished` | `or(isPublished, enrolledApproved)` | `or(isPublished, ownsCourse)` | ✓ allow |
| `course:update` | ✗ deny | ✗ deny | `ownsCourse` | ✓ allow |
| `department:create` | ✗ deny | ✗ deny | ✗ deny | ✓ allow |
| `department:delete` | ✗ deny | ✗ deny | ✗ deny | ✓ allow |
| `department:read` | ✗ deny | ✓ allow | ✓ allow | ✓ allow |
| `department:update` | ✗ deny | ✗ deny | ✗ deny | ✓ allow |
| `enrollment:approve` | ✗ deny | ✗ deny | `ownsCourse` | ✓ allow |
| `enrollment:read` | ✗ deny | `isEnrolledStudent` | `ownsCourse` | ✓ allow |
| `enrollment:reject` | ✗ deny | ✗ deny | `ownsCourse` | ✓ allow |
| `enrollment:request` | ✗ deny | `isPublished` | ✗ deny | ✓ allow |
| `enrollment:withdraw` | ✗ deny | `isEnrolledStudent` | ✗ deny | ✓ allow |
| `mfa:disable` | ✗ deny | ✓ allow | ✓ allow | ✓ allow |
| `mfa:enroll` | ✗ deny | ✓ allow | ✓ allow | ✓ allow |
| `mfa:verify` | ✗ deny | ✓ allow | ✓ allow | ✓ allow |
| `notification:read` | ✗ deny | `isSelf` | `isSelf` | `isSelf` |
| `notification:update` | ✗ deny | `isSelf` | `isSelf` | `isSelf` |
| `resource:create` | ✗ deny | ✗ deny | `ownsCourse` | ✓ allow |
| `resource:delete` | ✗ deny | ✗ deny | `ownsCourse` | ✓ allow |
| `resource:download` | ✗ deny | `or(isPublic, enrolledApproved)` | `or(isPublic, ownsCourse, isAuthor)` | ✓ allow |
| `resource:read` | `isPublic` | `or(isPublic, enrolledApproved)` | `or(isPublic, ownsCourse, isAuthor)` | ✓ allow |
| `resource:update` | ✗ deny | ✗ deny | `ownsCourse` | ✓ allow |
| `upload:commit` | ✗ deny | `isSelf` | `isSelf` | `isSelf` |
| `upload:presign` | ✗ deny | ✓ allow | ✓ allow | ✓ allow |
| `user:list` | ✗ deny | ✗ deny | ✗ deny | ✓ allow |
| `user:read` | ✗ deny | `isSelf` | `isSelf` | ✓ allow |
| `user:suspend` | ✗ deny | ✗ deny | ✗ deny | `not(isSelf)` |
| `user:update` | ✗ deny | `isSelf` | `isSelf` | ✓ allow |

## Account status and session provenance

Status and provenance are checked in `can()` **before** any role rule runs, so no
permissive role rule can be reached by a caller who should not be there.

Every column below is the same `TEACHER` actor, evaluated against a subject that
satisfies every positive rule at once — it is owned, authored, enrolled and
published. Any `✗` in this table is therefore caused by the actor's state
alone, never by the subject.

Three invariants are visible in it, and each is what the column is for:

1. **`SUSPENDED` denies everything.** No exceptions, including `mfa:verify`.
2. **`PENDING_VERIFICATION` denies everything except `mfa:verify`.** An
   unverified account can finish authenticating and nothing else.
3. **`MFA_PENDING` denies everything except `mfa:verify`.** A session that has
   passed a password check but not a second factor can only complete its login.

The `DEMO` column shows the read-everything / destroy-nothing shape of the public
demo: reads and ordinary mutations pass, deletions and suspensions do not.

| Action | `ACTIVE / PASSWORD` | `PENDING_VERIFICATION` | `SUSPENDED` | `MFA_PENDING` | `DEMO` |
| --- | --- | --- | --- | --- | --- |
| `announcement:create` | ✓ | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✓ |
| `announcement:delete` | ✓ | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✗ `provenance:DEMO` |
| `announcement:publish` | ✓ | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✓ |
| `announcement:read` | ✓ | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✓ |
| `announcement:update` | ✓ | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✓ |
| `audit:read` | ✗ `TEACHER:deny` | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✗ `TEACHER:deny` |
| `comment:create` | ✓ | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✓ |
| `comment:delete` | ✓ | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✗ `provenance:DEMO` |
| `comment:read` | ✓ | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✓ |
| `comment:update` | ✓ | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✓ |
| `conversation:create` | ✓ | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✓ |
| `conversation:join` | ✗ `TEACHER:deny` | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✗ `TEACHER:deny` |
| `conversation:read` | ✓ | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✓ |
| `conversation:send` | ✓ | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✓ |
| `course:create` | ✓ | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✓ |
| `course:delete` | ✓ | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✗ `provenance:DEMO` |
| `course:publish` | ✓ | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✓ |
| `course:read` | ✓ | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✓ |
| `course:update` | ✓ | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✓ |
| `department:create` | ✗ `TEACHER:deny` | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✗ `TEACHER:deny` |
| `department:delete` | ✗ `TEACHER:deny` | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✗ `provenance:DEMO` |
| `department:read` | ✓ | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✓ |
| `department:update` | ✗ `TEACHER:deny` | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✗ `TEACHER:deny` |
| `enrollment:approve` | ✓ | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✓ |
| `enrollment:read` | ✓ | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✓ |
| `enrollment:reject` | ✓ | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✓ |
| `enrollment:request` | ✗ `TEACHER:deny` | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✗ `TEACHER:deny` |
| `enrollment:withdraw` | ✗ `TEACHER:deny` | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✗ `TEACHER:deny` |
| `mfa:disable` | ✓ | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✓ |
| `mfa:enroll` | ✓ | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✓ |
| `mfa:verify` | ✓ | ✓ | ✗ `status:SUSPENDED` | ✓ | ✓ |
| `notification:read` | ✓ | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✓ |
| `notification:update` | ✓ | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✓ |
| `resource:create` | ✓ | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✓ |
| `resource:delete` | ✓ | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✗ `provenance:DEMO` |
| `resource:download` | ✓ | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✓ |
| `resource:read` | ✓ | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✓ |
| `resource:update` | ✓ | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✓ |
| `upload:commit` | ✓ | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✓ |
| `upload:presign` | ✓ | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✓ |
| `user:list` | ✗ `TEACHER:deny` | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✗ `TEACHER:deny` |
| `user:read` | ✓ | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✓ |
| `user:suspend` | ✗ `TEACHER:deny` | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✗ `provenance:DEMO` |
| `user:update` | ✓ | ✗ `status:PENDING_VERIFICATION` | ✗ `status:SUSPENDED` | ✗ `provenance:MFA_PENDING` | ✓ |
