import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/policy/**/*.ts'],
      // The policy layer is the product claim; anything less than total coverage
      // of it means an authorization branch ships unproven.
      thresholds: { statements: 100, branches: 95, functions: 100, lines: 100 },
    },
  },
});
