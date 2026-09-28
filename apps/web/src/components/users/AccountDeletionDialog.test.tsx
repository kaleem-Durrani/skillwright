/**
 * The account-deletion dialog's CONTRACT.
 *
 * What this file exists to pin, and each item is a decision the API made:
 *
 * - THE CONFIRMATION IS THE CALLER'S OWN EMAIL ADDRESS, and the button stays
 *   refused until it matches. A checkbox is one accidental tap, and this is the one
 *   irreversible-feeling action in a person's account.
 * - THE PENDING STATE IS A DIFFERENT DIALOG. Once a deletion is scheduled, the
 *   dialog offers the UNDO and says the date, because "your account has been
 *   deleted" is the sentence somebody remembers about this product.
 * - THE EXPORT IS OFFERED BEFORE THE CONFIRMATION. The two features are one
 *   decision, and a person who is told to take their data somewhere else takes it
 *   afterwards — or not at all.
 * - A REFUSAL RENDERS THE CODE. `problem.code` is the whole contract (lesson 25)
 *   and `detail` is a comment for developers.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { qk } from '@/lib/query';
import type { SessionUser } from '@/lib/session';
import { ApiError } from '@/lib/problem';

type ApiSend = (path: string, body?: unknown, options?: unknown) => Promise<unknown>;
type ApiFetch = (path: string, options?: unknown) => Promise<unknown>;
type ApiDelete = (path: string, options?: unknown) => Promise<unknown>;

const { apiGet, apiPost, apiDel, toastMock } = vi.hoisted(() => ({
  apiGet: vi.fn<ApiFetch>(),
  apiPost: vi.fn<ApiSend>(),
  apiDel: vi.fn<ApiDelete>(),
  toastMock: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    fromError: vi.fn(),
  }),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: { get: apiGet, post: apiPost, patch: vi.fn(), put: vi.fn(), del: apiDel },
  };
});

vi.mock('@/components/ui/Toast', () => ({ toast: toastMock }));

// Imported after the mocks so the component resolves the stubbed client.
import { AccountDeletionDialog } from './AccountDeletionDialog.js';

const EMAIL = 'sam.reed@example.edu';

function viewer(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: '01JGXDFAM0K2Z1GYCSNM5F5RCX',
    email: EMAIL,
    name: 'Sam Reed',
    role: 'STUDENT',
    status: 'ACTIVE',
    provenance: 'PASSWORD',
    avatarUrl: null,
    totpEnabled: false,
    ...overrides,
  };
}

const NO_PENDING = { deletionRequestedAt: null, deletionEffectiveFor: null, cancellable: false };

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockResolvedValue(NO_PENDING);
  apiPost.mockResolvedValue({
    deletionRequestedAt: '2026-09-01T10:00:00.000Z',
    deletionEffectiveFor: '2026-10-01T10:00:00.000Z',
    cancellable: true,
  });
  apiDel.mockResolvedValue(NO_PENDING);
});

function renderDialog(session: SessionUser = viewer()): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(qk.session, { user: session });
  render(
    <QueryClientProvider client={client}>
      <AccountDeletionDialog open onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe('AccountDeletionDialog — confirming', () => {
  it('states the cool-off before anything irreversible is on screen', async () => {
    renderDialog();

    expect(
      await screen.findByRole('heading', { name: /delete your account/i }),
    ).toBeInTheDocument();
    // Thirty days, from the SHARED constant. A number written twice in two
    // packages is a number that drifts, and this one is the deadline.
    expect(screen.getByText(/nothing happens for 30 days/i)).toBeInTheDocument();
  });

  it('offers the export BEFORE the confirmation, in the same dialog', async () => {
    renderDialog();

    // A person asking to be deleted is, nine times in ten, a person exercising a
    // right to take their data with them. Making them find it elsewhere means the
    // export is written after the account is gone.
    const link = await screen.findByRole('link', {
      name: /download everything we hold about you/i,
    });
    expect(link).toHaveAttribute('href', '/api/v1/users/me/export');
    // A plain anchor, not a fetch: this returns a file the browser should save,
    // and routing it through `lib/api` would mean a blob: URL with no filename.
    expect(link).toHaveAttribute('download');
  });

  it('refuses to schedule until the typed address matches, case-insensitively', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(await screen.findByRole('button', { name: /delete my account/i }));

    const confirm = await screen.findByRole('button', { name: /schedule deletion/i });
    expect(confirm).toBeDisabled();

    const box = screen.getByRole('textbox', { name: /type your email address to confirm/i });
    await user.type(box, 'someone@else.com');
    expect(confirm).toBeDisabled();
    expect(apiPost).not.toHaveBeenCalled();

    // Citext: a person who typed their address with different capitalisation HAS
    // typed their address, and refusing them for it teaches people the
    // confirmation is a trap.
    await user.clear(box);
    await user.type(box, 'SAM.REED@EXAMPLE.EDU');
    await waitFor(() => expect(confirm).toBeEnabled());
  });

  it('posts the confirmation to the server, which is where the rule actually lives', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(await screen.findByRole('button', { name: /delete my account/i }));
    await user.type(
      screen.getByRole('textbox', { name: /type your email address to confirm/i }),
      EMAIL,
    );
    await user.click(await screen.findByRole('button', { name: /schedule deletion/i }));

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/users/me/deletion', { confirmEmail: EMAIL }),
    );
  });

  it('says SCHEDULED, with the date and the way back — not "deleted"', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(await screen.findByRole('button', { name: /delete my account/i }));
    await user.type(
      screen.getByRole('textbox', { name: /type your email address to confirm/i }),
      EMAIL,
    );
    await user.click(await screen.findByRole('button', { name: /schedule deletion/i }));

    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
    const [headline, options] = toastMock.success.mock.calls[0] as [
      string,
      { description: string },
    ];
    // The word is asserted because the wrong one is the failure: "your account has
    // been deleted" is the sentence somebody remembers about this product, and
    // they would discover the undo they were never told about a month later.
    expect(headline).toBe('Deletion scheduled');
    expect(options.description).toMatch(/cancel any time before then/i);
  });

  it('renders the problem CODE on a refusal, never the detail', async () => {
    const user = userEvent.setup();
    apiPost.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Request validation failed',
        status: 422,
        code: 'VALIDATION_FAILED',
        detail: 'Type your full email address to confirm. (rule: nobody:readsThis)',
        requestId: 'req-1',
      }),
    );
    renderDialog();
    await user.click(await screen.findByRole('button', { name: /delete my account/i }));
    await user.type(
      screen.getByRole('textbox', { name: /type your email address to confirm/i }),
      EMAIL,
    );
    await user.click(await screen.findByRole('button', { name: /schedule deletion/i }));

    // LESSON 25: the SPA maps CODE to copy; a hand-written `detail` is invisible.
    await waitFor(() => expect(toastMock.fromError).toHaveBeenCalled());
    expect(toastMock.fromError.mock.calls[0]?.[1]).toBe('Could not schedule that deletion');
  });
});

describe('AccountDeletionDialog — once a deletion is scheduled', () => {
  beforeEach(() => {
    apiGet.mockResolvedValue({
      deletionRequestedAt: '2026-09-01T10:00:00.000Z',
      deletionEffectiveFor: '2026-10-01T10:00:00.000Z',
      cancellable: true,
    });
  });

  it('offers the UNDO, and says what is kept and what is not', async () => {
    renderDialog();

    expect(
      await screen.findByRole('heading', { name: /your deletion is scheduled/i }),
    ).toBeInTheDocument();
    // The honest sentence about enrolments. A school that deleted a qualification
    // with the person would be worse off than one holding a dormant row, and
    // saying so here is what stops the next support ticket asking.
    expect(
      screen.getByText(/your enrolments, attendance and qualifications are kept/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /keep my account/i })).toBeInTheDocument();
  });

  it('the undo deletes the pending request, and confirms plainly', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(await screen.findByRole('button', { name: /keep my account/i }));
    await waitFor(() => expect(apiDel).toHaveBeenCalledWith('/users/me/deletion'));
    expect(toastMock.success).toHaveBeenCalledWith(
      'Deletion cancelled',
      expect.objectContaining({ description: 'Your account is untouched.' }),
    );
  });

  it('does not offer a SECOND schedule button — the request is already made', async () => {
    renderDialog();

    expect(
      await screen.findByRole('heading', { name: /your deletion is scheduled/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /schedule deletion/i })).toBeNull();
    expect(screen.queryByRole('textbox', { name: /confirm/i })).toBeNull();
  });
});

describe('AccountDeletionDialog — the same for an admin', () => {
  it('offers it, because user:delete is isSelf for ADMIN too', async () => {
    // `user:update` gives ADMIN a bare `allow` and a reader would expect the same
    // here. It is deliberately not: an administrator who needs somebody gone has
    // `user:suspend`, which is reversible and leaves the enrolment record intact.
    // This verb ends the account, so it stays self-only.
    renderDialog(viewer({ role: 'ADMIN', name: 'Ada Admin' }));

    expect(await screen.findByRole('button', { name: /delete my account/i })).toBeInTheDocument();
  });
});
