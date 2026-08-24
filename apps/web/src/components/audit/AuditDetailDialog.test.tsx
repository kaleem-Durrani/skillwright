/**
 * Pins the audit forensics surface: opening one event fetches `/audit-events/:id`
 * and renders the stored record — actor, action, entity, both sides of the diff as
 * readable JSON, and ip / userAgent / requestId — with nulls shown as em dashes
 * rather than blank space or crashes.
 *
 * The dialog is mounted directly (no session needed; the page has already gated it),
 * harness as in AttendanceRegister.test.tsx.
 */
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

// Imported after the mock so the component resolves the stubbed client.
import { AuditDetailDialog, type AuditEventDetail } from './AuditDetailDialog.js';

const EVENT_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCX';

function detailFixture(overrides: Partial<AuditEventDetail> = {}): AuditEventDetail {
  return {
    id: EVENT_ID,
    action: 'UPDATE',
    entityType: 'User',
    entityId: 'cmsvme3r703ucw4g0i6oyh6fh',
    actorId: '01JGXDFAM0K2Z1GYCSNM5F5RCZ',
    actorName: 'Ada Admin',
    createdAt: '2026-08-20T10:15:00.000Z',
    before: { name: 'Before Name', status: 'ACTIVE' },
    after: { name: 'After Name', status: 'SUSPENDED' },
    ip: '203.0.113.7',
    userAgent: 'Mozilla/5.0 (vitest)',
    requestId: '01JGXDFAM0K2Z1GYCSNM5F5RD2',
    ...overrides,
  };
}

function renderDialog(eventId: string | null): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AuditDetailDialog eventId={eventId} onClose={() => undefined} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AuditDetailDialog', () => {
  it('renders the stored forensics for the event it was opened on', async () => {
    apiGet.mockResolvedValue(detailFixture());
    renderDialog(EVENT_ID);

    // The right endpoint was fetched.
    await vi.waitFor(() => expect(apiGet).toHaveBeenCalledWith(`/audit-events/${EVENT_ID}`));

    expect(await screen.findByText('Ada Admin')).toBeInTheDocument();
    expect(screen.getByText('UPDATE')).toBeInTheDocument();

    // Both sides of the diff as PRETTY-PRINTED JSON — keys one per line, not the
    // single-line encoding a bare String() would produce.
    expect(screen.getByText(/"name": "Before Name"/)).toBeInTheDocument();
    expect(screen.getByText(/"status": "SUSPENDED"/)).toBeInTheDocument();

    expect(screen.getByText('203.0.113.7')).toBeInTheDocument();
    expect(screen.getByText('Mozilla/5.0 (vitest)')).toBeInTheDocument();
    expect(screen.getByText('01JGXDFAM0K2Z1GYCSNM5F5RD2')).toBeInTheDocument();
  });

  it('shows an em dash for every forensic a system-initiated event never recorded', async () => {
    apiGet.mockResolvedValue(
      detailFixture({
        actorId: null,
        actorName: null,
        before: null,
        after: null,
        ip: null,
        userAgent: null,
        requestId: null,
      }),
    );
    renderDialog(EVENT_ID);

    expect(await screen.findByText('system')).toBeInTheDocument();

    // ip / userAgent / requestId render as a bare em dash each; the two diff sides
    // say it in words instead.
    expect(screen.getAllByText('—')).toHaveLength(3);
    expect(screen.getAllByText(/nothing recorded/)).toHaveLength(2);
  });

  it('fetches nothing while it is closed', () => {
    renderDialog(null);

    expect(apiGet).not.toHaveBeenCalled();
    // Radix keeps a closed Dialog's content out of the DOM entirely.
    expect(screen.queryByText('Audit event')).toBeNull();
  });
});
