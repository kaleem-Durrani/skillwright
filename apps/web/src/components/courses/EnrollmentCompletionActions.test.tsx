/**
 * Phase 1's row actions, driven directly so the `Gate` is actually asked.
 *
 * The page-level pins in `CourseDetail.test.tsx` prove the verbs POST to the right
 * URL and that a COMPLETED row reads as terminal. What they cannot prove is a
 * DENIAL: for a non-owning teacher the whole Students tab is absent
 * (`enrollment:read` is `ownsCourse`), so the row actions are never mounted and
 * their absence says nothing about the gate that would have refused them. These
 * render the component with the roster a colleague's course would serve, which is
 * the only way to reach the gate.
 *
 * The subject is the load-bearing part of the whole file, so the mutations that
 * matter are the ones that corrupt it: a spread instead of named fields, or
 * `teacher.id` where `courseTeacherId` is what `ownsCourse` reads. Either would
 * deny the OWNING teacher too — silently, with no type error, which is the shape
 * LESSONS-LEARNED #18 and #31 both describe.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { formatDate } from '@/lib/format';
import { qk } from '@/lib/query';
import type { SessionUser } from '@/lib/session';
import type { CourseDetail, EnrollmentDto } from '@/lib/types';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, Link: ({ children }: { children?: unknown }) => <>{children}</> };
});

import { CompletionStamp, EnrollmentCompletionActions } from './EnrollmentCompletionActions';

const COURSE_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCX';
const DEPARTMENT_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCY';
const TEACHER_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCZ';
const OTHER_TEACHER_ID = '01JGXDFAM0K2Z1GYCSNM5F5RE9';
const STUDENT_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD1';
const OFFERING_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD7';
const ENROLLMENT_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD3';
const COMPLETED_AT = '2026-09-20T09:00:00.000Z';
const DECIDED_AT = '2026-08-02T09:00:00.000Z';

const TEACHER: SessionUser = {
  id: TEACHER_ID,
  email: 'dana@example.edu',
  name: 'Dana Okafor',
  role: 'TEACHER',
  status: 'ACTIVE',
  provenance: 'PASSWORD',
  avatarUrl: null,
  totpEnabled: false,
};

const course: CourseDetail = {
  id: COURSE_ID,
  code: 'WELD-101',
  slug: 'welding-fundamentals',
  name: 'Welding Fundamentals',
  description: null,
  department: { id: DEPARTMENT_ID, name: 'Welding', slug: 'welding' },
  teacher: { id: TEACHER_ID, name: 'Dana Okafor', role: 'TEACHER', avatarUrl: null },
  duration: { value: 6, unit: 'WEEK' },
  publishedAt: '2026-08-01T09:00:00.000Z',
  syllabusUploadId: null,
  syllabusUrl: null,
  resourceCount: 0,
  prerequisiteCourseId: null,
  prerequisite: null,
  offerings: [],
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-08-01T09:00:00.000Z',
};

function row(overrides: Partial<EnrollmentDto> = {}): EnrollmentDto {
  return {
    id: ENROLLMENT_ID,
    status: 'APPROVED',
    requestedAt: '2026-08-01T09:00:00.000Z',
    decidedAt: DECIDED_AT,
    decidedBy: null,
    decisionNote: null,
    completedAt: null,
    completedBy: null,
    student: { id: STUDENT_ID, name: 'Ada Okafor', role: 'STUDENT', avatarUrl: null },
    course: {
      id: COURSE_ID,
      code: 'WELD-101',
      slug: 'welding-fundamentals',
      name: 'Welding Fundamentals',
      department: { id: DEPARTMENT_ID, name: 'Welding', slug: 'welding' },
      teacher: { id: TEACHER_ID, name: 'Dana Okafor', role: 'TEACHER', avatarUrl: null },
      duration: { value: 6, unit: 'WEEK' },
      publishedAt: '2026-08-01T09:00:00.000Z',
    },
    offering: {
      id: OFFERING_ID,
      startDate: '2026-09-01T09:00:00.000Z',
      endDate: null,
      capacity: 12,
      workshopCapacity: null,
      approvedCount: 3,
      seatsRemaining: 9,
      isFull: false,
      workshopSeatsRemaining: null,
      viewerEnrollmentStatus: null,
    },
    ...overrides,
  } as EnrollmentDto;
}

const completed = row({
  status: 'COMPLETED',
  completedAt: COMPLETED_AT,
  completedBy: { id: TEACHER_ID, name: 'Dana Okafor', role: 'TEACHER', avatarUrl: null },
});

const noop = () => undefined;

function renderActions(entry: EnrollmentDto, viewer: SessionUser = TEACHER) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(qk.session, { user: viewer });
  render(
    <QueryClientProvider client={client}>
      <EnrollmentCompletionActions
        entry={entry}
        course={course}
        pending={false}
        onComplete={noop}
        onUncomplete={noop}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EnrollmentCompletionActions', () => {
  it('offers Complete to the teacher who owns the course', () => {
    renderActions(row({ status: 'APPROVED' }));
    expect(screen.getByRole('button', { name: 'Complete' })).toBeEnabled();
  });

  it('offers nothing to a teacher who does not own it — ownsCourse reads the COURSE', () => {
    // A colleague's roster, rendered directly. `ownsCourse` reads `courseTeacherId`,
    // which `enrollmentSubject` carries from the course, so a subject built from the
    // row alone would deny here AND on the next line.
    renderActions(row({ status: 'APPROVED' }), { ...TEACHER, id: OTHER_TEACHER_ID });
    expect(screen.queryByRole('button', { name: 'Complete' })).toBeNull();
    // The decided date survives the denial, so the cell is never blank.
    expect(screen.getByText(formatDate(DECIDED_AT))).toBeInTheDocument();
  });

  it('offers Uncomplete on a COMPLETED row and never Complete', async () => {
    renderActions(completed);
    // The gate is asked with the ROW, and the row is the completed one — asserted
    // rather than assumed, because a subject that ignored `entry` would ask about
    // the wrong enrolment entirely.
    expect(await screen.findByRole('button', { name: 'Uncomplete' })).toBeInTheDocument();
    // `ALLOWED_TRANSITIONS.COMPLETED` is `['APPROVED']` and nothing else, so a
    // Complete button here is a 409 waiting to happen.
    expect(screen.queryByRole('button', { name: 'Complete' })).toBeNull();
  });

  it('leaves a REJECTED row with its date and no verb at all', () => {
    renderActions(row({ status: 'REJECTED' }));
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(formatDate(DECIDED_AT))).toBeInTheDocument();
  });
});

describe('CompletionStamp', () => {
  it('names the recorder, because a qualification is a claim about who signed it', () => {
    render(<CompletionStamp enrollment={completed} />);
    expect(screen.getByText(/recorded by Dana Okafor/)).toBeInTheDocument();
  });

  it('says nothing at all on a row that is not completed', () => {
    const { container } = render(<CompletionStamp enrollment={row()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says nothing rather than an em dash when a COMPLETED row carries no timestamp', () => {
    // `formatDate(null)` is '—', so without the guard this would render
    // "— · recorded by Dana Okafor" under a chip claiming a qualification exists.
    const { container } = render(
      <CompletionStamp
        enrollment={row({
          status: 'COMPLETED',
          completedAt: null,
          completedBy: { id: TEACHER_ID, name: 'Dana Okafor', role: 'TEACHER', avatarUrl: null },
        })}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
