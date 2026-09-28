/**
 * `POST /conversations/:conversationId/participants` — the affordance that lets a
 * thread of two become a thread of three — and
 * `POST /conversations/:conversationId/participants/remove`, the undo for it.
 *
 * Both actions are bare `deny`/`allow` for all four cells with no subject anywhere
 * in the rules, so the gate on each control is a complete one and needs no
 * conversation to be built. What this file pins is the DIALOG's own behaviour, and
 * the ways it could be wrong:
 *
 *   - a search that fires on every keystroke;
 *   - a candidate list that includes people already seated, so a "successful"
 *     add is a no-op the UI reports as a change;
 *   - a confirm button that is live before anybody is chosen;
 *   - a remove that fires on the FIRST tap on somebody's name, which is the other
 *     direction of the same mistake and now has an affordance to be wrong about.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/Toast';
import { qk } from '@/lib/query';
import type { ConversationDto, UserDetail } from '@/lib/types';

type ApiFetch = (path: string, options?: unknown) => Promise<unknown>;
type ApiSend = (path: string, body?: unknown, options?: unknown) => Promise<unknown>;

const { apiGet, apiPost, onUpdated } = vi.hoisted(() => ({
  apiGet: vi.fn<ApiFetch>(),
  apiPost: vi.fn<ApiSend>(),
  onUpdated: vi.fn(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: { get: apiGet, post: apiPost, patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  };
});

import { AddParticipantDialog } from './AddParticipantDialog.js';

const ADA_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD1';
const BO_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD2';
const CASS_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD3';
const CONVERSATION_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCX';

function person(id: string, name: string, email: string): UserDetail {
  return {
    id,
    name,
    email,
    role: 'STUDENT',
    status: 'ACTIVE',
    avatarUrl: null,
    phoneNumber: null,
    bio: null,
    mfaEnabled: false,
    lastLoginAt: null,
    createdAt: '2026-01-05T09:00:00.000Z',
    studentProfile: null,
    teacherProfile: null,
  };
}

const ADA = person(ADA_ID, 'Ada Okafor', 'ada@skillwright.dev');
const BO = person(BO_ID, 'Bo Lindqvist', 'bo@skillwright.dev');
const CASS = person(CASS_ID, 'Cass Whitmore', 'cass@skillwright.dev');

/** Ada is SEATED; Bo is not; Cass has LEFT and is therefore re-addable. */
function participants(leftAt: string | null = null) {
  return [
    {
      user: { id: ADA_ID, name: 'Ada Okafor', role: 'STUDENT' as const, avatarUrl: null },
      lastReadSeq: '0',
      lastReadAt: null,
      joinedAt: '2026-08-01T09:00:00.000Z',
      leftAt: null,
    },
    {
      user: { id: CASS_ID, name: 'Cass Whitmore', role: 'STUDENT' as const, avatarUrl: null },
      lastReadSeq: '0',
      lastReadAt: null,
      joinedAt: '2026-08-01T09:00:00.000Z',
      leftAt,
    },
  ];
}

function conversation(participants: ConversationDto['participants']): ConversationDto {
  return {
    id: CONVERSATION_ID,
    title: null,
    participants,
    lastMessage: null,
    unreadCount: 0,
    lastMessageAt: '2026-08-20T09:00:00.000Z',
    createdAt: '2026-08-01T09:00:00.000Z',
  };
}

const EMPTY_PAGE = {
  data: [],
  meta: { page: 1, limit: 50, total: 0, totalPages: 0, hasNext: false, hasPrev: false },
};

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockResolvedValue(EMPTY_PAGE);
  apiPost.mockResolvedValue(conversation(participants()));
});

function renderDialog(
  options: {
    seated?: ConversationDto['participants'];
    open?: boolean;
    role?: 'STUDENT' | 'ADMIN';
    onOpenChange?: (open: boolean) => void;
  } = {},
): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Seeded rather than fetched: `useCan` reads the session, and a test that had to
  // mock `/auth/me` to reach a control would be asserting the mock.
  if (options.role) {
    client.setQueryData(qk.session, {
      user: {
        id: '01JGXDFAM0K2Z1GYCSNM5F5RD0',
        email: 'dana@skillwright.dev',
        name: 'Dana Whitfield',
        role: options.role,
        status: 'ACTIVE',
        provenance: 'PASSWORD',
        avatarUrl: null,
        totpEnabled: false,
      },
    });
  }
  render(
    <QueryClientProvider client={client}>
      <AddParticipantDialog
        conversationId={CONVERSATION_ID}
        participants={options.seated ?? participants()}
        open={options.open ?? true}
        onOpenChange={options.onOpenChange ?? vi.fn()}
        onUpdated={onUpdated}
      />
      <Toaster />
    </QueryClientProvider>,
  );
}

describe('AddParticipantDialog', () => {
  it('asks for nothing until somebody types a name', () => {
    renderDialog();
    // `GET /users` is the whole school. Opening the dialog to a list of every
    // account in the institution is a request nobody asked for and a screen
    // nobody can read.
    //
    // Scoped to `/users` rather than to `api` wholesale, because the dialog now asks
    // `useCan('conversation:remove')` and the session hook behind it fetches
    // `/auth/me` on mount. That is one request the app makes anyway on every screen;
    // the whole school is the one nobody asked for.
    expect(apiGet.mock.calls.filter(([path]) => path === '/users')).toEqual([]);
  });

  it('searches the directory, and only for the settled term', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('Search for a person'), 'Bo');
    // Waiting on the SEARCH rather than on "a call was made": the dialog asks
    // `useCan` about the remove control, and the session hook behind it calls
    // `/auth/me` on mount, so "somebody called the API" is already true before the
    // debounce has elapsed. That is the shape of a test that passes without the
    // thing it names.
    await waitFor(() =>
      expect(apiGet.mock.calls.filter(([path]) => path === '/users').length).toBeGreaterThan(0),
    );

    // DEBOUNCED. A phone keyboard is ten keystrokes before the first letter is a
    // surname, and `GET /users?q=` is a LIKE over the people table.
    const searches = apiGet.mock.calls.filter(([path]) => path === '/users');
    expect(searches.length).toBeLessThanOrEqual(2);
    expect(searches.at(-1)?.[1]).toMatchObject({ query: { q: 'Bo' } });
  });

  it('does not offer somebody who is already seated', async () => {
    const user = userEvent.setup();
    apiGet.mockResolvedValue({
      ...EMPTY_PAGE,
      data: [ADA, BO],
      meta: { ...EMPTY_PAGE.meta, total: 2 },
    });
    renderDialog();

    await user.type(screen.getByLabelText('Search for a person'), 'o');
    expect(await screen.findByRole('button', { name: /Bo Lindqvist/ })).toBeInTheDocument();
    /*
     * The exclusion is by SEAT, not by "currently active". `addParticipant` is an
     * UPSERT that re-seats somebody who left, so a person who has left must stay
     * visible here — filtered out, they would be un-restorable from the SPA.
     */
    expect(screen.queryByRole('button', { name: /Ada Okafor/ })).toBeNull();
  });

  it('refuses to confirm until somebody is chosen', async () => {
    const user = userEvent.setup();
    apiGet.mockResolvedValue({ ...EMPTY_PAGE, data: [BO] });
    renderDialog();

    const confirm = screen.getByRole('button', { name: 'Add to conversation' });
    // The add still takes two taps, even though the roster below now offers the
    // undo: seating somebody is a change to who can read the thread, and the
    // recovery is an administrator's action rather than the clicker's.
    expect(confirm).toBeDisabled();

    await user.type(screen.getByLabelText('Search for a person'), 'Bo');
    await user.click(await screen.findByRole('button', { name: /Bo Lindqvist/ }));
    expect(confirm).toBeEnabled();
  });

  it('discards the previous choice when the search changes', async () => {
    const user = userEvent.setup();
    apiGet.mockResolvedValue({ ...EMPTY_PAGE, data: [BO, CASS] });
    renderDialog();

    await user.type(screen.getByLabelText('Search for a person'), 'B');
    await user.click(await screen.findByRole('button', { name: /Bo Lindqvist/ }));
    expect(screen.getByRole('button', { name: 'Add to conversation' })).toBeEnabled();

    // Leaving "Bo" selected while the box says "Cass" is how the wrong person
    // gets seated in a thread.
    await user.type(screen.getByLabelText('Search for a person'), 'a');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add to conversation' })).toBeDisabled(),
    );
  });

  it('POSTs the chosen id to the thread, and hands the refreshed row back', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    apiGet.mockResolvedValue({ ...EMPTY_PAGE, data: [BO] });

    render(
      <QueryClientProvider client={client}>
        <AddParticipantDialog
          conversationId={CONVERSATION_ID}
          participants={participants()}
          open
          onOpenChange={onOpenChange}
          onUpdated={onUpdated}
        />
        <Toaster />
      </QueryClientProvider>,
    );

    await user.type(screen.getByLabelText('Search for a person'), 'Bo');
    await user.click(await screen.findByRole('button', { name: /Bo Lindqvist/ }));
    await user.click(screen.getByRole('button', { name: 'Add to conversation' }));

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(`/conversations/${CONVERSATION_ID}/participants`, {
        userId: BO_ID,
      }),
    );
    // The response IS the answer to "who is in this thread now", and the caller
    // decides what to do with it — an admin who is not seated gets a row whose
    // `lastMessage` the server has already nulled.
    await waitFor(() => expect(onUpdated).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('reports a refusal through the code, not a hand-written string', async () => {
    const user = userEvent.setup();
    apiGet.mockResolvedValue({ ...EMPTY_PAGE, data: [BO] });
    const { ApiError } = await import('@/lib/problem');
    apiPost.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Forbidden',
        status: 403,
        code: 'FORBIDDEN',
        detail: 'rule: STUDENT:deny',
        requestId: 'req-1',
      }),
    );

    renderDialog();
    await user.type(screen.getByLabelText('Search for a person'), 'Bo');
    await user.click(await screen.findByRole('button', { name: /Bo Lindqvist/ }));
    await user.click(screen.getByRole('button', { name: 'Add to conversation' }));

    // The SPA renders `problem.code` and never `problem.detail`; the detail here
    // is a rule name and must never reach a person.
    expect(await screen.findByText("You don't have access to that.")).toBeInTheDocument();
    expect(screen.queryByText(/STUDENT:deny/)).toBeNull();
  });

  it('says so when everybody matching is already in the thread', async () => {
    const user = userEvent.setup();
    apiGet.mockResolvedValue({ ...EMPTY_PAGE, data: [ADA] });
    renderDialog();

    await user.type(screen.getByLabelText('Search for a person'), 'Ada');
    expect(
      await screen.findByText('Everyone matching that is already in this thread.'),
    ).toBeInTheDocument();
  });
});

describe('removing somebody from the thread', () => {
  const removeFor = (name: string) => `Remove ${name} from this conversation`;

  it('offers the roster to an admin, and a remove control beside each seated person', () => {
    // Cass has LEFT, so the row is marked and carries no control.
    renderDialog({ role: 'ADMIN', seated: participants('2026-08-19T11:00:00.000Z') });

    expect(screen.getByRole('button', { name: removeFor('Ada Okafor') })).toBeInTheDocument();
    // Cass has left, so there is nothing to remove — and the row still says so,
    // because `addParticipant` can put them back and a hidden row would read as
    // "never here".
    expect(screen.queryByRole('button', { name: removeFor('Cass Whitmore') })).toBeNull();
    expect(screen.getByText('Left')).toBeInTheDocument();
  });

  it('offers a student no remove control at all', () => {
    renderDialog({ role: 'STUDENT', seated: participants() });

    // The roster is still shown — it is the same dialog, and hiding names an admin
    // can see from a student would be a difference with no purpose — but the control
    // is absent rather than disabled, because `conversation:remove` is a terminal
    // deny for STUDENT and TEACHER.
    expect(screen.getByText('Ada Okafor')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: removeFor('Ada Okafor') })).toBeNull();
  });

  it('does not remove on the first tap, and names the person in the confirm step', async () => {
    const user = userEvent.setup();
    renderDialog({ role: 'ADMIN', seated: participants() });

    await user.click(screen.getByRole('button', { name: removeFor('Ada Okafor') }));

    // The other direction of the mis-tap this dialog exists to absorb: a 44px control
    // in a list of names, on a phone, next to a row that is not the row you meant.
    expect(apiPost).not.toHaveBeenCalled();
    const confirm = screen.getByRole('button', { name: 'Remove from conversation' });
    expect(confirm).toBeInTheDocument();
    expect(screen.getByText(/Remove Ada Okafor\?/)).toBeInTheDocument();

    await user.click(confirm);
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(
        `/conversations/${CONVERSATION_ID}/participants/remove`,
        { userId: ADA_ID },
      ),
    );
    // Stays open, and hands the refreshed roster back, so a second correction is
    // one tap away rather than a reopen.
    expect(onUpdated).toHaveBeenCalled();
  });

  it('cancels a removal without sending anything', async () => {
    const user = userEvent.setup();
    renderDialog({ role: 'ADMIN', seated: participants() });

    await user.click(screen.getByRole('button', { name: removeFor('Ada Okafor') }));
    await user.click(screen.getByRole('button', { name: 'Keep them' }));

    expect(apiPost).not.toHaveBeenCalled();
    // Back to the roster, not to the search: a cancel that left the dialog in its
    // confirm state would be the next mis-tap's starting point.
    expect(screen.getByRole('button', { name: removeFor('Ada Okafor') })).toBeInTheDocument();
  });

  it('reports a refusal through the code, not a hand-written string', async () => {
    const user = userEvent.setup();
    const { ApiError } = await import('@/lib/problem');
    apiPost.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        code: 'CONFLICT',
        detail: 'That person has already left this conversation',
        requestId: 'req-2',
      }),
    );
    renderDialog({ role: 'ADMIN', seated: participants() });

    await user.click(screen.getByRole('button', { name: removeFor('Ada Okafor') }));
    await user.click(screen.getByRole('button', { name: 'Remove from conversation' }));

    expect(
      await screen.findByText('That conflicts with something that already exists.'),
    ).toBeInTheDocument();
    // And the dialog returns to the roster rather than stranding the admin on a
    // confirm step for a write that can no longer succeed.
    expect(screen.getByRole('button', { name: removeFor('Ada Okafor') })).toBeInTheDocument();
  });
});
