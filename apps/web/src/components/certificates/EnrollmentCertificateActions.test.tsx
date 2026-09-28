/**
 * Phase 3's row control, driven directly so the `Gate` is actually asked.
 *
 * The page-level pins in `CourseDetail.test.tsx` prove the button appears on a
 * COMPLETED row and that the dialog it opens posts the seat. What they cannot prove is
 * a DENIAL: for a teacher who does not own the course the whole Students tab is absent
 * (`enrollment:read` is `ownsCourse`), so the control is never mounted and its absence
 * says nothing about the gate that would have refused it. This file mounts it with the
 * roster a colleague's course would serve, which is the only way to reach the gate —
 * the same reason `EnrollmentCompletionActions.test.tsx` exists.
 *
 * The subject is the load-bearing part, so the assertions are about the two things that
 * decide it: the SEAT, not the student or the course, and `courseTeacherId` read off
 * the course rather than any id on the row. Either mistake denies the OWNING teacher
 * too, silently, with no type error — the shape LESSONS-LEARNED #18 and #31 both
 * describe, and the API decides `certificate:issue` against the same seat.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { qk } from '@/lib/query';
import type { SessionUser } from '@/lib/session';
import type { CourseDetail, EnrollmentDto } from '@/lib/types';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, Link: ({ children }: { children?: unknown }) => <>{children}</> };
});

import { EnrollmentCertificateActions } from './EnrollmentCertificateActions';

const COURSE_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCX';
const DEPARTMENT_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCY';
const TEACHER_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCZ';
const OTHER_TEACHER_ID = '01JGXDFAM0K2Z1GYCSNM5F5RE9';
const STUDENT_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD1';
const OFFERING_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD7';
const ENROLLMENT_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD3';

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

const COLLEAGUE: SessionUser = { ...TEACHER, id: OTHER_TEACHER_ID, email: 'sam@example.edu' };
const ADMIN: SessionUser = { ...TEACHER, id: '01JGXDFAM0K2Z1GYCSNM5F5RE1', role: 'ADMIN' };

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
    status: 'COMPLETED',
    requestedAt: '2026-08-01T09:00:00.000Z',
    decidedAt: '2026-08-02T09:00:00.000Z',
    decidedBy: null,
    decisionNote: null,
    completedAt: '2026-09-20T09:00:00.000Z',
    completedBy: { id: TEACHER_ID, name: 'Dana Okafor', role: 'TEACHER', avatarUrl: null },
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

const onIssue = vi.fn();

function renderActions(entry: EnrollmentDto, viewer: SessionUser = TEACHER): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(qk.session, { user: viewer });
  render(
    <QueryClientProvider client={client}>
      <EnrollmentCertificateActions entry={entry} course={course} onIssue={onIssue} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EnrollmentCertificateActions', () => {
  it('offers the control to the teacher who owns the course, and hands back the seat', async () => {
    const user = userEvent.setup();
    renderActions(row());

    await user.click(screen.getByRole('button', { name: 'Issue certificate' }));
    // The whole ENROLMENT, not its id: the dialog needs the student's name and the
    // course's name to say what it is about, and an id would make it re-derive both.
    expect(onIssue).toHaveBeenCalledTimes(1);
    expect(onIssue.mock.calls[0]?.[0]).toMatchObject({ id: ENROLLMENT_ID, status: 'COMPLETED' });
  });

  it('renders nothing on a seat that is not COMPLETED', () => {
    renderActions(row({ status: 'APPROVED', completedAt: null, completedBy: null }));
    // The API refuses one of these with a 409, so a button here is a guarantee of
    // failure — the same reason `EnrollmentCompletionActions` offers Complete only on
    // an APPROVED row.
    expect(screen.queryByRole('button', { name: 'Issue certificate' })).not.toBeInTheDocument();
  });

  it('renders nothing for a teacher who does not own the course', () => {
    renderActions(row(), COLLEAGUE);
    // `certificate:issue` is `ownsCourse`, which reads `courseTeacherId` — a field on
    // the COURSE and not on the row. The gate is asked with the seat, because that is
    // what the API decides it against, and the two shapes must not drift.
    expect(screen.queryByRole('button', { name: 'Issue certificate' })).not.toBeInTheDocument();
  });

  it('renders nothing for a student, whatever the seat says', () => {
    renderActions(row(), { ...TEACHER, id: STUDENT_ID, role: 'STUDENT' });
    expect(screen.queryByRole('button', { name: 'Issue certificate' })).not.toBeInTheDocument();
  });

  it('is offered to an admin, who is not scoped to a course', () => {
    renderActions(row(), ADMIN);
    // `certificate:issue` is a bare `allow` for ADMIN, read against the seat — so an
    // admin confers from any seat, which is the registrar-of-last-resort arrangement
    // `enrollment:complete` already makes.
    expect(screen.getByRole('button', { name: 'Issue certificate' })).toBeInTheDocument();
  });
});
