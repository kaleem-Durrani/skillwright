/**
 * The cohort import's CONTRACT, in the shape UserCreateDialog.test.tsx uses:
 * queries a person could make, and the network stubbed at the one client this SPA
 * talks through.
 *
 * What THIS file exists to pin, and each item is a decision the API made and the
 * dialog has to keep:
 *
 * - THE DRY RUN IS THE FIRST ACTION. "Check this file" is offered before anything
 *   irreversible, and the import button is REFUSED until a check for the text
 *   currently in the box has come back clean. There is no path to the create
 *   button that skips it.
 * - AN EDIT INVALIDATES THE CHECK. The count on the button is the only thing
 *   telling an admin which file they are about to import, so a stale check would
 *   be worse than no check.
 * - ROWS THAT DO NOT PARSE ARE NOT SENT. The local parse runs the SHARED
 *   `createUserSchema`, so the messages on screen are the server's own rules and
 *   not a second opinion, and a partly-invalid file produces no request at all.
 * - FAILURES COME BACK WITH ONE-BASED ROW NUMBERS, because the person fixing the
 *   file is looking at a spreadsheet whose first row is row 1.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BULK_IMPORT_MAX_ROWS } from '@skillwright/shared/schema';
import { ApiError } from '@/lib/problem';

type ApiSend = (path: string, body?: unknown, options?: unknown) => Promise<unknown>;
type ApiFetch = (path: string, options?: unknown) => Promise<unknown>;

const { apiGet, apiPost, toastMock } = vi.hoisted(() => ({
  apiGet: vi.fn<ApiFetch>(),
  apiPost: vi.fn<ApiSend>(),
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
    api: { get: apiGet, post: apiPost, patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  };
});

vi.mock('@/components/ui/Toast', () => ({ toast: toastMock }));

// Imported after the mocks so the component resolves the stubbed client.
import { UserBulkImportDialog } from './UserBulkImportDialog.js';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const DEPARTMENT_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCY';

const TWO_GOOD_ROWS = [
  `dana.okafor@example.edu, Dana Okafor, STUDENT, ${DEPARTMENT_ID}`,
  `sam.reed@example.edu, Sam Reed, STUDENT, ${DEPARTMENT_ID}`,
].join('\n');

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockResolvedValue({});
  apiPost.mockResolvedValue({ created: [], failed: [], dryRun: true });
});

function renderDialog(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <UserBulkImportDialog open onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
}

/**
 * `fireEvent.change` rather than `userEvent.paste` or `type`.
 *
 * A cohort is sixty LINES of text, and both of those drive one keystroke per
 * character through a debounced user-event loop — a test that takes a minute and
 * times out on the biggest case. `fireEvent.change` sets the value in one event,
 * which is what a paste into a real browser does anyway, and the "editing after a
 * check invalidates it" test is only meaningful if the edit is a single event
 * rather than sixty.
 */
async function paste(_user: UserEvent, text: string): Promise<void> {
  const box = await screen.findByRole('textbox', { name: /cohort rows/i });
  fireEvent.change(box, { target: { value: text } });
}

/**
 * `findByRole`, not `getByRole`, and that is not a style preference. The button's
 * LABEL is the row count, so it does not exist under the name a test looks for
 * until the box has been parsed and React has re-rendered — a synchronous `get`
 * would read the pre-paint DOM and fail on a component that is working.
 */
const importButton = (): Promise<HTMLElement> =>
  screen.findByRole('button', { name: /create \d+ accounts?/i });
const checkButton = (): HTMLElement => screen.getByRole('button', { name: /check this file/i });

// ---------------------------------------------------------------------------

describe('UserBulkImportDialog — the dry run comes first', () => {
  it('opens with nothing importable and no check enabled', async () => {
    renderDialog();

    expect(await screen.findByRole('heading', { name: /import cohort/i })).toBeInTheDocument();
    expect(checkButton()).toBeDisabled();
    // The irreversible action is not merely deprioritised — it is UNREACHABLE
    // until a check for the current text has come back clean.
    expect(screen.getByRole('button', { name: /create accounts/i })).toBeDisabled();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('a clean check says nothing was created, and unlocks the create button', async () => {
    const user = userEvent.setup();
    renderDialog();
    await paste(user, TWO_GOOD_ROWS);

    expect(checkButton()).toBeEnabled();
    await user.click(checkButton());

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    // The DRY RUN FLAG IS ASSERTED LITERALLY. This is the assertion that stops a
    // later edit from quietly turning the first button into the second one.
    expect(apiPost).toHaveBeenCalledWith('/users/bulk', {
      rows: [
        {
          email: 'dana.okafor@example.edu',
          name: 'Dana Okafor',
          role: 'STUDENT',
          departmentId: DEPARTMENT_ID,
        },
        {
          email: 'sam.reed@example.edu',
          name: 'Sam Reed',
          role: 'STUDENT',
          departmentId: DEPARTMENT_ID,
        },
      ],
      dryRun: true,
    });

    expect(await screen.findByText(/every row is valid/i)).toBeInTheDocument();
    // "Nothing has been created yet" is the sentence, because it is the fact.
    expect(screen.getByText(/nothing has been created yet/i)).toBeInTheDocument();
    expect(await importButton()).toBeEnabled();
    expect(await importButton()).toHaveTextContent('Create 2 accounts');
  });

  it('a check that found problems is a SUCCESSFUL check, and does not unlock create', async () => {
    const user = userEvent.setup();
    apiPost.mockResolvedValue({
      created: [],
      failed: [{ row: 2, code: 'CONFLICT', detail: 'An account with this email already exists' }],
      dryRun: true,
    });
    renderDialog();
    await paste(user, TWO_GOOD_ROWS);
    await user.click(checkButton());

    // The failures table, with ONE-BASED row numbers.
    const table = await screen.findByRole('table', { name: /rows that could not be imported/i });
    expect(within(table).getByText('2')).toBeInTheDocument();
    expect(within(table).getByText('CONFLICT')).toBeInTheDocument();
    expect(
      within(table).getByText('An account with this email already exists'),
    ).toBeInTheDocument();

    // Refused: a check that found problems has not cleared the file.
    expect(await importButton()).toBeDisabled();
    // And no error toast — saying otherwise would teach people the dry run is
    // something to avoid running.
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('editing after a check invalidates it, because the count names the file', async () => {
    const user = userEvent.setup();
    renderDialog();
    await paste(user, TWO_GOOD_ROWS);
    await user.click(checkButton());
    expect(await importButton()).toBeEnabled();

    // One more person lands in the box. The previous check said nothing about
    // THIS file, and the button's own count is the only thing telling the admin
    // which file they are about to write.
    await paste(
      user,
      `${TWO_GOOD_ROWS}\njo.blogs@example.edu, Jo Blogs, STUDENT, ${DEPARTMENT_ID}`,
    );

    const stale = await importButton();
    await waitFor(() => expect(stale).toBeDisabled());
    expect(await importButton()).toHaveTextContent('Create 3 accounts');
  });

  it('the real import posts dryRun: false and reports what landed', async () => {
    const user = userEvent.setup();
    apiPost.mockResolvedValueOnce({ created: [], failed: [], dryRun: true }).mockResolvedValueOnce({
      created: [
        {
          id: '01JGXDFAM0K2Z1GYCSNM5F5RD1',
          email: 'dana.okafor@example.edu',
          name: 'Dana Okafor',
          role: 'STUDENT',
        },
        {
          id: '01JGXDFAM0K2Z1GYCSNM5F5RD2',
          email: 'sam.reed@example.edu',
          name: 'Sam Reed',
          role: 'STUDENT',
        },
      ],
      failed: [],
      dryRun: false,
    });
    renderDialog();
    await paste(user, TWO_GOOD_ROWS);
    await user.click(checkButton());
    await user.click(await importButton());

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2));
    expect(apiPost.mock.calls[1]?.[1]).toMatchObject({ dryRun: false });
    expect(toastMock.success).toHaveBeenCalledWith(
      '2 accounts created',
      expect.objectContaining({ description: expect.stringContaining('Forgot password') }),
    );
  });

  it('a partly-failed real import says the OTHER rows landed', async () => {
    const user = userEvent.setup();
    apiPost.mockResolvedValueOnce({ created: [], failed: [], dryRun: true }).mockResolvedValueOnce({
      created: [
        {
          id: '01JGXDFAM0K2Z1GYCSNM5F5RD1',
          email: 'dana.okafor@example.edu',
          name: 'Dana',
          role: 'STUDENT',
        },
      ],
      failed: [{ row: 2, code: 'CONFLICT', detail: 'Already exists' }],
      dryRun: false,
    });
    renderDialog();
    await paste(user, TWO_GOOD_ROWS);
    await user.click(checkButton());
    await user.click(await importButton());

    // The per-row result is the whole feature: 56 of 60 landing is a success the
    // admin needs told about plainly, not an error.
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith(
        '1 account created',
        expect.objectContaining({
          description: expect.stringContaining('1 row could not be imported'),
        }),
      ),
    );
  });
});

describe('UserBulkImportDialog — rows that cannot be read', () => {
  it('shows the schema’s own message and sends NOTHING', async () => {
    const user = userEvent.setup();
    renderDialog();
    // No department: `createUserSchema`'s superRefine refuses it, and the message
    // below is the SCHEMA's, not a local restatement of it.
    await paste(user, 'dana.okafor@example.edu, Dana Okafor, STUDENT');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/1 row could not be read/i);
    expect(alert).toHaveTextContent(/must belong to a department/i);
    expect(checkButton()).toBeDisabled();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('names the ROW, one-based', async () => {
    const user = userEvent.setup();
    renderDialog();
    await paste(
      user,
      [
        `dana.okafor@example.edu, Dana, STUDENT, ${DEPARTMENT_ID}`,
        'bad-row',
        `sam.reed@example.edu, Sam, STUDENT, ${DEPARTMENT_ID}`,
      ].join('\n'),
    );

    const table = await screen.findByRole('table', { name: /rows that could not be read/i });
    // Row 2 of the file, which is the SECOND line — a zero-based index would say 1
    // and send the admin one line up.
    expect(within(table).getByText('2')).toBeInTheDocument();
  });

  it('refuses a file over the cap, in the client, naming the shared limit', async () => {
    const user = userEvent.setup();
    renderDialog();
    const rows = Array.from(
      { length: BULK_IMPORT_MAX_ROWS + 1 },
      (_, i) => `person${i}@example.edu, Person ${i}, STUDENT, ${DEPARTMENT_ID}`,
    ).join('\n');
    await paste(user, rows);

    expect(
      await screen.findByText(new RegExp(`over the limit of ${BULK_IMPORT_MAX_ROWS}`)),
    ).toBeInTheDocument();
    expect(checkButton()).toBeDisabled();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('a teacher row’s fifth column becomes their qualification', async () => {
    const user = userEvent.setup();
    renderDialog();
    await paste(user, `nina.patel@example.edu, Nina Patel, TEACHER, ${DEPARTMENT_ID}, CSWIP 3.1`);
    await user.click(checkButton());

    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    expect(apiPost.mock.calls[0]?.[1]).toMatchObject({
      rows: [{ role: 'TEACHER', qualification: 'CSWIP 3.1' }],
    });
  });
});

describe('UserBulkImportDialog — failures are reported, not thrown', () => {
  it('renders the problem code, never the detail, in the toast', async () => {
    const user = userEvent.setup();
    apiPost.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Too many requests',
        status: 429,
        code: 'RATE_LIMITED',
        requestId: 'req-1',
      }),
    );
    renderDialog();
    await paste(user, TWO_GOOD_ROWS);
    await user.click(checkButton());

    // LESSON 25: `problem.code` is the whole contract, and `detail` is a comment
    // for developers. `toast.fromError` is the function that enforces it.
    await waitFor(() => expect(toastMock.fromError).toHaveBeenCalled());
    expect(toastMock.fromError.mock.calls[0]?.[1]).toBe('Could not import that cohort');
    // And the dialog stays open so the text is not lost — a person who has just
    // typed sixty rows should not have to do it again.
    expect(screen.getByRole('heading', { name: /import cohort/i })).toBeInTheDocument();
  });
});
