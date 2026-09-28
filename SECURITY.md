# Security policy

## Supported versions

| Version       | Supported |
| ------------- | --------- |
| `main`        | Yes       |
| Anything else | No        |

This is a single-branch project. Fixes land on `main`; there are no backports.

## Reporting a vulnerability

Report privately. Do not open a public issue.

- **Preferred:** GitHub → **Security** → **Report a vulnerability** (private advisory).
- **Alternative:** `hello@skillwright.dev`, subject line beginning `SECURITY:`.

Please include the affected endpoint or module, a reproduction, the impact you believe it has, and the commit SHA you tested.

**Response targets:** acknowledgement within 72 hours, an assessment within 7 days, and a fix or a stated timeline within 30 days for anything rated high or critical. You will be credited in the advisory unless you ask not to be.

Please do not run automated scanners against a shared deployment, do not access or modify data belonging to anyone else, and do not test denial of service. Report and stop.

## Scope

**In scope:** authentication and session handling, the authorization policy (`packages/shared/src/policy`), the presigned-upload flow and object-store access control, input validation, the audit log, and the CI workflows in this repository.

**Out of scope:** anything in `backend/` or `frontend/`. Those are the legacy trees, pending deletion, never deployed, and known to contain defects — including an unauthenticated administrator-creation endpoint. They are retained only so the rebuild diff is readable.

Also out of scope: findings against third-party services, missing hardening headers with no demonstrated impact, and reports produced entirely by a scanner with no analysis attached.

## What this project already does

Stated so a reviewer can check rather than assume.

- **Sessions** are server-side and opaque. The cookie carries 32 random bytes; only the SHA-256 is stored, so a database dump yields no live sessions. Revocation is a `DELETE`. Suspension destroys every session for that user in the same transaction. (ADR 0005)
- **Cookies** use the `__Host-` prefix with `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`. A subdomain cannot plant one. (ADR 0004)
- **CSRF** is defended explicitly. Every state-changing route rejects a request whose `Origin` is absent or not allow-listed, and `SameSite=Lax` is treated as defence in depth rather than as the defence. (ADR 0004)
- **Passwords and recovery codes** are Argon2id. TOTP secrets are AES-256-GCM encrypted at rest and are never returned by any endpoint. (ADR 0007)
- **Authorization** goes through one pure `can()` function, with the full role × action matrix asserted in CI and `docs/permissions.md` generated from the policy itself. (ADR 0003)
- **Uploads** are private. Objects are served only through short-lived presigned URLs issued after a policy check; the bucket has no anonymous access.
- **The audit log** is append-only, and this is enforced by Postgres rather than by convention. A trigger (migration `0012`) refuses `UPDATE`, `DELETE` and `TRUNCATE` on that table. It is role-independent, so it binds the application role, the table's owner and any role created later, rather than relying on a privilege grant. The previous version of this line claimed `UPDATE` and `DELETE` were revoked from the application role in migration `0002`; that `REVOKE` was commented out, and it would not have worked in any case — the API connects as the table's owner, and as a superuser, so a revoked privilege has nothing to take away. What the guarantee does **not** survive is a deliberate `ALTER TABLE ... DISABLE TRIGGER` or a `DROP`, both of which require table ownership. The single documented exception is the retention pruner, which may delete a row only inside a transaction that has explicitly set `skillwright.audit_prune`; see the audit retention note below.
- **Secrets** are validated at boot by a Zod-parsed environment schema. The process refuses to start with a missing or malformed secret rather than failing later at the first request.
- **Expired credentials are reclaimed on a timer.** Sessions, verification codes and spent recovery codes are swept by a retention job (migration-independent; `packages/db/src/retention/sweepers.ts`). Each sweep selects only rows the database has already declared worthless — a lapsed clock, a passed expiry, a spent code — and age alone never selects one. An unused recovery code is a live credential and is never swept at any age.

## What is deliberately not decided yet

Stated here rather than left to be discovered, because a security property that is assumed to exist and does not is worse than one that is known to be missing.

- **The audit retention window is UNSET, and audit events are therefore kept forever.** `AUDIT_RETENTION_DAYS` has no default. How long a school must keep an audit record is a question about the school's obligations, not about this database, so this repository does not answer it, and it will not answer it with a default value: a default of 365 would read as a decision, live in a file nobody reads, and quietly delete compliance evidence on a schedule nobody chose. The pruner exists and is tested; with the variable unset it deletes nothing, and the API logs that on every boot. An operator with a real obligation sets the variable; one without loses nothing. The trade-off to be aware of: **the audit table grows without bound until somebody decides this.**
- **Backup and restore are absent.** There is no `pg_dump`/`pg_restore` procedure, rehearsed or otherwise. A retention policy is only meaningful if the data it governs can be recovered, so this gap is upstream of the one above.
