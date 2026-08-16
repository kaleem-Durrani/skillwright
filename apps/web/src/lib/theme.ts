import { useCallback, useEffect, useState } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'sw.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    /* private browsing */
  }
  return 'system';
}

function systemTheme(): ResolvedTheme {
  return typeof window !== 'undefined' && window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

/**
 * Write the preference to the document.
 *
 * WHY "system" REMOVES the attribute instead of stamping `data-theme="system"`:
 * the token sheet expresses the system case as
 * `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }`.
 * An attribute of any value would still match that selector and would defeat the
 * explicit-light escape hatch.
 */
export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const root = document.documentElement;
  if (preference === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', preference);
  }
  const resolved = preference === 'system' ? systemTheme() : preference;
  // Tells the UA to render form controls, scrollbars and the caret in-theme.
  root.style.colorScheme = resolved;
  return resolved;
}

export interface ThemeApi {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
  /** Cycles light → dark → system, which is what a single toolbar button needs. */
  cycle: () => void;
}

export function useTheme(): ThemeApi {
  const [preference, setState] = useState<ThemePreference>(readPreference);
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    preference === 'system' ? systemTheme() : preference,
  );

  useEffect(() => {
    setResolved(applyTheme(preference));
  }, [preference]);

  // Follow the OS live, but only while the user is actually on "system".
  useEffect(() => {
    if (preference !== 'system') return;
    const media = window.matchMedia(DARK_QUERY);
    const onChange = () => setResolved(applyTheme('system'));
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [preference]);

  // Keep every open tab in agreement.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setState(readPreference());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private browsing: the choice lasts for this tab only */
    }
    setState(next);
  }, []);

  const cycle = useCallback(() => {
    setPreference(preference === 'light' ? 'dark' : preference === 'dark' ? 'system' : 'light');
  }, [preference, setPreference]);

  return { preference, resolved, setPreference, cycle };
}
