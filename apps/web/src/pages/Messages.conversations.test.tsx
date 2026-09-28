/**
 * The Messages header, which used to say the literal word "Conversation" on every
 * thread and which now carries the one control Phase 5's first hole needed.
 *
 * Two things are pinned here, and both are consequences of the same fact.
 *
 * `POST /conversations/:conversationId/participants` has existed with a gate and
 * no caller, so a direct thread could never become a group: the only way to name
 * more than one person was to list them all in `createConversationSchema`'s
 * `participantIds` at creation, and there was no way to add somebody to a thread
 * that already existed. `conversation:join` is subject-free — anonymous, STUDENT
 * and TEACHER are all a bare `deny` — so a bare `can()` with no subject is the
 * COMPLETE gate here rather than a subject-free shortcut, and a student must be
 * offered nothing at all.
 *
 * And the header has to NAME the thread, because below `md` the list is behind the
 * reader rather than beside them: a screen that says "Conversation" above every
 * thread tells a person on a phone nothing about whose messages they are reading.
 */
import type { SessionUser } from '@/lib/session';
import type { MessagesSearch } from '@/routes/_app/messages';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { qk } from '@/lib/query';
import type { Paginated } from '@skillwright/shared/schema';
import type { ConversationDto } from '@/lib/types';

type ApiSend = (path: string, body?: unknown, options?: unknown) => Promise<unknown>;
type ApiFetch = (path: string, options?: unknown) => Promise<unknown>;

const { apiGet, apiPost, searchMock, navigateSpy } = vi.hoisted(() => ({
  apiGet: vi.fn<ApiFetch>(),
  apiPost: vi.fn<ApiSend>(),
  searchMock: vi.fn<() => MessagesSearch>(),
  navigateSpy: vi.fn(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: { get: apiGet, post: apiPost, patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  };
});

vi.mock('@/routes/_app/messages', () => ({
  Route: { useSearch: () => searchMock(), fullPath: '/messages' },
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useNavigate: () => navigateSpy };
});

vi.mock('@/components/ui/Toast', () => ({
  toast: { fromError: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

import { MessagesPage } from './Messages.js';

const ADMIN_ID = '01JGXDFAM0K2Z1GYCSNM5F5RA0';
const STUDENT_ID = '01JGXDFAM0K2Z1GYCSNM5F5RB0';
const THREAD_ID = '01JGXDFAM0K2Z1GYCSNM5F5RC0';

const ADMIN: SessionUser = {
  id: ADMIN_ID,
  email: 'priya@skillwright.dev',
  name: 'Priya Raman',
  role: 'ADMIN',
  status: 'ACTIVE',
  provenance: 'PASSWORD',
  avatarUrl: null,
  totpEnabled: false,
};

const STUDENT: SessionUser = {
  id: STUDENT_ID,
  email: 'ada@skillwright.dev',
  name: 'Ada Okafor',
  role: 'STUDENT',
  status: 'ACTIVE',
  provenance: 'PASSWORD',
  avatarUrl: null,
  totpEnabled: false,
};

/**
 * A teacher who is NOT the admin the thread names, so the "who is the other
 * participant" question has a different answer for them — which is what keeps the
 * loop below from asserting one label for two different viewers.
 */
const TEACHER: SessionUser = {
  id: '01JGXDFAM0K2Z1GYCSNM5F5RD9',
  email: 'dana@skillwright.dev',
  name: 'Dana Okafor',
  role: 'TEACHER',
  status: 'ACTIVE',
  provenance: 'PASSWORD',
  avatarUrl: null,
  totpEnabled: false,
};

function thread(title: string | null): ConversationDto {
  return {
    id: THREAD_ID,
    title,
    participants: [
      {
        user: { id: ADMIN_ID, name: 'Priya Raman', role: 'ADMIN', avatarUrl: null },
        lastReadSeq: '0',
        lastReadAt: null,
        joinedAt: '2026-08-01T09:00:00.000Z',
        leftAt: null,
      },
      {
        user: { id: STUDENT_ID, name: 'Ada Okafor', role: 'STUDENT', avatarUrl: null },
        lastReadSeq: '0',
        lastReadAt: null,
        joinedAt: '2026-08-01T09:00:00.000Z',
        leftAt: null,
      },
    ],
    lastMessage: null,
    unreadCount: 0,
    lastMessageAt: '2026-08-20T09:00:00.000Z',
    createdAt: '2026-08-01T09:00:00.000Z',
  };
}

function page(rows: ConversationDto[]): Paginated<ConversationDto> {
  return {
    data: rows,
    meta: { page: 1, limit: 20, total: rows.length, totalPages: 1, hasNext: false, hasPrev: false },
  };
}

const EMPTY_PAGE = page([]);

beforeEach(() => {
  vi.clearAllMocks();
  searchMock.mockReturnValue({ conversationId: THREAD_ID });
  apiGet.mockImplementation((path) => {
    if (path === '/conversations') return Promise.resolve(page([thread(null)]));
    if (path === `/conversations/${THREAD_ID}/messages`) {
      return Promise.resolve({ data: [], meta: { nextCursor: null, hasMore: false } });
    }
    return Promise.resolve(EMPTY_PAGE);
  });
  apiPost.mockResolvedValue(thread(null));
});

function renderPage(viewer: SessionUser): { unmount: () => void } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(qk.session, { user: viewer });
  return render(
    <QueryClientProvider client={client}>
      <MessagesPage />
    </QueryClientProvider>,
  );
}

describe('Messages — the thread header', () => {
  it('names a direct thread by the other participant, not the word "Conversation"', async () => {
    renderPage(STUDENT);

    // The viewer is seated in every thread (the creator is always seated), so the
    // label is the OTHER person — which is the whole point of a direct thread.
    await waitFor(() =>
      expect(screen.getAllByText('Priya Raman', { exact: true }).length).toBeGreaterThan(0),
    );
    const header = screen.getByLabelText('Conversation', { exact: true });
    expect(header).toHaveTextContent('Priya Raman');
    expect(header).not.toHaveTextContent('Conversation');
  });

  it('uses the thread title when the thread has one', async () => {
    apiGet.mockImplementation((path) => {
      if (path === '/conversations') return Promise.resolve(page([thread('Thursday workshop')]));
      if (path === `/conversations/${THREAD_ID}/messages`) {
        return Promise.resolve({ data: [], meta: { nextCursor: null, hasMore: false } });
      }
      return Promise.resolve(EMPTY_PAGE);
    });
    renderPage(STUDENT);

    await waitFor(() =>
      expect(screen.getByLabelText('Conversation', { exact: true })).toHaveTextContent(
        'Thursday workshop',
      ),
    );
  });
});

describe('Messages — the add-participant affordance', () => {
  it('is offered to an admin and opens the dialog', async () => {
    const user = userEvent.setup();
    renderPage(ADMIN);

    const trigger = await screen.findByRole('button', { name: /Add someone to/ });
    await user.click(trigger);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Search for a person')).toBeInTheDocument();
  });

  it('is offered to nobody else — the policy denies STUDENT and TEACHER outright', async () => {
    // A control that does nothing for the nine people out of ten who cannot use it
    // is the affordance-that-lies this repository keeps finding, so it is rendered
    // for ADMIN and for nobody else — and the header stays a plain label for them.
    for (const [viewer, counterpart] of [
      [STUDENT, 'Priya Raman'],
      // A teacher seated in the thread sees BOTH other members by name, which is
      // the label a group thread gets and a direct one never does.
      [TEACHER, 'Priya Raman, Ada Okafor'],
    ] as const) {
      const { unmount } = renderPage(viewer);
      await waitFor(() =>
        expect(screen.getByLabelText('Conversation', { exact: true })).toHaveTextContent(
          counterpart,
        ),
      );
      expect(
        screen.queryByRole('button', { name: /Add someone to/ }),
        `${viewer.role} was offered a control the API refuses them`,
      ).toBeNull();
      unmount();
    }
  });

  it('a bare can() is the right gate here, and the test says why', async () => {
    // `conversation:join` reads no Subject field for any role, so this is not the
    // LESSONS-LEARNED #15 trap. Asserted rather than assumed: if a future cell
    // ever reads one, the admin-only expectation above starts hiding a control
    // from somebody entitled to it, and this file's comment would be the only
    // thing saying so.
    const { can } = await import('@skillwright/shared/policy');
    for (const role of ['ANONYMOUS', 'STUDENT', 'TEACHER'] as const) {
      expect(
        can(
          role === 'ANONYMOUS'
            ? null
            : { id: '01JGXDFAM0K2Z1GYCSNM5F5RA0', role, status: 'ACTIVE', provenance: 'PASSWORD' },
          'conversation:join',
        ),
        `${role} is not denied conversation:join`,
      ).toMatchObject({ allowed: false });
    }
    expect(
      can(
        {
          id: '01JGXDFAM0K2Z1GYCSNM5F5RA0',
          role: 'ADMIN',
          status: 'ACTIVE',
          provenance: 'PASSWORD',
        },
        'conversation:join',
      ),
    ).toMatchObject({ allowed: true });
  });
});
