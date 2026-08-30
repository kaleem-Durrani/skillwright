/**
 * Three states, not two — and the accessible name has to say WHICH.
 *
 * The trigger renders the RESOLVED icon (a moon when the page is dark) but names
 * the PREFERENCE ("Theme: system"). Those are different values and the difference
 * is the whole point: a user on "system" under a dark OS sees a moon, and if the
 * label said "dark" they would have no way to tell that they are following the OS
 * rather than pinned to it. Nothing about that is checkable by eye in a review,
 * and axe does not compare a label to the state it describes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeToggle } from './ThemeToggle.js';

const STORAGE_KEY = 'sw.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

let osPrefersDark = false;

beforeEach(() => {
  osPrefersDark = false;
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === DARK_QUERY ? osPrefersDark : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

/** Opens the menu and returns the three radio items. */
async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Change theme/ }));
  return screen.findAllByRole('menuitemradio');
}

describe('ThemeToggle', () => {
  it('names the preference in its accessible label', () => {
    localStorage.setItem(STORAGE_KEY, 'system');
    render(<ThemeToggle />);

    expect(screen.getByRole('button', { name: 'Theme: system. Change theme' })).toBeInTheDocument();
  });

  it('shows the resolved icon while still naming the preference', () => {
    // On "system" under a dark OS the button is a moon, and the label still says
    // system. A label built from `resolved` would read "Theme: dark" and hide the
    // fact that the OS is the one deciding.
    osPrefersDark = true;
    localStorage.setItem(STORAGE_KEY, 'system');
    const { container } = render(<ThemeToggle />);

    const trigger = screen.getByRole('button', { name: 'Theme: system. Change theme' });
    expect(trigger).toBeInTheDocument();
    // The label alone cannot tell "system resolving to dark" apart from "system
    // resolving to light" — both name the preference identically. Lucide stamps
    // each icon component's own name onto the rendered `<svg>` as a class
    // (`lucide-moon` for `Moon`, `lucide-sun` for `Sun`), which is the one place
    // in the DOM that says which icon actually painted.
    expect(container.querySelector('svg')).toHaveClass('lucide-moon');
  });

  it('offers system as a real choice beside light and dark', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    const items = await openMenu(user);

    // A two-way toggle opts the user out of their OS setting the first time they
    // touch it, with no way back. The third item is the way back.
    expect(items.map((item) => item.textContent)).toEqual(['Light', 'Dark', 'Match system']);
  });

  it('marks the current preference as the checked radio', async () => {
    localStorage.setItem(STORAGE_KEY, 'dark');
    const user = userEvent.setup();
    render(<ThemeToggle />);

    const items = await openMenu(user);

    expect(items.find((item) => item.getAttribute('aria-checked') === 'true')).toHaveTextContent(
      'Dark',
    );
  });

  it('persists a choice and applies it to the document', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    const items = await openMenu(user);
    await user.click(items[1]!);

    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('goes back to following the OS', async () => {
    localStorage.setItem(STORAGE_KEY, 'light');
    const user = userEvent.setup();
    render(<ThemeToggle />);

    const items = await openMenu(user);
    await user.click(items[2]!);

    expect(localStorage.getItem(STORAGE_KEY)).toBe('system');
    // "system" removes the attribute rather than naming it, so the token sheet's
    // `:root:not([data-theme="light"])` dark branch can apply.
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});
