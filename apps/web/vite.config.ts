/// <reference types="vitest/config" />
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Single-origin in production: the API serves this build, so every request is a
 * same-origin relative path and the __Host- session cookie is always sent.
 * In dev we recreate that origin with a proxy instead of enabling CORS, because
 * a CORS-only dev setup hides cookie bugs until deploy day.
 */

/**
 * The proxy target is READ from the same .env the API boots with, not hard-coded.
 *
 * It said `http://localhost:3000` while the API defaults to 4000 and both .env files
 * say 4000, so every /api call from the dev server hit nothing at all. No test could
 * catch it — the integration suite calls the API directly and the SPA's own tests
 * mock the client — so it survived until someone opened a browser.
 *
 * Vite reads .env from the app directory, not the repo root, so the root file is
 * loaded explicitly here. Node does not overwrite an already-set variable, so an
 * explicit shell PORT still wins.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const rootEnv = resolve(repoRoot, '.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const API_ORIGIN = `http://localhost:${process.env.PORT ?? '4000'}`;
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: API_ORIGIN,
        changeOrigin: false,
        ws: true,
      },
      '/socket.io': {
        target: API_ORIGIN,
        ws: true,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        /*
         * Vendor chunks are chosen by PACKAGE NAME, never by substring over the
         * raw module id — that distinction is not cosmetic. pnpm encodes peer
         * dependencies in its store directory names, so the id for
         * @tanstack/react-router contains the literal text `react-dom`:
         *
         *   node_modules/.pnpm/@tanstack+react-router@1.130.2_react-dom@19.2.8_react@19.2.8/
         *     node_modules/@tanstack/react-router/dist/esm/index.js
         *
         * An `id.includes('react-dom')` test therefore classified that package
         * by its PEERS. It pulled @tanstack/react-router into vendor-react while
         * @tanstack/router-core (no react-dom peer, so no such text) stayed in
         * vendor-tanstack — one package split across two chunks that then
         * imported each other. Rollup initialised them in an order where
         * @tanstack/react-router ran before React existed, and the built SPA
         * threw "Cannot read properties of undefined (reading 'createContext')"
         * on every page while dev, tests and `vite build` all stayed green.
         * That shipped on main and was found by loading the preview build in a
         * browser, which is now what e2e/build-smoke.spec.ts does in CI.
         *
         * Matching the package name also makes the split independent of where
         * the repository is checked out: a path containing "motion" or
         * "@tanstack" no longer collapses every vendor module into one chunk.
         *
         * Each bucket below depends only on vendor-react, and React depends on
         * none of them, so the import graph between chunks cannot contain a
         * cycle. Route code is split by the concrete dynamic imports in
         * src/routes/**, not here.
         */
        manualChunks(id) {
          const marker = id.lastIndexOf('node_modules/');
          if (marker === -1) return undefined;
          const segments = id.slice(marker + 'node_modules/'.length).split('/');
          const pkg = segments[0]?.startsWith('@') ? `${segments[0]}/${segments[1]}` : segments[0];
          if (!pkg) return undefined;

          if (pkg === 'react' || pkg === 'react-dom' || pkg === 'scheduler') return 'vendor-react';
          if (pkg.startsWith('@tanstack/')) return 'vendor-tanstack';
          if (pkg === 'motion' || pkg === 'framer-motion' || pkg.startsWith('motion-'))
            return 'vendor-motion';
          if (pkg.startsWith('@radix-ui/') || pkg.startsWith('@floating-ui/'))
            return 'vendor-radix';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    /*
     * vitest's default is 5000 ms, and three CourseFormDialog tests already spend
     * 3.6-4.0 s of it driving a Radix dialog through userEvent. On a loaded CI
     * runner they cross the line and fail as "Test timed out in 5000ms" — a flake
     * that looks like a product defect and passes on re-run. Matching apps/api's
     * precedent: the timeout should bound a hang, not a slow-but-working test.
     */
    testTimeout: 20_000,
    hookTimeout: 20_000,
    setupFiles: ['./vitest.setup.ts'],
    css: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
