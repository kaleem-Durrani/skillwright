/**
 * The shell's search affordance, tested on its own — the whole AppShell drags in
 * the session, the policy layer and the notification bell's polling, none of
 * which this component reads. Router hooks are stubbed: `useNavigate` is a spy
 * to observe where submission lands, `useRouterState` answers a controllable
 * pathname so the leave-the-screen reset can be driven by hand.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { navigateSpy, pathnameMock } = vi.hoisted(() => ({
  navigateSpy: vi.fn(),
  pathnameMock: vi.fn(() => '/dashboard'),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useNavigate: () => navigateSpy,
    useRouterState: (options?: { select?: (state: unknown) => unknown }) => {
      const state = { location: { pathname: pathnameMock() } };
      return options?.select ? options.select(state) : state;
    },
  };
});

// Imported after the mocks.
import { ShellSearch } from './ShellSearch.js';

beforeEach(() => {
  // The navigate spy is module-level; without this, test 1's call leaks into
  // test 2's "never navigated" assertion.
  vi.clearAllMocks();
});

describe('ShellSearch', () => {
  it('submits to /search with the trimmed term', async () => {
    const user = userEvent.setup();
    render(<ShellSearch />);

    await user.type(screen.getByRole('searchbox', { name: 'Search' }), '  welding ');
    await user.keyboard('{Enter}');

    expect(navigateSpy).toHaveBeenCalledWith({ to: '/search', search: { q: 'welding' } });
  });

  it('ignores a blank or whitespace-only submit instead of navigating into a 422', async () => {
    const user = userEvent.setup();
    render(<ShellSearch />);

    await user.type(screen.getByRole('searchbox', { name: 'Search' }), '   ');
    await user.keyboard('{Enter}');

    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('opens the results page directly from the mobile affordance', async () => {
    const user = userEvent.setup();
    render(<ShellSearch />);

    // No primary-nav entry was added for this — it is an icon beside the bell,
    // and /search owns showing anything.
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(navigateSpy).toHaveBeenCalledWith({ to: '/search' });
  });

  it('empties the launcher when the user moves to another screen', async () => {
    const user = userEvent.setup();
    const view = render(<ShellSearch />);

    const box = screen.getByRole('searchbox', { name: 'Search' }) as HTMLInputElement;
    await user.type(box, 'welding');
    expect(box).toHaveValue('welding');

    // Simulate the router landing somewhere else: same tree, new pathname. The
    // launcher holds no source of truth, so its text does not linger.
    act(() => {
      pathnameMock.mockReturnValue('/courses');
      view.rerender(<ShellSearch />);
    });

    expect(box).toHaveValue('');
  });
});
