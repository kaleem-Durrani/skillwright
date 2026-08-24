/**
 * Pins the admin overview's Phase 8 wiring: the feed's CSV export appears only for
 * a caller `audit:read` allows (the exact gate `/audit-events/export` enforces), and
 * clicking a feed row opens the detail dialog, which fetches THAT event and renders
 * its forensics.
 *
 * Harness as in CoursePublishButton.test.tsx: network stubbed at `@/lib/api`, viewer
 * planted under `qk.session`. DataList keeps BOTH renderings in the DOM (they are
 * switched by CSS at md), so row clicks address the table copy explicitly.
 */
import type { SessionUser } from '@/lib/session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { qk } from '@/lib/query';

type ApiFetch = (path: string, options?: { query?: Record<string, unknown> }) => Promise<unknown>;

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn<ApiFetch>() }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: { get: apiGet, post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  };
});

// The tiles render router `Link`s; there is no router in jsdom, so Link degrades to
// an anchor rendering its children — the same spirit as mocking `useNavigate`.
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const React = await import('react');
  return {
    ...actual,
    Link: (props: { children?: React.ReactNode; className?: string }) =>
      React.createElement('a', { className: props.className }, props.children),
  };
});

// Imported after the mock so the page resolves the stubbed client.
import { AdminOverviewPage } from './AdminOverview.js';

const EVENT_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCX';

const FEED_PAGE = {
  data: [
    {
      id: EVENT_ID,
      action: 'UPDATE',
      entityType: 'User',
      entityId: 'cmsvme3r703ucw4g0i6oyh6fh',
      actorId: '01JGXDFAM0K2Z1GYCSNM5F5RCZ',
      actorName: 'Ada Admin',
      createdAt: '2026-08-20T10:15:00.000Z',
    },
  ],
  meta: { page: 1, limit: 20, total: 1, totalPages: 1, hasNext: false, hasPrev: false },
};

function viewer(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: '01JGXDFAM0K2Z1GYCSNM5F5RCZ',
    email: 'dean@example.edu',
    name: 'Ada Admin',
    role: 'ADMIN',
    status: 'ACTIVE',
    provenance: 'PASSWORD',
    avatarUrl: null,
    totpEnabled: false,
    ...overrides,
  };
}

function renderPage(session: SessionUser): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(qk.session, { user: session });
  render(
    <QueryClientProvider client={client}>
      <AdminOverviewPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockImplementation((path) => {
    if (path === '/admin/stats') {
      return Promise.resolve({
        users: 4,
        suspendedUsers: 0,
        departments: 2,
        auditEventsToday: FEED_PAGE.meta.total,
      });
    }
    if (path === '/audit-events') return Promise.resolve(FEED_PAGE);
    return Promise.resolve({});
  });
});

describe('AdminOverviewPage — the register exports', () => {
  it('offers the audit CSV to an admin, pointing at the same origin the cookie rides', async () => {
    renderPage(viewer());

    const link = await screen.findByRole('link', { name: /export csv/i });
    expect(link).toHaveAttribute('href', '/api/v1/audit-events/export');
    expect(link).toHaveAttribute('download');
  });

  it('offers no export — and no feed section at all — to a teacher', () => {
    renderPage(viewer({ role: 'TEACHER' }));

    // `audit:read` is STUDENT deny / TEACHER deny; the whole section is behind it.
    expect(screen.queryByRole('link', { name: /export csv/i })).toBeNull();
    expect(screen.queryByText('Recent activity')).toBeNull();
  });
});

describe('AdminOverviewPage — a feed row opens its forensics', () => {
  it('fetches the clicked row and renders before/after/ip/userAgent/requestId in the dialog', async () => {
    const user = userEvent.setup();
    apiGet.mockImplementation((path) => {
      if (path === '/admin/stats') {
        return Promise.resolve({
          users: 4,
          suspendedUsers: 0,
          departments: 2,
          auditEventsToday: 1,
        });
      }
      if (path === '/audit-events') return Promise.resolve(FEED_PAGE);
      if (path === `/audit-events/${EVENT_ID}`) {
        return Promise.resolve({
          ...FEED_PAGE.data[0],
          before: { status: 'ACTIVE' },
          after: { status: 'SUSPENDED' },
          ip: '203.0.113.7',
          userAgent: 'Mozilla/5.0 (vitest)',
          requestId: '01JGXDFAM0K2Z1GYCSNM5F5RD2',
        });
      }
      return Promise.reject(new Error(`unexpected GET ${String(path)}`));
    });

    renderPage(viewer());

    // A rendered feed row exists on BOTH DataList renderings; click the table copy
    // explicitly (its <tr> carries the onClick).
    await screen.findByText('UPDATE');
    const cell = screen.getAllByText('Ada Admin')[0] as HTMLElement;
    fireEvent.click(cell.closest('tr') ?? cell);

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(`/audit-events/${EVENT_ID}`));

    expect(await screen.findByText('Audit event')).toBeInTheDocument();
    expect(screen.getByText(/"status": "SUSPENDED"/)).toBeInTheDocument();
    expect(screen.getByText('203.0.113.7')).toBeInTheDocument();
    expect(screen.getByText('Mozilla/5.0 (vitest)')).toBeInTheDocument();
    expect(screen.getByText('01JGXDFAM0K2Z1GYCSNM5F5RD2')).toBeInTheDocument();

    // Escape dismisses back to the feed (Radix closes the dialog).
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByText('Audit event')).toBeNull());
  });
});
