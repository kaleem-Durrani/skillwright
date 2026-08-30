/**
 * Theme resolution.
 *
 * The one rule here that is not obvious from the code is why "system" REMOVES the
 * attribute instead of stamping `data-theme="system"`. The token sheet expresses
 * the system case as
 *
 *   @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }
 *
 * so an attribute of ANY value still matches that selector — `data-theme="system"`
 * included — and the explicit-light escape hatch stops working for exactly the
 * users who chose light while their OS is dark. Nothing errors; the page is simply
 * the wrong colour, in one configuration, for some people.
 *
 * The rest is state that lives in three places at once — a React state,
 * localStorage, and the document element — and the tests are about them agreeing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { applyTheme, useTheme } from './theme.js';

const DARK_QUERY = '(prefers-color-scheme: dark)';
const STORAGE_KEY = 'sw.theme';

/** Listeners registered against the dark-scheme query, so a change can be fired. */
let mediaListeners: Set<() => void>;
let osPrefersDark: boolean;

function stubMatchMedia(): void {
  mediaListeners = new Set();
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === DARK_QUERY ? osPrefersDark : false,
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: () => void) => mediaListeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => mediaListeners.delete(listener),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

/** What the OS telling the browser "dark now" looks like to a live listener. */
function fireOsChange(next: boolean): void {
  osPrefersDark = next;
  act(() => {
    for (const listener of mediaListeners) listener();
  });
}

beforeEach(() => {
  osPrefersDark = false;
  stubMatchMedia();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.style.colorScheme = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.style.colorScheme = '';
});

describe('applyTheme', () => {
  it('stamps an explicit choice on the document', () => {
    expect(applyTheme('dark')).toBe('dark');

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    // colorScheme is what makes the UA render form controls, scrollbars and the
    // caret in-theme; without it a dark page grows white scrollbars.
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('REMOVES the attribute for "system" rather than naming it', () => {
    applyTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    applyTheme('system');

    // `data-theme="system"` would satisfy `:root:not([data-theme="light"])` and
    // quietly disable the light escape hatch under a dark OS.
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('resolves "system" against the OS, not against a default', () => {
    osPrefersDark = true;
    expect(applyTheme('system')).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');

    osPrefersDark = false;
    expect(applyTheme('system')).toBe('light');
  });
});

describe('useTheme', () => {
  it('starts from the stored preference', () => {
    localStorage.setItem(STORAGE_KEY, 'dark');

    const { result } = renderHook(() => useTheme());

    expect(result.current.preference).toBe('dark');
    expect(result.current.resolved).toBe('dark');
  });

  it('ignores a stored value that is not one of the three', () => {
    // Anything could be in there: another app on the same origin, an old spelling,
    // a half-written value. An unrecognised setting must fall back to the safe
    // default rather than to whatever branch happens to be last.
    localStorage.setItem(STORAGE_KEY, 'midnight');

    const { result } = renderHook(() => useTheme());

    expect(result.current.preference).toBe('system');
  });

  it('persists a choice and writes it to the document', () => {
    const { result } = renderHook(() => useTheme());

    act(() => result.current.setPreference('dark'));

    expect(result.current.preference).toBe('dark');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('cycles light, dark, system and back', () => {
    // One toolbar button, three states: the order is the affordance. Reversing it
    // or dropping "system" strands anyone who wanted to follow their OS.
    const { result } = renderHook(() => useTheme());

    act(() => result.current.setPreference('light'));
    act(() => result.current.cycle());
    expect(result.current.preference).toBe('dark');

    act(() => result.current.cycle());
    expect(result.current.preference).toBe('system');

    act(() => result.current.cycle());
    expect(result.current.preference).toBe('light');
  });

  it('follows the OS live while on "system"', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolved).toBe('light');

    fireOsChange(true);

    expect(result.current.resolved).toBe('dark');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('stops following the OS once a choice has been made', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setPreference('light'));

    fireOsChange(true);

    // An explicit light choice must survive the OS going dark, which is the whole
    // reason the preference and the resolved theme are two different values.
    expect(result.current.resolved).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('picks up a change made in another tab', () => {
    const { result } = renderHook(() => useTheme());

    act(() => {
      localStorage.setItem(STORAGE_KEY, 'dark');
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY, newValue: 'dark' }));
    });

    // Two tabs of the same app disagreeing about the theme looks like a rendering
    // bug rather than a missing listener.
    expect(result.current.preference).toBe('dark');
  });

  it('ignores a storage event about some other key', () => {
    const { result } = renderHook(() => useTheme());

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'sw.axe', newValue: 'on' }));
    });

    expect(result.current.preference).toBe('system');
  });
});
