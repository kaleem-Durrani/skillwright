import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

/**
 * Two things this config enforces that a default React setup does not:
 *
 *   1. jsx-a11y at ERROR. Not "warn". A warning in a 400-file project is a
 *      permanent backlog item; an error is a thing you fix before you commit.
 *   2. The mobile-first rules, as lint rules. `max-width` media queries,
 *      `max-*` Tailwind variants, `100vw` and `vh` units are syntax errors here,
 *      because "we agreed to be mobile-first" is not enforceable and this is.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'playwright-report/**', 'test-results/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  jsxA11y.flatConfigs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.browser, ...globals.es2021 },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // --- a11y: the ones that actually break a screen reader ---
      'jsx-a11y/alt-text': 'error',
      'jsx-a11y/anchor-has-content': 'error',
      'jsx-a11y/anchor-is-valid': 'error',
      'jsx-a11y/aria-props': 'error',
      'jsx-a11y/aria-role': 'error',
      'jsx-a11y/click-events-have-key-events': 'error',
      'jsx-a11y/control-has-associated-label': 'error',
      'jsx-a11y/heading-has-content': 'error',
      'jsx-a11y/interactive-supports-focus': 'error',
      // `controlComponents` teaches the rule about the design system's wrappers.
      // Without it a correctly nested `<label><Textarea/></label>` is reported,
      // because the rule only recognises bare `input`/`select`/`textarea` tags —
      // which would push people towards silencing it file by file.
      'jsx-a11y/label-has-associated-control': [
        'error',
        {
          controlComponents: ['Input', 'Textarea', 'Select', 'Checkbox', 'OtpInput'],
        },
      ],
      'jsx-a11y/no-autofocus': 'off', // an OTP field SHOULD autofocus; that is the flow
      'jsx-a11y/no-noninteractive-element-interactions': 'error',
      'jsx-a11y/no-redundant-roles': 'error',
      'jsx-a11y/no-static-element-interactions': 'error',
      'jsx-a11y/role-has-required-aria-props': 'error',
      'jsx-a11y/tabindex-no-positive': 'error',

      // --- TypeScript ---
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // --- house rules ---
      'no-console': 'error',
      eqeqeq: ['error', 'smart'],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/max-(sm|md|lg|xl|2xl):/]',
          message:
            'max-* breakpoint variants are forbidden. Style the smallest viewport as the base and ADD with min-width variants (sm:, md:, lg:).',
        },
        {
          selector: 'TemplateElement[value.raw=/max-(sm|md|lg|xl|2xl):/]',
          message:
            'max-* breakpoint variants are forbidden. Style the smallest viewport as the base and ADD with min-width variants.',
        },
        {
          selector: 'Literal[value=/max-width\\s*:/]',
          message:
            'max-width media queries are forbidden. Use min-width so breakpoints only ever add.',
        },
        {
          selector: 'Literal[value=/100vw/]',
          message: '100vw includes the scrollbar and overflows. Use 100dvw or a grid track.',
        },
        {
          selector: 'Literal[value=/\\d+vh\\b/]',
          message: 'vh is wrong while a mobile browser chrome is animating. Use dvh.',
        },
        {
          selector: 'TemplateElement[value.raw=/\\d+vh\\b/]',
          message: 'vh is wrong while a mobile browser chrome is animating. Use dvh.',
        },
      ],
    },
  },

  {
    // The logger IS the console boundary, and the axe bootstrap is dev-only.
    files: ['src/lib/logger.ts'],
    rules: { 'no-console': 'off' },
  },

  {
    files: ['**/*.test.{ts,tsx}', 'vitest.setup.ts', 'e2e/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
