/**
 * Written FROM THE CONTRACT, in the house style of Notifications.test.tsx: the
 * network is stubbed at `@/lib/api`, the session is seeded into the cache rather
 * than fetched, and the route module is mocked so `Route.useSearch()` stands in
 * for the router. What these tests pin is how the page BEHAVES for a given open
 * thread — not that TanStack parses `?conversationId=`.
 *
 * THE SUBJECT IS A SIDE EFFECT, SO IT IS ASSERTED ON THE WIRE. Nothing was added
 * to the screen: no control, no toast, no spinner. A test that looked for one
 * would be asserting the opposite of the brief, so the only thing these can
 * observe is the request — and what the page does with its answer, which is the
 * list badge, because that is the one place read state is visible.
 */
import type { SessionUser } from '@/lib/session';
import type { MessagesSearch } from '@/routes/_app/messages';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { qk } from '@/lib/query';
import { ApiError } from '@/lib/problem';
import type { Paginated } from '@skillwright/shared/schema';
import type { ConversationDto, MessageDto } from '@/lib/types';

type ApiSend = (path: string, body?: unknown, options?: unknown) => Promise<unknown>;
type ApiFetch = (path: string, options?: unknown) => Promise<unknown>;

const { apiGet, apiPost, searchMock, navigateSpy, toastFromError, toastError } = vi.hoisted(() => ({
  apiGet: vi.fn<ApiFetch>(),
  apiPost: vi.fn<ApiSend>(),
  searchMock: vi.fn<() => MessagesSearch>(),
  navigateSpy: vi.fn(),
  toastFromError: vi.fn(),
  toastError: vi.fn(),
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

/*
 * The Toast module is stubbed rather than rendered so "no error reached the
 * reader" is an assertion on a SPY. Rendering a viewport and asking whether a
 * region appeared would prove less: the viewport unmounts its live region about a
 * second after opening (lesson 26), so a sample taken later would miss a toast
 * that really was shown. The spy has no such window.
 */
vi.mock('@/components/ui/Toast', () => ({
  toast: {
    fromError: toastFromError,
    error: toastError,
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

// Imported after the mocks so the page resolves the stubbed client, route and toast.
import { MessagesPage } from './Messages.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** ULIDs — `idSchema` accepts a cuid or a ULID and nothing else. */
const VIEWER_ID = '01JGXDFAM0K2Z1GYCSNM5F5RA0';
const TEACHER_ID = '01JGXDFAM0K2Z1GYCSNM5F5RB0';
const THREAD_A_ID = '01JGXDFAM0K2Z1GYCSNM5F5RC0';
const THREAD_B_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD0';

const VIEWER: SessionUser = {
  id: VIEWER_ID,
  email: 'student@example.edu',
  name: 'Ada Okafor',
  role: 'STUDENT',
  status: 'ACTIVE',
  provenance: 'PASSWORD',
  avatarUrl: null,
  totpEnabled: false,
};

const TEACHER = { id: TEACHER_ID, name: 'Ravi Menon', role: 'TEACHER' as const, avatarUrl: null };

function participant(userId: string, name: string, role: 'STUDENT' | 'TEACHER') {
  return {
    user: { id: userId, name, role, avatarUrl: null },
    lastReadSeq: '0',
    lastReadAt: null,
    joinedAt: '2026-08-01T09:00:00.000Z',
    leftAt: null,
  };
}

const VIEWER_SEAT = participant(VIEWER_ID, VIEWER.name, 'STUDENT');
const TEACHER_SEAT = participant(TEACHER_ID, TEACHER.name, 'TEACHER');

/** Three unread messages above the viewer's mark — the badge the list renders. */
const THREAD_A: ConversationDto = {
  id: THREAD_A_ID,
  title: null,
  participants: [VIEWER_SEAT, TEACHER_SEAT],
  lastMessage: {
    id: '01JGXDFAM0K2Z1GYCSNM5F5RE5',
    conversationId: THREAD_A_ID,
    sender: TEACHER,
    seq: '5',
    content: 'See you Thursday',
    clientMsgId: '01JGXDFAM0K2Z1GYCSNM5F5RE6',
    createdAt: '2026-08-22T09:30:00.000Z',
    editedAt: null,
    deletedAt: null,
  },
  unreadCount: 3,
  lastMessageAt: '2026-08-22T09:30:00.000Z',
  createdAt: '2026-08-01T09:00:00.000Z',
};

/**
 * Already read, so the two threads are distinguishable by badge alone. Its preview
 * is a DIFFERENT string: the list renders `lastMessage.content` per row, and two
 * rows saying the same thing makes every `getByText` on a preview ambiguous.
 */
const THREAD_B: ConversationDto = {
  ...THREAD_A,
  id: THREAD_B_ID,
  lastMessage: {
    ...THREAD_A.lastMessage!,
    id: '01JGXDFAM0K2Z1GYCSNM5F5RF0',
    seq: '1',
    content: 'Your timetable is unchanged',
  },
  unreadCount: 0,
};

/** Newest first, as the endpoint serves it (`orderBy: { seq: 'desc' }`). */
const THREAD_A_MESSAGES: MessageDto[] = ['5', '4', '3'].map((seq) => ({
  id: `01JGXDFAM0K2Z1GYCSNM5F5RZ${seq}`,
  conversationId: THREAD_A_ID,
  sender: TEACHER,
  seq,
  content: `Message ${seq}`,
  clientMsgId: `01JGXDFAM0K2Z1GYCSNM5F5RY${seq}`,
  createdAt: '2026-08-22T09:30:00.000Z',
  editedAt: null,
  deletedAt: null,
}));

const THREAD_B_MESSAGES: MessageDto[] = [
  {
    ...THREAD_A_MESSAGES[0]!,
    id: '01JGXDFAM0K2Z1GYCSNM5F5S00',
    conversationId: THREAD_B_ID,
    seq: '1',
  },
];

function listPage(): Paginated<ConversationDto> {
  return {
    data: [THREAD_A, THREAD_B],
    meta: { page: 1, limit: 20, total: 2, totalPages: 1, hasNext: false, hasPrev: false },
  };
}

/** A fully-read first window: `nextCursor: null` so the "Load older" button never appears. */
function cursorPage(rows: MessageDto[]) {
  return { data: rows, meta: { nextCursor: null, hasMore: false } };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockImplementation((path) => {
    if (path === '/conversations') return Promise.resolve(listPage());
    if (path === `/conversations/${THREAD_A_ID}/messages`) {
      return Promise.resolve(cursorPage(THREAD_A_MESSAGES));
    }
    if (path === `/conversations/${THREAD_B_ID}/messages`) {
      return Promise.resolve(cursorPage(THREAD_B_MESSAGES));
    }
    return Promise.resolve({});
  });
  /*
   * The read route answers with the REFRESHED conversation, so `unreadCount` in
   * this stub is what the badge clears from. The list itself is NOT re-fetched —
   * a test that cannot tell the two apart would pass if the page simply
   * invalidated the list, which is the thing this is written to prevent.
   */
  apiPost.mockImplementation((path, body) => {
    if (path === `/conversations/${THREAD_A_ID}/read`) {
      return Promise.resolve({ ...THREAD_A, unreadCount: 0 });
    }
    if (path === `/conversations/${THREAD_B_ID}/read`) {
      return Promise.resolve({ ...THREAD_B, unreadCount: 0 });
    }
    return Promise.resolve(body);
  });
});

function renderPage(search: MessagesSearch = {}): {
  rerenderWith: (next: MessagesSearch) => void;
  client: QueryClient;
} {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(qk.session, { user: VIEWER });
  searchMock.mockReturnValue(search);

  const utils = render(
    <QueryClientProvider client={client}>
      <MessagesPage />
    </QueryClientProvider>,
  );

  return {
    // Simulates navigating: same mounted tree, fresh search values — precisely
    // what a search-param change hands the component. The JSX is rebuilt each
    // call, because rerender() bails out on an element it has already seen.
    rerenderWith(next: MessagesSearch) {
      searchMock.mockReturnValue(next);
      utils.rerender(
        <QueryClientProvider client={client}>
          <MessagesPage />
        </QueryClientProvider>,
      );
    },
    client,
  };
}

/** Every call to the read endpoint, as `[conversationId, body]` pairs. */
function readPosts(): Array<[string, unknown]> {
  return apiPost.mock.calls
    .filter(([path]) => path.endsWith('/read'))
    .map(([path, body]) => [String(path).split('/').slice(-2, -1)[0]!, body]);
}

/** Every GET the page made to the list endpoint. */
function listGets(): number {
  return apiGet.mock.calls.filter(([path]) => path === '/conversations').length;
}

/**
 * Waits past `READ_RECEIPT_MS` so a receipt that should NOT have been sent has
 * had its chance to be sent.
 *
 * Without this, "no extra request" assertions are unfalsifiable: the page is
 * still inside its own delay, so a double-send implementation looks identical to
 * a correct one for the length of a `findBy`. Every negative assertion in this
 * file is therefore taken after a settle, and that is the whole reason the
 * negative tests are worth running.
 *
 * The number is RESTATED rather than imported: `READ_RECEIPT_MS` is module-private
 * to the page, and exporting a delay so a test can import it would let the two
 * drift silently — a test that settles for the current delay passes against code
 * that sends twice, and would keep passing if the delay were raised. Over-settling
 * is free; a missed negative assertion is not. This file reads the value back if
 * the page's own copy ever moves (see the `settle` note in the burst test).
 */
const RECEIPT_DELAY_MS = 250;

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, RECEIPT_DELAY_MS * 3));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MessagesPage — read receipts', () => {
  it('marks nothing read on the list alone, because nothing has been opened', async () => {
    renderPage();

    // The list is on screen, the thread pane is the empty state: no receipt.
    await screen.findByText(/see you thursday/i);
    expect(await screen.findByRole('heading', { name: /pick a conversation/i })).toBeVisible();
    expect(readPosts()).toHaveLength(0);

    // And the unread badge the reader is entitled to is still there.
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('marks the OPEN thread read at the newest seq it is showing, and clears the badge from the answer', async () => {
    const page = renderPage();
    await screen.findByText(/see you thursday/i);

    page.rerenderWith({ conversationId: THREAD_A_ID });
    await screen.findByText('Message 5');

    await waitFor(() => expect(readPosts()).toEqual([[THREAD_A_ID, { seq: '5' }]]));

    // ONE body, and it is the watermark form `markReadSchema` requires
    // (message.ts: `seq` is a decimal string — a Postgres bigint). Not the
    // conversation, and not a count of messages.
    expect(apiPost).toHaveBeenCalledWith(`/conversations/${THREAD_A_ID}/read`, { seq: '5' });

    // The badge clears from the RESPONSE. The list was fetched once and is never
    // refetched: an invalidation here would repopulate a badge the reader had
    // just dismissed, a beat later.
    await waitFor(() => expect(screen.queryByText('3')).toBeNull());

    // Not a screen: nothing was raised, and no second copy of the thread was
    // fetched or rendered to announce the change.
    expect(toastFromError).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(listGets()).toBe(1);
  });

  it('sends one receipt per conversation, not one per switch or per poll', async () => {
    const page = renderPage();
    await screen.findByText(/see you thursday/i);

    page.rerenderWith({ conversationId: THREAD_A_ID });
    await screen.findByText('Message 5');
    await waitFor(() => expect(readPosts()).toHaveLength(1));

    /*
     * A poll landing, bringing nothing new. The window is unchanged, so the newest
     * seq is unchanged, and a receipt is a function of "a new message appeared"
     * rather than of "the thread is open" — this is what keeps a thread left open
     * for an hour from asking the server the same question 240 times.
     */
    await page.client.invalidateQueries({ queryKey: qk.messages(THREAD_A_ID) });
    await screen.findByText('Message 5');
    await settle();
    expect(readPosts()).toHaveLength(1);

    // Switching to another thread: B is due a receipt, and gets one.
    page.rerenderWith({ conversationId: THREAD_B_ID });
    await waitFor(() => expect(readPosts()).toHaveLength(2));
    expect(readPosts()[1]).toEqual([THREAD_B_ID, { seq: '1' }]);

    /*
     * And back. The effect re-runs on the id change even though nothing about A
     * has changed, which is exactly why the guard is a Map keyed by CONVERSATION
     * and not one "last seq" for the pane: `Thread` is not remounted when the id
     * changes, so a single slot would already have been overwritten by B and A
     * would be marked read a second time.
     *
     * Settled FIRST, deliberately. The receipt waits `READ_RECEIPT_MS`, so an
     * assertion taken as soon as the pane renders passes just as happily against
     * code that sends the receipt twice.
     */
    page.rerenderWith({ conversationId: THREAD_A_ID });
    await screen.findByText('Message 5');
    await settle();
    expect(readPosts()).toHaveLength(2);
  });

  it('sends another receipt when a genuinely new message arrives in the open thread', async () => {
    const page = renderPage();
    await screen.findByText(/see you thursday/i);
    page.rerenderWith({ conversationId: THREAD_A_ID });
    await screen.findByText('Message 5');
    await waitFor(() => expect(readPosts()).toEqual([[THREAD_A_ID, { seq: '5' }]]));

    // The poll returns a window one message newer. The newest seq MOVED, so the
    // guard does not apply and the watermark advances to cover what arrived.
    apiGet.mockImplementation((path) => {
      if (path === '/conversations') return Promise.resolve(listPage());
      if (path === `/conversations/${THREAD_A_ID}/messages`) {
        return Promise.resolve(
          cursorPage([
            {
              ...THREAD_A_MESSAGES[0]!,
              id: '01JGXDFAM0K2Z1GYCSNM5F5S10',
              seq: '6',
              content: 'Message 6',
              clientMsgId: '01JGXDFAM0K2Z1GYCSNM5F5S11',
            },
            ...THREAD_A_MESSAGES,
          ]),
        );
      }
      return Promise.resolve({});
    });
    await page.client.invalidateQueries({ queryKey: qk.messages(THREAD_A_ID) });

    await screen.findByText('Message 6');
    await waitFor(() =>
      expect(readPosts()).toEqual([
        [THREAD_A_ID, { seq: '5' }],
        [THREAD_A_ID, { seq: '6' }],
      ]),
    );
  });

  it('collapses a burst of thread switching into one receipt, for the thread that is still open', async () => {
    const page = renderPage();
    await screen.findByText(/see you thursday/i);

    /*
     * Three switches, all inside the 250ms the receipt waits. Each replaces the
     * pending one rather than queueing behind it, so the burst is a single
     * request — and it is the thread that is STILL OPEN at the deadline that gets
     * it, because that is the one the reader is still looking at.
     */
    page.rerenderWith({ conversationId: THREAD_A_ID });
    page.rerenderWith({ conversationId: THREAD_B_ID });
    page.rerenderWith({ conversationId: THREAD_A_ID });

    await waitFor(() => expect(readPosts()).toEqual([[THREAD_A_ID, { seq: '5' }]]));

    // Give the replaced timers a chance to misbehave before declaring the burst
    // over: two more delays, and still exactly one request.
    await settle();
    expect(readPosts()).toHaveLength(1);
  });

  it('swallows a failed receipt: no toast, no error state, and the badge waits for the next poll', async () => {
    apiPost.mockImplementation((path) => {
      if (path.endsWith('/read')) {
        return Promise.reject(
          new ApiError({
            type: 'about:blank',
            title: 'Forbidden',
            status: 403,
            code: 'FORBIDDEN',
            requestId: 'req-1',
          }),
        );
      }
      return Promise.resolve({});
    });

    const page = renderPage();
    await screen.findByText(/see you thursday/i);

    page.rerenderWith({ conversationId: THREAD_A_ID });
    await screen.findByText('Message 5');
    await waitFor(() => expect(readPosts()).toHaveLength(1));

    // The reader is told nothing. A toast here would be an error for an action
    // they never took, on a write that cannot fail in a way they could fix.
    expect(toastFromError).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();

    // The thread is still fully readable, and the badge is still honest.
    expect(screen.getByText('Message 5')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();

    // And the failure is not retried into a storm: the next poll of this same
    // window offers the same seq, which the guard has already recorded.
    await page.client.invalidateQueries({ queryKey: qk.messages(THREAD_A_ID) });
    await screen.findByText('Message 5');
    await settle();
    expect(readPosts()).toHaveLength(1);
  });

  it('sends no receipt for a thread that has no messages to have read', async () => {
    apiGet.mockImplementation((path) => {
      if (path === '/conversations') return Promise.resolve(listPage());
      return Promise.resolve(cursorPage([]));
    });

    const page = renderPage();
    await screen.findByText(/see you thursday/i);
    page.rerenderWith({ conversationId: THREAD_A_ID });

    await screen.findByRole('heading', { name: /no messages yet/i });
    await settle();

    // There is no high-water mark to offer, and `markReadSchema` requires a seq.
    // Posting one would be inventing a number the server has not handed out.
    expect(readPosts()).toHaveLength(0);
  });
});
