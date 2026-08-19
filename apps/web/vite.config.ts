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
        // Keep the router/query runtime out of every route chunk. Route code is
        // split by the concrete dynamic imports in src/routes/**, not here.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('react-dom') || id.includes('/react/')) return 'vendor-react';
          if (id.includes('@tanstack')) return 'vendor-tanstack';
          if (id.includes('motion')) return 'vendor-motion';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    css: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
