# ADR 0005 — Server-side sessions written here, not a vendor auth library

**Status:** Accepted · **Date:** 2026-08-16

## Context

An auth library — Better Auth, Lucia, Auth.js — would have delivered login, email verification, password reset and TOTP in a fraction of the time. That is a real advantage and it was seriously considered.

Three things argued against it for this project specifically:

1. **The policy layer needs an actor shape the library does not own.** `Actor` carries `status` and `provenance` (`PASSWORD` | `DEMO` | `MFA_PENDING`). `MFA_PENDING` in particular is a session that has passed a password check and may call exactly one endpoint. Expressing that inside a library's session model means fighting the library at its most opinionated point.
2. **Vendor sessions are the least interesting thing to hand a reviewer.** The subsystem this repository is _about_ is authorization. Sessions are its foundation, and delegating the foundation makes the claim hollow.
3. **Session storage is genuinely small when it is not general.** One table, four columns of real logic.

The opposing argument is honest and stands: hand-rolled auth is where projects get breached.

## Decision

Server-side opaque sessions in Postgres.

- The cookie carries 32 random bytes. Only its SHA-256 is stored, so a database dump yields no live sessions.
- Sliding expiry (`expiresAt`, refreshed on use) under a hard ceiling (`absoluteExpiresAt`, never extended).
- Revocation is a `DELETE`. Suspending a user destroys every session row in the same transaction. This is the property JWTs cannot give without inventing a denylist — which is a session table with extra steps.
- Argon2id for passwords, per current OWASP guidance. Recovery codes are hashed identically; they are password-equivalent.
- Verification codes carry a `purpose` discriminator, so an email-verification code can never be spent as a password reset.

## Consequences

- Every authenticated request costs one indexed session lookup. Redis caches it; correctness never depends on the cache.
- Every primitive here — timing-safe comparison, code expiry, attempt limits, rate limiting, replay protection — is ours to get right and ours to test.
- If this were a product with a deadline rather than a portfolio artifact, the vendor library would be the correct call. That is the tradeoff being accepted, stated plainly.
