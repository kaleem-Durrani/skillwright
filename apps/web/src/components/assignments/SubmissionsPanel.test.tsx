/**
 * The teacher's grading side: the class list for ONE task, and the two outcomes.
 *
 * Three behaviours are worth pinning and none of them is about markup:
 *
 *   - the class list is not fetched until the teacher opens it. A teacher with thirty
 *     students and three tasks has ninety possible rows, and fetching them to render a
 *     list of three titles is ninety rows nobody asked for;
 *   - marking and returning are DIFFERENT URLs carrying one policy action, because a
 *     status column written by two URLs carries one audit action and the trail could
 *     not then tell "I marked this" from "I sent this back";
 *   - an ungraded hand-in shows a dash and not "0 / 100". A zero is a mark somebody
 *     gave, and a returned or unread hand-in has had none.
 */
import type { SessionUser } from '@/lib/session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AssignmentDto, AssignmentSubmissionRow } from '@skillwright/shared/schema';
import { qk } from '@/lib/query';

type ApiSend = (path: string, body?: unknown, options?: unknown) => Promise<unknown>;
type ApiFetch = (path: string, options?: unknown) => Promise<unknown>;

const { apiGet, apiPost } = vi.hoisted(() => ({
  apiGet: vi.fn<ApiFetch>(),
  apiPost: vi.fn<ApiSend>(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: { get: apiGet, post: apiPost, patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  };
});

import { Toaster } from '@/components/ui/Toast';
import { SubmissionsPanel } from './SubmissionsPanel.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ASSIGNMENT_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCX';
const SUBMISSION_ID = '01JGXDFAM0K2Z1GYCSNM5F5RE2';
const STUDENT_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD1';
const TEACHER_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD2';

const VIEWER: SessionUser = {
  id: TEACHER_ID,
  email: 'teacher@example.edu',
  name: 'Dana Okafor',
  role: 'TEACHER',
  status: 'ACTIVE',
  provenance: 'PASSWORD',
  avatarUrl: null,
  totpEnabled: false,
};

const ASSIGNMENT: AssignmentDto = {
  id: ASSIGNMENT_ID,
  offeringId: '01JGXDFAM0K2Z1GYCSNM5F5RD3',
  title: 'Weld the fillet',
  brief: 'Two runs of a 6mm fillet, all round.',
  dueAt: '2030-03-14T09:00:00.000Z',
  maxScore: 100,
  resourceId: null,
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-08-01T09:00:00.000Z',
};

function row(overrides: Partial<AssignmentSubmissionRow> = {}): AssignmentSubmissionRow {
  return {
    id: SUBMISSION_ID,
    assignmentId: ASSIGNMENT_ID,
    enrollmentId: '01JGXDFAM0K2Z1GYCSNM5F5RD4',
    status: 'SUBMITTED',
    attempt: 1,
    score: null,
    feedback: null,
    submittedAt: '2026-09-02T09:00:00.000Z',
    gradedAt: null,
    gradedBy: null,
    upload: {
      id: '01JGXDFAM0K2Z1GYCSNM5F5RD5',
      originalName: 'fillet-weld.pdf',
      contentType: 'application/pdf',
      sizeBytes: 2048,
    },
    createdAt: '2026-09-02T09:00:00.000Z',
    student: { id: STUDENT_ID, name: 'Ada Okafor', role: 'STUDENT', avatarUrl: null },
    offeringId: ASSIGNMENT.offeringId,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockResolvedValue({ data: [row()] });
  apiPost.mockResolvedValue({ id: SUBMISSION_ID, status: 'GRADED' });
});

function renderPanel(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(qk.session, { user: VIEWER });
  render(
    <QueryClientProvider client={client}>
      <SubmissionsPanel assignment={ASSIGNMENT} />
      <Toaster />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SubmissionsPanel — the class list', () => {
  it('fetches nothing until the teacher opens it', async () => {
    const user = userEvent.setup();
    renderPanel();

    const toggle = await screen.findByRole('button', { name: /show hand-ins/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(apiGet).not.toHaveBeenCalled();

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(1));
    expect(String(apiGet.mock.calls[0]?.[0])).toBe(`/assignments/${ASSIGNMENT_ID}/submissions`);
  });

  it('shows a dash, never a zero, for a hand-in nobody has marked', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole('button', { name: /show hand-ins/i }));

    expect(await screen.findByText('Ada Okafor')).toBeInTheDocument();
    // "0 / 100", or a bare 0, would tell a teacher a student scored nothing when nobody
    // has read the work yet. The score is `number | null` on the wire precisely so this
    // rendering can say nothing at all.
    expect(screen.queryByText(/0 \/ 100/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^0$/)).not.toBeInTheDocument();
  });

  it('says so when nobody has handed in at all', async () => {
    apiGet.mockResolvedValue({ data: [] });
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole('button', { name: /show hand-ins/i }));

    expect(await screen.findByText('Nobody has handed in yet')).toBeInTheDocument();
  });
});

describe('SubmissionsPanel — recording a verdict', () => {
  it('sends the mark and the comment to the grade route', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole('button', { name: /show hand-ins/i }));
    await user.click(await screen.findByRole('button', { name: 'Mark' }));

    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^mark/i), '62.5');
    await user.type(
      within(dialog).getByLabelText(/feedback/i),
      'Good root, a little proud on the third leg.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Record mark' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    const [path, body] = apiPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe(`/submissions/${SUBMISSION_ID}/grade`);
    // A half mark is sent as a number, which is why the column is a Decimal and not an
    // integer: 62.5 is a real thing to give a student.
    expect(body).toEqual({
      score: 62.5,
      feedback: 'Good root, a little proud on the third leg.',
    });
  });

  it('refuses to return work with no reason, and sends NO mark when it does', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole('button', { name: /show hand-ins/i }));
    await user.click(await screen.findByRole('button', { name: 'Mark' }));

    const dialog = await screen.findByRole('dialog');
    // The API's `returnSubmissionSchema` requires feedback, so the button that would be
    // answered 422 is disabled rather than sent.
    expect(within(dialog).getByRole('button', { name: /return for another go/i })).toBeDisabled();

    await user.type(
      within(dialog).getByLabelText(/feedback/i),
      'Undercut on two passes — run it again with the guide rail.',
    );
    await user.click(within(dialog).getByRole('button', { name: /return for another go/i }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    const [path, body] = apiPost.mock.calls[0] as [string, Record<string, unknown>];
    // A different URL from the mark, so the audit trail can tell them apart — and no
    // `score` key at all, because a RETURNED row is not counted.
    expect(path).toBe(`/submissions/${SUBMISSION_ID}/return`);
    expect(body).toEqual({
      feedback: 'Undercut on two passes — run it again with the guide rail.',
    });
    expect('score' in (body ?? {})).toBe(false);
  });

  it('opens a fresh dialog for the next student, holding nothing of the last', async () => {
    apiGet.mockResolvedValue({
      data: [
        row(),
        {
          ...row({ id: '01JGXDFAM0K2Z1GYCSNM5F5RE9' }),
          student: { id: STUDENT_ID, name: 'Bo Mensah', role: 'STUDENT', avatarUrl: null },
        },
      ],
    });
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole('button', { name: /show hand-ins/i }));

    const [firstMark] = await screen.findAllByRole('button', { name: 'Mark' });
    await user.click(firstMark as HTMLElement);
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^mark/i), '90');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const remaining = await screen.findAllByRole('button', { name: 'Mark' });
    await user.click(remaining[1] as HTMLElement);
    const reopened = await screen.findByRole('dialog');
    // The boxes are remounted per hand-in by `key`, so the second student does not
    // inherit the first one's 90.
    expect(within(reopened).getByLabelText(/^mark/i)).toHaveValue('');
  });
});
