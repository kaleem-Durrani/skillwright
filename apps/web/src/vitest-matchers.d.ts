/**
 * Registers the jest-dom matcher types against the interface `expect()` actually
 * returns.
 *
 * WHY this file exists: `@testing-library/jest-dom/vitest` augments `declare
 * module 'vitest'`, but `vitest` does not DECLARE `Assertion` — it re-exports it
 * (`export { Assertion, ... } from '@vitest/expect'`). A module augmentation can
 * only merge with an interface declared in the module being augmented, so
 * jest-dom's augmentation lands on a new, unused interface and every
 * `expect(el).toBeInTheDocument()` fails to typecheck while working perfectly at
 * runtime. Augmenting `@vitest/expect`, where the interface is really declared,
 * is what makes the types agree with the behaviour.
 *
 * The runtime registration still comes from the `@testing-library/jest-dom/vitest`
 * import in vitest.setup.ts. This file is types only.
 */
import type * as matchers from '@testing-library/jest-dom/matchers';

type TestingLibraryMatchers<E, R> = matchers.TestingLibraryMatchers<E, R>;

/*
 * The empty bodies are the whole mechanism: declaration merging adds the matcher
 * members to the existing interface, so there is nothing to put inside.
 */
/* eslint-disable @typescript-eslint/no-empty-object-type, @typescript-eslint/no-explicit-any */
declare module '@vitest/expect' {
  interface Assertion<T = any> extends TestingLibraryMatchers<any, T> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<any, any> {}
}
/* eslint-enable @typescript-eslint/no-empty-object-type, @typescript-eslint/no-explicit-any */
