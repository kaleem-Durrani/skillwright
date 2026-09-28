# Deferred

Open questions that are **blocked, undecidable, or deliberately not now** — each with what it
is, why it is not being done, and what would unblock it.

This file exists because the alternative was letting these live in a commit message or a
conversation. `docs/PROGRESS.md` records what _happened_; this records what was deliberately
_not_ finished and left a note explaining why, so nobody rediscovers the cost by accident.

An entry leaves this file when it is done, or when it stops being true. An entry that has
been here for two release cycles without movement is a decision nobody made.

---

## D1 — The object store has no image left to run

**Status:** blocked on upstream · **Raised:** 2026-09-28

`minio/minio` and `minio/mc` have been **deleted from Docker Hub**, and MinIO's own binary
distribution now returns `410 Gone`. Verified, not inferred:

| Thing                                                  | Result                                                |
| ------------------------------------------------------ | ----------------------------------------------------- |
| `hub.docker.com/v2/repositories/minio/minio/`          | `{"message":"object not found"}`                      |
| `hub.docker.com/v2/repositories/minio/mc/`             | not found                                             |
| `bitnami/minio`                                        | repository exists, **0 tags**                         |
| `bitnami/mc`, `garagehq/garage`, `seaweedfs/seaweedfs` | not found                                             |
| `quay.io/minio/minio`                                  | unauthorized                                          |
| `dl.min.io/server/minio/release/linux-amd64/minio`     | **HTTP 410**                                          |
| `rustfs/rustfs`                                        | exists, 12.2M pulls — **pulled and run successfully** |

**What it blocks.** The `integration tests` job in CI (`ci.yml`, the "Start MinIO" step) fails
with `pull access denied … repository does not exist` and exit 125. It also blocks
`docker-compose.yml:42-70`, so **`pnpm infra:up` fails for anyone cloning today** — the local
stack in this repo has been running only because its container was pulled 9 days ago and is
still in the Docker cache. A green local stack right now is a cache artefact, not a working
configuration.

**Why it is deferred rather than fixed.** Swapping the object store is an architectural
change, not a config edit, and this repository makes security claims about the store
_itself_:

- Golden path 3 asserts the raw unsigned object URL answers **403** — "the only assertion in
  this repository that proves the bucket refuses an unauthorised read rather than the policy
  layer refusing on its behalf."
- `uploads.test.ts` asserts a PUT whose `Content-Type` does not match the signature is
  rejected with **`SignatureDoesNotMatch`**, which is a claim about MinIO's SigV4
  implementation specifically.

`rustfs/rustfs` is S3-compatible and starts cleanly, but compatibility at the API surface is
not compatibility at the signature-verification layer. Adopting it without proving those two
behaviours would trade a loud outage for a silent one.

**What would unblock it.** Pick a replacement, then prove the two claims above against it
before anything else is changed:

1. `rustfs/rustfs` — most active, but the least like MinIO in the ways that matter here.
2. A self-built MinIO from a pinned binary — needs a reachable binary; `dl.min.io` is gone.
3. `adobe/s3mock` or `localstack` — real enough for signing, but a mock. Would weaken
   golden path 3 to a policy-layer assertion, which is the thing it was written to stop being.

**Owner decision required.** This is a product decision about what this project asserts about
its own infrastructure, not a maintenance chore.

**Update 2026-09-28.** Phase 3 made the stakes concrete rather than theoretical. The
certificate generator stores its PDF through the existing presign -> staging -> commit
path, so a certificate is an `Upload` exactly like a syllabus — and the audit trail for a
qualification now runs through the same `assertUploadClaimable` the audit extension
depends on. Whatever store is chosen has to satisfy two properties the repository already
asserts about the current one, and both are now covered by tests rather than by comment.

---

## D2 — The full `ci.yml` produces a workflow with zero jobs

**Status:** blocked, cause unknown · **Raised:** 2026-09-28

`main` currently runs a **reduced** `ci.yml`: the version that was known to produce jobs, with
one fix applied (see below). The richer workflow that came out of the 38-commit branch is
**not on `main`**. It makes GitHub create a run that completes immediately with **zero jobs**.

**What is established:**

| Test                                                                         | Result            |
| ---------------------------------------------------------------------------- | ----------------- |
| Old `ci.yml` on `main`                                                       | 12 jobs, runs     |
| New `ci.yml`, e2e jobs present                                               | 0 jobs, `failure` |
| New `ci.yml`, e2e jobs removed                                               | 0 jobs, `failure` |
| Both files vs. GitHub's published workflow JSON Schema                       | **both VALID**    |
| Duplicate keys, duplicate job ids, `needs` resolution, tabs, BOM, CRLF, size | all clean         |

So it is not a YAML syntax error, not a schema violation, and not the two `e2e` jobs. The
remaining delta is: the added `pnpm typecheck:scripts` step, the added web/db steps in the
`unit` job, and the rewritten `ci` gate.

**Why it is deferred.** A schema-valid file that a runner refuses to schedule is the one class
of CI failure that a local dry-run provably cannot catch, and PROGRESS.md's own lesson 38 says
an artefact nobody has run is a guess. Guessing between three candidates by pushing each to
`main` costs a run per attempt and risks landing a workflow that is green by accident.

**What would unblock it.** One of:

1. `gh run view <id> --log` on a zero-job run — the validation error is on the run page, not
   in the API. This is the cheap answer and needs only authentication.
2. Re-adding the three candidate changes **one at a time** to the reduced file, so each is
   isolated by a run that either schedules or does not.

**Update 2026-09-28.** The three candidates are now narrowed to ONE. Two are ruled out by
construction: the e2e jobs (removed from the file, still 0 jobs) and the added `unit`-job
steps and `typecheck:scripts` (the reduced file has neither and schedules fine). What
remains is **the rewritten `ci` gate**, which is the only candidate that changes how
GitHub evaluates the workflow. It is also the most likely to be the cause for a reason
nobody had considered: the gate's step body interpolates
`${{ join(needs.*.result, " ") }}` with a **double-quoted** string inside a YAML block
scalar, where the version that scheduled used single quotes. That is the single
structural difference left, and it is one line to test.

---

## D3 — GitHub Actions are running on a deprecated Node 20

**Status:** open, cosmetic · **Raised:** 2026-09-28

Every job emits: _"Node.js 20 is deprecated. The following actions target Node.js 20 but are
being forced to run on Node.js 24: `actions/checkout@v4`, `actions/setup-node@v4`,
`actions/upload-artifact@v4`, `pnpm/action-setup@v4`, `docker/build-push-action@v6`,
`docker/setup-buildx-action@v3`."_

**Why it is deferred.** These are warnings, not failures — all jobs pass. They are also
exactly what Dependabot's existing `actions` group is configured to propose, so the fix is
already scheduled and needs no decision. Do not hand-bump them.

**Also flagged, same class:** `ubuntu-latest` migrates to Ubuntu 26 on 2026-10-19. Worth
pinning to `ubuntu-24.04` before that date rather than discovering it as a surprise.

---

## D4 — The `ci` gate is running the old, weaker logic

**Status:** open, known-weak · **Raised:** 2026-09-28

`main`'s gate is still the pre-fix version that greps for `failure|cancelled` in the job
results. It has the documented defect PROGRESS.md records: a `skipped` job is not matched, so
ten jobs that never executed can be certified as success.

It is currently correct **by luck** — the one real failure happened to be a `failure`. It is
kept on `main` only because it is in the file that GitHub agrees to schedule (D2).

**What would unblock it.** Fold the fixed gate into the D2 bisect as a single isolated change.
It is the most likely of the three candidates, because it is the only one that changes how
GitHub evaluates the workflow.

---

## D5 — RESOLVED 2026-09-28: `format:check` now covers YAML

The glob was `**/*.{ts,tsx,js,json,md,css}` — no `yml` — so `.github/workflows/*.yml`,
`docker-compose.yml`, `.github/dependabot.yml` and `pnpm-workspace.yaml` had never been
format-checked by a gate that looks like it covers the repository. `yml` and `yaml` are in
both scripts now, and four files that were already non-canonical have been rewritten.

Kept as a one-line entry rather than deleted, because the reason it was not done first
is the reason it is worth remembering: it was deliberately not bundled with D2's bisect,
since changing what `format:check` says about a file the bisect is editing makes the
bisect harder to read. Sequencing a one-line fix away from a diagnostic is sometimes the
right call and sometimes cowardice; this one was cheap enough to do immediately after.

---

## D6 — The audit retention window is unset, on purpose

**Status:** open, needs a policy decision · **Raised:** 2026-09-28

Phase 7 shipped the MECHANISM and deliberately did not ship the NUMBER.
`AUDIT_RETENTION_DAYS` has no default; the pruner deletes nothing while it is unset and
the API logs that on every boot, so the fact is visible rather than buried in a config
default.

**The trade-off, stated plainly: the `AuditEvent` table grows without bound until someone
decides.** That is the correct default for a compliance record — silently deleting an
audit row because nobody configured a number is the failure mode nobody can undo — but it
is still a decision being deferred, and a real deployment will hit it.

**What would unblock it.** A number, from whoever owns data retention: how long an
audit trail must survive for this school, and whether an expunged row should be deleted
or tombstoned. Note that Phase 8 made `AuditEvent` genuinely append-only with a trigger,
so "prune" is now a privileged act rather than a side effect, and the pruner declares
itself (`skillwright.audit_prune`) so the act is distinguishable in its own log.

**Not decided, and worth deciding with it:** whether a `Notification` deserves the same
treatment. Nothing sweeps notifications either.
