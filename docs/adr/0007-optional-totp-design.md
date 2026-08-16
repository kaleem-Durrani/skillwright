# ADR 0007 — Optional TOTP, with enrolment as a three-step commit

**Status:** Accepted · **Date:** 2026-08-16

## Context

Two-factor authentication is easy to add badly. The common mistakes are all the same mistake — treating enrolment as a write rather than a handshake:

- Storing the shared secret in plaintext, so a database leak is a full second-factor bypass.
- Enabling TOTP the moment the secret is generated, before the user has proved their authenticator produces matching codes. The user is then locked out by a feature they just enabled.
- No recovery path, so a lost phone becomes a support ticket the system cannot answer.
- No replay protection, so a code shoulder-surfed inside its 30-second window is reusable.

## Decision

Optional per user, RFC 6238, `otpauth` for generation and verification.

**Enrolment is a three-step commit.** Generate secret → user scans the QR → **the user must submit one valid code before the secret is activated**. `totpSecret` being non-null does not mean enabled; `totpEnabledAt` does. A secret is never activated without proof that the authenticator works.

**The secret is encrypted at rest** with AES-256-GCM under `ENCRYPTION_KEY`. It is never returned by any endpoint, at any time, to anyone.

**Ten single-use recovery codes** are generated at enrolment and shown exactly once. They are stored as Argon2id hashes, because they are password-equivalent credentials.

**Login becomes two-stage.** A correct password with TOTP enabled issues a five-minute session with `provenance = MFA_PENDING`. The policy denies that actor every action except `mfa:verify` — the matrix proves it, per-action, in `docs/permissions.md`. Success replaces the session with a `PASSWORD` one.

**Replay protection:** the highest accepted TOTP counter is stored per user, so a code cannot be spent twice inside its own window. ±1 step of clock skew is tolerated. Five failed attempts locks the account out.

**Disabling requires the current password _and_ a valid code.** A stolen live session cannot remove the second factor.

## Consequences

- `ENCRYPTION_KEY` becomes an operational secret: lose it and every enrolled user must re-enrol from a recovery code.
- The `MFA_PENDING` state adds an actor dimension to every policy rule — which is precisely the kind of invariant the matrix exists to prove, so the cost buys evidence.
- Recovery codes are shown once. If the user does not save them, the account is recoverable only by an admin reset. That is the correct tradeoff and it is stated in the UI.
