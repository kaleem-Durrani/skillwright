import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      /*
       * `src/**`, not `src/policy/**`.
       *
       * The narrower glob measured 1,064 lines and ignored the other 1,677 — the
       * schema package is roughly 60% of this module by size and it is the wire
       * contract: apps/api validates its responses with these Zod objects and
       * apps/web derives its types from them. Under the old include it reported
       * nothing, which is not the same as reporting zero; the first run after
       * widening it said 0% of statements, branches and functions across all
       * seventeen schema files, because no test in THIS package imported one. (The
       * API suite imports a few — `UPLOAD_LIMITS`, `BRAND`, the `Role` type — but a
       * different package’s coverage run cannot hold a threshold here, and type-only
       * imports execute nothing at all.)
       */
      include: ['src/**/*.ts'],
      thresholds: {
        /*
         * Measured, not aspirational. `pnpm --filter @skillwright/shared test --
         * --coverage` reports 100% of statements, branches, functions and lines
         * across `src/**` with the ten test files in `test/`, so these numbers
         * are the floor the suite already stands on rather than a target someone
         * has to pad towards later.
         *
         * The reason 100% is reachable here without padding is that a schema
         * module is mostly declarations — importing it executes them. The lines
         * worth counting are the callbacks: every `refine`, `superRefine`,
         * `transform` and the four exported functions in `pagination.ts` and
         * `errors.ts`. Those are what the tests actually drive, and a new
         * refinement with no test is exactly what these thresholds catch. Do not
         * read the number as proof of anything more than that.
         */
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
        /*
         * The policy layer keeps its own entry. The claim it carries — anything
         * less than total coverage means an authorization branch ships unproven —
         * predates the schema work and is a product claim, not a housekeeping
         * one, so it must not be relaxable by editing a single shared number that
         * also happens to cover seventeen DTO files.
         */
        'src/policy/**': { statements: 100, branches: 100, functions: 100, lines: 100 },
      },
    },
  },
});
