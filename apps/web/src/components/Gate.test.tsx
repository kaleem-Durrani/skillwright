/**
 * `Gate` has three branches and the middle one is the interesting one.
 *
 * While the session is still resolving there is no actor, and `can()` with a null
 * actor answers as ANONYMOUS — not "unknown". So a Gate that rendered `children ?
 * :fallback` without checking `isPending` would not merely be early, it would
 * render the anonymous answer for one round trip: a teacher watches their own
 * Edit button appear a beat after it should have, and an admin-only control
 * flashes absent on every cold load.
 *
 * The default fallback is deliberately NOTHING rather than a disabled control,
 * because a disabled button advertises a capability and every user who sees one
 * goes looking for how to enable it.
 */
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type ApiFetch = (path: string, options?: unknown) => Promise<unknown>;

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn<ApiFetch>() }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: { get: apiGet, post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  };
});

// Imported after the mock so the session query resolves the stub.
import { qk } from '@/lib/query';
import type { SessionUser } from '@/lib/session';
import { Gate } from './Gate.js';

const TEACHER: SessionUser = {
  id: '01JGXDFAM0K2Z1GYCSNM5F5RCX',
  email: 'dana@example.edu',
  name: 'Dana Okafor',
  role: 'TEACHER',
  status: 'ACTIVE',
  provenance: 'PASSWORD',
  avatarUrl: null,
  totpEnabled: false,
};

/** `session: 'pending'` leaves /auth/me unanswered. */
function renderGate(node: ReactNode, session: SessionUser | null | 'pending') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (session === 'pending') {
    apiGet.mockImplementation(() => new Promise(() => {}));
  } else {
    client.setQueryData(qk.session, { user: session });
  }
  render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  apiGet.mockReset();
});

describe('Gate', () => {
  it('renders the children when the action is allowed', () => {
    renderGate(
      <Gate action="course:create">
        <button type="button">New course</button>
      </Gate>,
      TEACHER,
    );

    expect(screen.getByRole('button', { name: 'New course' })).toBeInTheDocument();
  });

  it('renders nothing at all when it is not', () => {
    renderGate(
      <Gate action="course:create">
        <button type="button">New course</button>
      </Gate>,
      { ...TEACHER, role: 'STUDENT' },
    );

    expect(screen.queryByRole('button', { name: 'New course' })).not.toBeInTheDocument();
  });

  it('renders an explicit fallback when one is given', () => {
    renderGate(
      <Gate action="course:create" fallback={<p>Ask an administrator to add a course.</p>}>
        <button type="button">New course</button>
      </Gate>,
      { ...TEACHER, role: 'STUDENT' },
    );

    expect(screen.getByText('Ask an administrator to add a course.')).toBeInTheDocument();
  });

  it('shows neither answer while the session is still resolving', () => {
    renderGate(
      <Gate action="course:create" fallback={<p>denied</p>} pending={<p>checking permissions</p>}>
        <button type="button">New course</button>
      </Gate>,
      'pending',
    );

    // The fallback is the ANONYMOUS answer at this point, not the real one. Showing
    // it here is how a signed-in teacher is told, briefly and wrongly, that they
    // cannot create a course.
    expect(screen.getByText('checking permissions')).toBeInTheDocument();
    expect(screen.queryByText('denied')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New course' })).not.toBeInTheDocument();
  });
});
