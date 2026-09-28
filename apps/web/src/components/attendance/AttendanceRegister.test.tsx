/**
 * Pins the Phase 5 register: the roster renders as one radio group per student,
 * switching dates refetches that date's register, Save sends ONE bulk PUT carrying
 * exactly the seats the teacher marked, and a 409 — the APPROVED roster moved
 * under us mid-marking — gets honest copy plus the refetch that fixes it.
 *
 * The component is mounted directly rather than through CourseDetailPage: the
 * policy gate lives in the page (`attendance:mark` with the course subject), and
 * what these tests pin is the register's own contract once it is on screen.
 *
 * Harness as in Notifications.test.tsx: network stubbed at `@/lib/api`. No session
 * seeding — the register itself never asks who the viewer is; the page has already
 * decided it may render.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AttendanceRegisterDto, AttendanceRegisterRow } from '@/lib/types';

type ApiFetch = (path: string, options?: unknown) => Promise<unknown>;
type ApiPut = (path: string, body?: unknown, options?: unknown) => Promise<unknown>;

const { apiGet, apiPut } = vi.hoisted(() => ({
  apiGet: vi.fn<ApiFetch>(),
  apiPut: vi.fn<ApiPut>(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: { get: apiGet, post: vi.fn(), patch: vi.fn(), put: apiPut, del: vi.fn() },
  };
});

// Imported after the mocks so the component resolves the stubbed client.
import { AttendanceRegister } from './AttendanceRegister.js';
import { ApiError } from '@/lib/problem';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** ULIDs — `idSchema` accepts a cuid or a ULID and nothing else. */
const COURSE_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCX';
const OFFERING_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD9';
const ENROLLMENT_A = '01JGXDFAM0K2Z1GYCSNM5F5RD1';
const ENROLLMENT_B = '01JGXDFAM0K2Z1GYCSNM5F5RD2';
const ENROLLMENT_C = '01JGXDFAM0K2Z1GYCSNM5F5RD3';
const MARKER_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCZ';

const MARKER = { id: MARKER_ID, name: 'Dana Okafor', role: 'TEACHER' as const, avatarUrl: null };

function row(
  overrides: Partial<AttendanceRegisterRow> & { enrollmentId: string },
): AttendanceRegisterRow {
  return {
    student: {
      id: overrides.enrollmentId,
      name: `Student ${overrides.enrollmentId.slice(-2)}`,
      role: 'STUDENT',
      avatarUrl: null,
    },
    status: null,
    note: null,
    markedBy: null,
    ...overrides,
  };
}

/**
 * The session's first date, derived exactly as the component derives it — its own
 * `todayISO()` decides what the first fetch carries, so the fixture has to read the
 * same LOCAL calendar rather than pin a literal. (A pinned `2026-08-24` silently
 * rotted the whole file the day the calendar moved on.)
 */
function todayISO(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

const TODAY = todayISO();

/** A fixed date that is never today, for the "another day" register below. */
const ANOTHER_DAY = '2001-01-01';

/**
 * What GET answers: three seats, one already marked, on ANY date — except the one
 * fixed ANOTHER_DAY, which returns a different intake slice so the refetch test can
 * prove the second answer really replaced the first.
 */
function registerFor(date: string): AttendanceRegisterDto {
  if (date === ANOTHER_DAY) {
    return {
      date,
      rows: [
        row({
          enrollmentId: ENROLLMENT_C,
          student: { id: 's-c', name: 'Cara Voss', role: 'STUDENT', avatarUrl: null },
        }),
      ],
    };
  }
  return {
    date,
    rows: [
      row({
        enrollmentId: ENROLLMENT_A,
        student: { id: 's-a', name: 'Ada Okafor', role: 'STUDENT', avatarUrl: null },
      }),
      row({
        enrollmentId: ENROLLMENT_B,
        student: { id: 's-b', name: 'Ben Ruiz', role: 'STUDENT', avatarUrl: null },
        status: 'LATE',
        note: 'Arrived 10 minutes late',
        markedBy: MARKER,
      }),
      row({
        enrollmentId: ENROLLMENT_C,
        student: { id: 's-c', name: 'Cara Voss', role: 'STUDENT', avatarUrl: null },
      }),
    ],
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockImplementation((path, options) => {
    if (path === `/courses/${COURSE_ID}/attendance`) {
      const query = (options ?? {}) as { query?: { date?: string; offeringId?: string } };
      return Promise.resolve(registerFor(query.query?.date ?? TODAY));
    }
    return Promise.resolve({});
  });
});

function renderRegister(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AttendanceRegister courseId={COURSE_ID} offeringId={OFFERING_ID} />
    </QueryClientProvider>,
  );
}

/** The date input's value IS the date every request below should carry. */
async function renderedDate(): Promise<string> {
  await screen.findByRole('group', { name: 'Attendance for Ada Okafor' });
  const input = screen.getByLabelText('Session date') as HTMLInputElement;
  expect(input.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  return input.value;
}

describe('AttendanceRegister — rendering', () => {
  it('fetches the register for ITS intake, naming the offering on every read', async () => {
    renderRegister();

    await screen.findByRole('group', { name: 'Attendance for Ada Okafor' });

    expect(apiGet).toHaveBeenCalledWith(`/courses/${COURSE_ID}/attendance`, {
      query: { offeringId: OFFERING_ID, date: await renderedDate() },
    });
  });

  it('renders one named radio group per seat on the APPROVED roster', async () => {
    renderRegister();

    const ada = await screen.findByRole('group', { name: 'Attendance for Ada Okafor' });
    screen.getByRole('group', { name: 'Attendance for Ben Ruiz' });
    screen.getByRole('group', { name: 'Attendance for Cara Voss' });

    for (const label of ['Present', 'Absent', 'Late']) {
      within(ada).getByRole('radio', { name: label });
    }
  });

  it('shows the loaded state for the date: marks, notes and who recorded them', async () => {
    renderRegister();

    await screen.findByRole('group', { name: 'Attendance for Ada Okafor' });

    // Ben's loaded record is visible independently of any draft choice.
    expect(screen.getByText('Recorded by Dana Okafor')).toBeInTheDocument();
    expect(screen.getByLabelText('Note for Ben Ruiz')).toHaveValue('Arrived 10 minutes late');

    // Unmarked seats say so rather than looking like an empty form nobody filled.
    expect(screen.getAllByText('Not marked')).toHaveLength(2);
  });

  it('seeds the draft from the server: an already-marked seat shows its radio checked', async () => {
    renderRegister();

    const ben = await screen.findByRole('group', { name: 'Attendance for Ben Ruiz' });
    expect(within(ben).getByRole('radio', { name: 'Late' })).toBeChecked();
    expect(within(ben).getByRole('radio', { name: 'Present' })).not.toBeChecked();
  });

  it('says when there is nobody to mark instead of rendering an empty save bar', async () => {
    apiGet.mockImplementation((_path, options) => {
      const query = (options ?? {}) as { query?: { date?: string } };
      return Promise.resolve({ date: query.query?.date ?? TODAY, rows: [] });
    });
    renderRegister();

    expect(await screen.findByText('No approved students yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save register/i })).toBeNull();
  });
});

describe('AttendanceRegister — marking and saving', () => {
  it('disables Save until at least one seat carries a mark', async () => {
    // An all-unmarked roster: the one state where saving would be a 422.
    apiGet.mockImplementation((_path, options) => {
      const query = (options ?? {}) as { query?: { date?: string } };
      return Promise.resolve({
        date: query.query?.date ?? TODAY,
        rows: [row({ enrollmentId: ENROLLMENT_A }), row({ enrollmentId: ENROLLMENT_B })],
      });
    });
    renderRegister();

    const save = await screen.findByRole('button', { name: /save register/i });
    expect(save).toBeDisabled();
    expect(screen.getByText(/0 of 2 marked/)).toBeInTheDocument();

    const ada = screen.getByRole('group', {
      name: `Attendance for Student ${ENROLLMENT_A.slice(-2)}`,
    });
    await userEvent.click(within(ada).getByRole('radio', { name: 'Present' }));

    expect(save).toBeEnabled();
  });

  it('counts up as radios turn, starting from what the server already recorded', async () => {
    renderRegister();

    const save = await screen.findByRole('button', { name: /save register/i });
    // Ben arrived pre-marked in the fixture: the loaded register IS the baseline.
    //
    // `findByText`, not `getByText`. The Save button and this counter are siblings,
    // but they do not settle together: the draft is seeded from the server in an
    // effect (AttendanceRegister.tsx:199-211), so the button's first render already
    // carries the roster while the count still reads "0 of 3". Awaiting the button
    // is therefore not awaiting the seeded count. The gap is one commit wide and
    // closes before the next line runs on an idle machine, which is why this read as
    // a pass in isolation and failed once under the full suite's load.
    expect(await screen.findByText(/1 of 3 marked/)).toBeInTheDocument();
    expect(save).toBeEnabled();

    const ada = screen.getByRole('group', { name: 'Attendance for Ada Okafor' });
    await userEvent.click(within(ada).getByRole('radio', { name: 'Present' }));

    expect(screen.getByText(/2 of 3 marked/)).toBeInTheDocument();
  });

  it('sends ONE bulk PUT carrying exactly the seats that were marked', async () => {
    apiPut.mockResolvedValue(registerFor(TODAY));
    renderRegister();

    const date = await renderedDate();

    // Mark two of three seats; leave Cara untouched.
    const ada = screen.getByRole('group', { name: 'Attendance for Ada Okafor' });
    await userEvent.click(within(ada).getByRole('radio', { name: 'Present' }));
    const ben = screen.getByRole('group', { name: 'Attendance for Ben Ruiz' });
    await userEvent.click(within(ben).getByRole('radio', { name: 'Present' }));

    // A note travels only on the seat it belongs to.
    await userEvent.type(
      screen.getByLabelText('Note for Ada Okafor'),
      'Left early for a certification exam',
    );

    await userEvent.click(screen.getByRole('button', { name: /save register/i }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    expect(apiPut).toHaveBeenCalledWith(`/courses/${COURSE_ID}/attendance`, {
      offeringId: OFFERING_ID,
      date,
      marks: [
        {
          enrollmentId: ENROLLMENT_A,
          status: 'PRESENT',
          note: 'Left early for a certification exam',
        },
        {
          // Ben was re-marked from Late to Present; the loaded note rides along
          // unchanged, which preserves it server-side exactly as omitting would.
          enrollmentId: ENROLLMENT_B,
          status: 'PRESENT',
          note: 'Arrived 10 minutes late',
        },
      ],
    });
    // ONE request, not one per row — the API is bulk because an instructor marks a class.
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  it('switching the date refetches THAT date and re-seats the form from its answer', async () => {
    renderRegister();

    await screen.findByRole('group', { name: 'Attendance for Ada Okafor' });

    fireEvent.change(screen.getByLabelText('Session date'), {
      target: { value: ANOTHER_DAY },
    });

    await waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith(`/courses/${COURSE_ID}/attendance`, {
        query: { offeringId: OFFERING_ID, date: ANOTHER_DAY },
      }),
    );
    // The other day's roster replaced this one's.
    expect(await screen.findByRole('group', { name: 'Attendance for Cara Voss' })).toBeVisible();
    expect(
      screen.queryByRole('group', { name: 'Attendance for Ada Okafor' }),
    ).not.toBeInTheDocument();
  });

  it('answers a 409 with honest copy and reloads when asked', async () => {
    apiPut.mockRejectedValueOnce(
      new ApiError({
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        code: 'CONFLICT',
        requestId: 'req-409',
      }),
    );
    renderRegister();

    await screen.findByRole('group', { name: 'Attendance for Ada Okafor' });
    const ada = screen.getByRole('group', { name: 'Attendance for Ada Okafor' });
    await userEvent.click(within(ada).getByRole('radio', { name: 'Present' }));
    await userEvent.click(screen.getByRole('button', { name: /save register/i }));

    // The panel says what happened AND what reloading costs — no pretend success.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/class list changed/i);

    await userEvent.click(screen.getByRole('button', { name: /load the current register/i }));
    await waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith(`/courses/${COURSE_ID}/attendance`, {
        query: { offeringId: OFFERING_ID, date: TODAY },
      }),
    );
    // Reloaded means usable again: the conflict panel is gone, the roster is back.
    expect(await screen.findByRole('group', { name: 'Attendance for Ada Okafor' })).toBeVisible();
    expect(screen.queryByText(/class list changed/i)).toBeNull();
  });

  it('does not mistake other failures for a roster conflict', async () => {
    apiPut.mockRejectedValueOnce(new Error('transport died'));
    renderRegister();

    await screen.findByRole('group', { name: 'Attendance for Ada Okafor' });
    const ada = screen.getByRole('group', { name: 'Attendance for Ada Okafor' });
    await userEvent.click(within(ada).getByRole('radio', { name: 'Present' }));
    await userEvent.click(screen.getByRole('button', { name: /save register/i }));

    // Rows stay put for correcting and retrying; no conflict panel appeared.
    await waitFor(() => expect(apiPut).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('group', { name: 'Attendance for Ada Okafor' })).toBeInTheDocument();
  });
});
