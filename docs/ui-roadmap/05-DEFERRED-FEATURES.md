# Phase 5 — The deferred features, banked

_The advanced work that was written, deferred, and is now cheaper than when it was postponed._

**Goal:** close every deferral that serves the product's claims or deletes a documented lie — and record, in one place, the ones that stay closed.

**Method note:** much of what was remembered as deferred already shipped during the feature roadmap (the sweeper, CSV exports, the audit-forensics view, ranked search, admin CRUD, cohorts). `NEXT.md` is stale on two of these. This phase starts by updating `NEXT.md` so it stops pointing at finished work.

## The five worth building

### 1. Account reinstate — S

`POST /users/:id/reinstate` (`apps/api/src/modules/users/users.routes.ts:206` records it as "NOT BUILT, deliberately"). The suspend dialog admits the undo takes a database change; the `RESTORE`/`REINSTATE` audit actions are already computed by the extension and can never be written. Costs: one `user:reinstate` action, matrix rows including denials, regenerated `docs/permissions.md`, a route mirroring the suspend gate, and the dialog copy flipped from its apology to a real button. The cheapest possible demonstration of the policy machinery, and it makes the `ACCOUNT_SUSPENDED` notification (deliberately unwired in Phase 1) finally worth wiring — one line, as the plan predicted.

### 2. Notification enum debts — S each

Withdrawal, `COURSE_PUBLISHED`, and top-level-comment notifications (`apps/api/src/modules/enrollments/enrollments.service.ts:724`, `comments.service.ts:397`, `docs/roadmap/00-FEATURE-PLAN.md:111`). Each is one enum member + migration + one `notify()` call against the finished single-writer. `COURSE_PUBLISHED` matters most: Phase 2 made publish reachable and it has been silent since. Withdrawal closes the comment at `enrollments.service.ts:447-449` that promised a verb the schema never had.

### 3. MFA enrolment UI — S–M

`Settings.tsx:509` carries `TODO(mfa-ui)`: the enrol call succeeds and **discards** the `qrDataUrl`/`secret` it receives. The backend is fully proven (TOTP enrol/activate/verify/disable, AES-256-GCM at rest, gated-login test). One screen — QR + secret + confirmation code — completes a security story every reviewer probes, and deletes a stub that currently pretends to work.

### 4. Presigned-PUT immutability — M

`NEXT.md:48`: after `commit`, the presigned URL stays valid, so a re-PUT can silently replace a committed object's bytes (TOCTOU). Zero ETag handling exists in `apps/api/src`. The honest fix per `NEXT.md`'s own note is a `HeadObject` conditional on download or a copy-to-final-key at commit; either way, write the test that reproduces the replacement first. This is the kind of measured correctness the repository sells — a real integrity hole with a citation.

### 5. Upload progress — S

`fetch` exposes no upload-progress event (`NEXT.md:46`); the PUT in `apps/web/src/lib/uploads.ts:187` moves to XHR for `upload.onprogress`. Single-module change, visible in every demo, no claim served — pure polish, and fine for exactly that reason.

## Recorded, not built

- **Realtime chat depth** (B+1, ~70 h: sequence numbers, backfill, idempotent send, presence) — `docs/rebuild/00-REBUILD-PLAN.md:758-781`. The socket.io/redis deps remain installed and dead. Highest demo value, highest cost, and it would add a fourth signature claim. **Owner's explicit call; not smuggled into any phase.**
- **Per-type notification preferences** — stays deferred until events prove noisy; the fake tab was removed, not replaced (`docs/PROGRESS.md`).
- **Email digests** — mailer + notifications both exist, so it is cheap; but it is a new surface, not a screen, and waits for a real user base.
- **DiceBear summary faces** — cosmetic; the five-module loader sweep is not worth it while detail paths show real avatars.
- **Bell `role="none"` → Popover, `CursorPage<T>` hand-declared shape, login double-audit row** — small a11y/hygiene debts; batch them into whatever phase next touches those files.
- **Permanently cut, do not resurrect:** grading, certificates, fourth role, AI, scheduling, equipment inventory, analytics dashboards, ⌘K palette, marketing page, i18n (`docs/rebuild/00-REBUILD-PLAN.md:820-830`).

## Tasks

1. Update `NEXT.md` against reality (remove finished items, repoint to this plan).
2. Ship the five features in the order above, each with its tests, matrix cells/permissions regeneration where policy changes, and the corresponding lie deleted from the UI (reinstate dialog, MFA TODO, `NEXT.md` notes).
3. One commit per feature; `docs/PROGRESS.md` entry per landing.

**Est.** 10–14 h total. **Depends on:** nothing — runs parallel with any phase.
