import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * `turbo run lint` skipped this package entirely — it declared no `lint` script — so
 * roughly 2,000 lines including the audit extension and a 1,253-line seed were linted
 * by nothing. The first run of this config found two pieces of dead code in the seed
 * (an unused `createHash` import and an unused `prngFor` handle) that four green
 * gates had been walking past, because `tsconfig.base.json` sets `strict` but not
 * `noUnusedLocals`, and `tsc` is the only thing that had ever read these files.
 *
 * Scope note: apps/web is the only workspace that runs ESLint today —
 * `@skillwright/shared` and `@skillwright/api` both alias `lint` to `tsc --noEmit`.
 * The rule set below is therefore apps/web's, minus everything React, browser and
 * Tailwind: the four house rules CONTRIBUTING lists under "things that will be sent
 * back" (`any` without justification, `console.log`, and by extension dead code),
 * expressed for a Node package.
 *
 * Dependency note: `eslint`, `@eslint/js` and `typescript-eslint` are not declared in
 * this package's devDependencies. They resolve because all three match pnpm's default
 * `public-hoist-pattern` (`*eslint*`), which links them into the workspace root's
 * node_modules. That is a real dependency edge left implicit — lesson 38's second
 * fault in miniature — and it should be made explicit. It fails loudly rather than
 * silently if the hoist ever changes (ERR_MODULE_NOT_FOUND on this file's imports),
 * which is why it is acceptable in the meantime and not acceptable indefinitely.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'prisma/migrations/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.ts'],
    languageOptions: { ecmaVersion: 2023 },
    rules: {
      // CONTRIBUTING: "`any` without a one-line comment justifying it" is sent back.
      // The audit extension casts through `unknown` to narrow interfaces it names
      // instead, which is the pattern this rule exists to keep people on.
      '@typescript-eslint/no-explicit-any': 'error',

      // The rule that earned its keep on the first run. `noUnusedLocals` is off in
      // tsconfig.base.json, so until now an import that no longer had a caller — the
      // usual residue of a refactor — survived typecheck, lint, test and review.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // CONTRIBUTING: "console.log. Use the logger." This package HAS a logger, and a
      // `writeBanner` for the seed's one human-facing line, precisely so that stdout
      // stays parseable JSON. The seed is the largest file in the repository and the
      // likeliest place for a debugging line to be left behind.
      'no-console': 'error',

      eqeqeq: ['error', 'smart'],

      // Matches apps/web. `verbatimModuleSyntax` already forbids eliding a type-only
      // import, so this is about spelling the intent at the import site rather than
      // about emit correctness.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },
);
