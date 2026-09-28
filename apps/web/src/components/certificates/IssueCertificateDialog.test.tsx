/**
 * Issuing a certificate, and the three things the dialog is responsible for.
 *
 *   - It is ONE choice, fetched from the catalogue when it OPENS. A school with no
 *     catalogue is told so, in the dialog, rather than being handed a select with a
 *     single empty option and an enabled button that fails on submit for a reason the
 *     person cannot see.
 *
 *   - It posts the SEAT, not the student. The row it was opened from already says who
 *     finished what; the body carries `{ enrollmentId, qualificationId }` and nothing
 *     else, because a second source for one id is a second thing that can disagree.
 *
 *   - A 409 is named. The SPA renders `problem.code` and never `problem.detail`
 *     (LESSONS-LEARNED #25), so the two refusals this route can make — the seat is not
 *     COMPLETED, or this standard is already on it — collapse into one generic sentence
 *     unless the client supplies its own. It does, because this screen is the only
 *     place that knows which of the two it was.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/lib/problem';
import type { QualificationDto } from '@skillwright/shared/schema';

type ApiGet = (path: string, options?: unknown) => Promise<unknown>;
type ApiPost = (path: string, body?: unknown, options?: unknown) => Promise<unknown>;

const { apiGet, apiPost } = vi.hoisted(() => ({
  apiGet: vi.fn<ApiGet>(),
  apiPost: vi.fn<ApiPost>(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: { get: apiGet, post: apiPost, patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  };
});

import { Toaster } from '@/components/ui/Toast';
import { IssueCertificateDialog } from './IssueCertificateDialog';

const ENROLLMENT_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD4';
const CATALOGUE: QualificationDto[] = [
  {
    id: 'q-1',
    code: 'cswip-31',
    name: 'CSWIP 3.1 Welding Inspector',
    level: '3',
    awardingBody: 'BSI',
  },
  { id: 'q-2', code: 'fgas-cat-i', name: 'F-Gas Category I', level: 'I', awardingBody: 'CITB' },
];

beforeAll(() => {
  // jsdom implements none of the pointer-capture API, which Radix's Select calls while
  // deciding whether a pointer gesture is a click or a drag. The same three lines
  // `SubmissionDialog.test.tsx` carries, for the same reason.
  for (const name of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture']) {
    Object.defineProperty(Element.prototype, name, {
      value: () => false,
      writable: true,
      configurable: true,
    });
  }
});

/**
 * Open a Radix select and take one option, by KEYBOARD rather than by pointer.
 *
 * The keyboard path is the honest one for a test that only cares which value was
 * chosen: `trigger.focus()` then `{Enter}` is what a keyboard user does, it exercises
 * the same `onValueChange` the pointer path reaches, and it needs no pointer-event
 * emulation that jsdom would have to be taught. `CourseFormDialog.test.tsx` has the
 * identical helper.
 */
async function chooseOption(
  user: UserEvent,
  dialog: HTMLElement,
  name: string,
  label: string | RegExp,
): Promise<void> {
  const trigger = within(dialog).getByRole('combobox', { name });
  // The trigger is disabled while the catalogue is in flight — deliberately, so nobody
  // can open an empty list — which means a test that clicks before the query settles
  // is testing a disabled button rather than a select.
  await waitFor(() => expect(trigger).toBeEnabled());
  trigger.focus();
  await user.keyboard('{Enter}');
  const option = await screen.findByRole('option', { name: label });
  await user.click(option);
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
}

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockResolvedValue(CATALOGUE);
  apiPost.mockResolvedValue({ id: 'cert-1', reference: '9F2A7C4B1D6E8A035C7B9D2E4K6P' });
});

function renderDialog(open = true): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <IssueCertificateDialog
        open={open}
        onOpenChange={vi.fn()}
        enrollmentId={ENROLLMENT_ID}
        studentName="Ada Okafor"
        courseName="Welding Fundamentals 1"
      />
      <Toaster />
    </QueryClientProvider>,
  );
}

describe('IssueCertificateDialog', () => {
  it('fetches nothing until it opens, and names the student and the course', async () => {
    renderDialog(false);
    expect(apiGet).not.toHaveBeenCalled();

    renderDialog(true);
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(/Ada Okafor completed Welding Fundamentals 1/),
    ).toBeInTheDocument();
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/qualifications'));
  });

  it('posts the seat and the chosen standard, and nothing else', async () => {
    const user = userEvent.setup();
    renderDialog();

    const dialog = await screen.findByRole('dialog');
    await chooseOption(user, dialog, 'Qualification', /CSWIP 3.1 Welding Inspector/);
    await user.click(within(dialog).getByRole('button', { name: 'Issue certificate' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    // The path carries the seat, the body carries the standard, and neither carries a
    // student id or a date — the API dates it and the API owns the seat.
    expect(apiPost.mock.calls[0]?.[0]).toBe('/certificates');
    expect(apiPost.mock.calls[0]?.[1]).toEqual({
      enrollmentId: ENROLLMENT_ID,
      qualificationId: 'q-1',
    });
  });

  it('refuses to submit with nothing chosen, and says which field is empty', async () => {
    const user = userEvent.setup();
    renderDialog();

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    await user.click(within(dialog).getByRole('button', { name: 'Issue certificate' }));

    expect(apiPost).not.toHaveBeenCalled();
    expect(await screen.findByText('Choose the qualification being awarded.')).toBeInTheDocument();
  });

  it('says so when the school has recorded no qualifications at all', async () => {
    apiGet.mockResolvedValue([]);
    renderDialog();

    const dialog = await screen.findByRole('dialog');
    // Not an error, and not a select with one empty option: the button is DISABLED and
    // the reason is on screen, so the person is never told a request failed for
    // something they could not see.
    expect(await screen.findByText('No qualifications in the catalogue')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Issue certificate' })).toBeDisabled();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('names both refusals a 409 can mean, because the SPA never renders the detail', async () => {
    const user = userEvent.setup();
    apiPost.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Conflicting state',
        status: 409,
        code: 'CONFLICT',
        requestId: 'req-1',
        detail: 'This seat has already been awarded CSWIP 3.1 Welding Inspector.',
      }),
    );
    renderDialog();

    const dialog = await screen.findByRole('dialog');
    await chooseOption(user, dialog, 'Qualification', /CSWIP 3.1 Welding Inspector/);
    await user.click(within(dialog).getByRole('button', { name: 'Issue certificate' }));

    // `findByText` rather than `getByText`: the copy appears in the toast AND in the
    // live region Radix mounts beside it, and both are on screen. One assertion that
    // there is at least one, which is what a person needs to see.
    expect(
      await screen.findAllByText(/Either the enrolment is not completed yet/),
    ).not.toHaveLength(0);
    expect(screen.getAllByText('That seat cannot take that certificate').length).toBeGreaterThan(0);
    // The service's own `detail` — which names the standard — is diagnostics and is
    // never rendered. That is the rule, and this is the assertion for it.
    expect(screen.queryByText(/already been awarded CSWIP/)).not.toBeInTheDocument();
  });

  it('states that it cannot be undone from this screen, before the button is pressed', async () => {
    renderDialog();
    const dialog = await screen.findByRole('dialog');
    // `certificate:revoke` is an ADMIN verb and issuing is irreversible here, so the
    // one unrecoverable act in this module says so above the button rather than
    // apologising afterwards.
    expect(within(dialog).getByText(/An admin can revoke it later/)).toBeInTheDocument();
  });
});
