# ADR 0001 — History rewritten in place, not a fresh repository

**Status:** Accepted · **Date:** 2026-08-16

## Context

`node_modules/` had been tracked since the first commit: 1,509 files inside `HEAD`, a 17 MB `.git`, and a GitHub file listing that opened with a dependency directory. Removing it required `git filter-repo`, which rewrites every commit hash regardless.

Because the SHAs are destroyed either way, an earlier revision of the plan concluded that a fresh repository was strictly better — same loss, cleaner start.

That conclusion does not follow. `filter-repo` destroys the hashes but preserves the commit _messages_, the authorship, and the dates. Those are the parts a reader actually looks at. A fresh repository throws them away too, and splits the author's public presence across two URLs for no gain.

## Decision

Rewrite history in place with `git filter-repo --invert-paths --path node_modules/`, keep one repository, and push with `--force-with-lease`.

Results: 1,814 tracked files → 305. 17 MB `.git` → 1.7 MB. 132 commits → 132 commits, all re-hashed. A backup bundle of every pre-rewrite ref was taken first.

## Consequences

- Every existing clone is invalidated. With one contributor, that cost is zero; it would not be acceptable on a shared repository.
- Old commit SHAs referenced anywhere — issues, notes, external links — are dead. None existed.
- The early commit messages are honest about what the project was. That is a feature: the repository shows a rebuild rather than claiming to have been born finished.
- The legacy `backend/` and `frontend/` trees remain tracked until the rebuild replaces them. `scripts/check-brand.ts` excludes them explicitly and reports the count, so the exclusion is visible rather than quiet.
