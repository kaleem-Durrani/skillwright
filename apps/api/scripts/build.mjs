// Bundles src/main.ts into a single, runnable dist/main.js.
//
// @skillwright/shared and @skillwright/db publish TypeScript SOURCE through their
// exports maps (see the comment on `noEmit` in tsconfig.json) — there is no compiled
// artifact for `node dist/main.js` to import, so `tsc` alone can never produce a
// runnable image. A bundler solves this by pulling that source in directly, which is
// why the two workspace packages are the only things NOT marked external below: every
// real npm dependency already exists, built, in node_modules, so re-bundling it would
// just duplicate work the runtime image does for free.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(apiRoot, 'package.json'), 'utf8'));

const BUNDLED_WORKSPACE_PACKAGES = new Set(['@skillwright/shared', '@skillwright/db']);

const external = [
  // Every declared runtime dependency stays external, except the two workspace
  // packages bundled by design (above). @prisma/client is one of these — it is a
  // DIRECT dependency of @skillwright/api's own package.json even though nothing
  // under apps/api/src imports it by name (only the bundled @skillwright/db
  // source does). It has to be declared here anyway, and not just left as
  // @skillwright/db's transitive dependency: pnpm's isolated node_modules only
  // links a package's OWN declared dependencies at that package's own top level,
  // and dist/main.js — unlike @skillwright/db's source — lives at @skillwright/api's
  // top level, not inside @skillwright/db's directory, so it needs @prisma/client
  // resolvable from THERE. Being external is also a hard requirement regardless:
  // the generated Prisma client loads its native query-engine binary by a
  // relative filesystem path at require-time, and a bundler rewriting that path
  // (or inlining the loader code that computes it) breaks the lookup.
  ...Object.keys(pkg.dependencies ?? {}).filter((name) => !BUNDLED_WORKSPACE_PACKAGES.has(name)),
  // The generated client itself, resolved by @prisma/client's own internals —
  // same must-stay-external reason as above. Unlike @prisma/client this is never
  // a package.json dependency key (nothing ever depends on it by name), so it has
  // to be added by hand rather than falling out of the loop above.
  '.prisma/client',
];

await build({
  entryPoints: [resolve(apiRoot, 'src/main.ts')],
  outfile: resolve(apiRoot, 'dist/main.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external,
  logLevel: 'info',
  banner: {
    // esbuild's ESM output does not define `require`, `__dirname` or `__filename` —
    // those are CommonJS globals, and this bundle is not CommonJS. Bundling only
    // pulls in @skillwright/shared and @skillwright/db source today, and neither
    // uses them, but a bundler's whole job is to fold in whatever those packages
    // import next, and any ordinary CJS-authored dependency that lands in the
    // bundle later (rather than staying external) will very likely reference one
    // of the three and crash with `ReferenceError` at import time. Reconstructing
    // all three from `import.meta.url` — the same thing a native Node ESM entry
    // point does for itself — up front, once, in the banner is what a real Node
    // ESM module does anyway, so every bundled module can rely on them existing.
    js: [
      "import { createRequire as __skillwrightCreateRequire } from 'node:module';",
      "import { fileURLToPath as __skillwrightFileURLToPath } from 'node:url';",
      "import { dirname as __skillwrightDirname } from 'node:path';",
      'const require = __skillwrightCreateRequire(import.meta.url);',
      'const __filename = __skillwrightFileURLToPath(import.meta.url);',
      'const __dirname = __skillwrightDirname(__filename);',
    ].join('\n'),
  },
});
