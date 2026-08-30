import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    // Auth tests share one Postgres database and truncate between files; running
    // them in parallel processes would let one file's TRUNCATE delete another's rows.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    hookTimeout: 30_000,
    testTimeout: 30_000,

    /**
     * Coverage was computed and enforced against nothing. CI's `integration` job has
     * always run `--coverage`, uploaded the report as an artifact, and exited 0 at any
     * number — so the figure was a fact about the suite that no change could regress.
     *
     * The thresholds below are a MEASUREMENT, not a target. Measured 2026-08-30 against
     * Postgres, Redis and MinIO, 488 tests in 19 files, all passing:
     *
     *   statements  93.84%  (5932/6321)
     *   branches    85.03%  (1284/1510)
     *   functions   91.91%  ( 341/371 )
     *   lines       93.84%  (5932/6321)
     *
     * Statements, functions and lines are set AT the measurement: five independent
     * full runs covered the identical 5932 statements and 341 functions, so there is
     * no jitter to leave headroom for and headroom is slack a ratchet cannot use.
     *
     * BRANCHES is the exception, and it was wrong at 85.03. That number came from one
     * run; back-to-back runs on an unchanged tree produce 85.04% (1285/1511) and
     * 85.03% (1284/1510) — the DENOMINATOR moves, not just the numerator, because v8
     * only emits a branch map for code a run actually loaded. Three files drift
     * independently: enrollments.service.ts (88/92 <-> 89/93), auth.plugin.ts
     * (36/40 <-> 35/39), errors.plugin.ts (22/45 <-> 21/44). The two observed runs
     * landing a hundredth apart is arithmetic luck rather than stability — errors.
     * plugin.ts's 45th branch is UNCOVERED when it appears, so a run that keeps it
     * while enrollments.service.ts does not gain its covered 93rd yields
     * 1284/1511 = 84.97% and fails the gate on a tree nobody touched. A threshold that
     * can go red without a change is not a ratchet, it is a flake in the one job that
     * boots four containers.
     *
     * 84.5 is the floor: below every observation, above anything the +/-1 movement can
     * produce. Raise it when a change genuinely lifts the number, not to close the gap.
     *
     * Treat them as a ratchet. When a change raises a number, raise the floor to match
     * in the same commit. Never lower one to make a build pass: a red threshold means
     * the change added code the suite does not reach, which is the one thing this gate
     * exists to say out loud.
     *
     * `include` is the API's own source, deliberately. Without it v8 also measures
     * `scripts/build.mjs` — 72 lines of esbuild configuration that vitest never loads,
     * and that the `build` and `docker` CI jobs verify by running it rather than by
     * importing it. Leaving it in the denominator cost a point of statement coverage
     * for a reason that had nothing to do with how well the API is tested (92.78% vs
     * 93.84% on the same 5932 covered statements).
     *
     * `src/main.ts` stays in at 0%. It is the process entrypoint — `listen()`, signal
     * handlers — genuinely unreachable from a suite that drives the app through
     * `inject()`, and genuinely part of the product. Excluding it would buy most of a
     * point and make the number a claim about a smaller program than the one shipped.
     */
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'json-summary'],
      include: ['src/**/*.ts'],
      thresholds: {
        statements: 93.84,
        // Deliberately below the measurement — see the branch-jitter note above.
        branches: 84.5,
        functions: 91.91,
        lines: 93.84,
      },
    },
  },
});
