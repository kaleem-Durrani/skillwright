import { useEffect, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
/*
 * The page envelope comes from the package that DEFINES it. `@/lib/api` keeps a
 * hand-written copy of `Paginated` (api.ts:110-127) — a type the schema already
 * describes, which CONTRIBUTING.md:51 makes an automatic send-back. The API
 * validates this response against `paginated(...)` (pagination.ts:41-43) before it
 * sends it, so inferring from there is the only version that cannot drift.
 *
 * Type-only, so the specifier erases at build time and pulls no zod into the bundle.
 */
import type { Paginated } from '@skillwright/shared/schema';
import { api } from '@/lib/api';
import { qk } from '@/lib/query';
import { useCompletedCourseIds, usePolicy } from '@/lib/policy';
import { useSession } from '@/lib/session';
import { formatDuration } from '@/lib/format';
/*
 * The offering readings the seats display is built from: the wire orders intakes
 * soonest-start first, so "first open" IS "soonest open", and the viewer's
 * COURSE-level chip derives from the per-intake statuses.
 */
import { courseViewerStatus, formatOfferingDates, soonestOpenOffering } from '@/lib/offerings';
/*
 * The catalogue row is `CourseListItem`, NOT `CourseSummary`.
 *
 * `GET /courses` serves `paginated(courseListItemSchema)` (courses.routes.ts:49-58):
 * every field of the summary plus `description` and an `offerings` array whose
 * entries each carry THE VIEWER'S status on that intake. The blurb below renders
 * from the first; the seats line reads the soonest OPEN intake; the status chip
 * derives from the per-intake statuses. They are a third schema rather than fields
 * on `courseSummarySchema` because the summary is embedded as
 * `enrollmentSchema.course`, where a viewer-relative status would read as a second,
 * contradictory status on a row that already has one.
 */
import type { CourseListItem } from '@/lib/types';

/**
 * The catalogue row's seats line: the SOONEST OPEN intake, in `hasSeats` semantics —
 * "some live intake still has seats". A template has no capacity of its own to show;
 * when every intake is full the row says so rather than inventing a number, and a
 * course with no intakes at all says nothing numeric at all.
 */
function nextIntakeCell(course: CourseListItem): { label: string; seats: string | null } {
  const open = soonestOpenOffering(course.offerings);
  if (open !== undefined) {
    return {
      label: formatOfferingDates(open),
      seats: `${open.seatsRemaining} of ${open.capacity} places left`,
    };
  }
  if (course.offerings.length > 0) return { label: 'All intakes full', seats: null };
  return { label: 'No intakes scheduled', seats: null };
}
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { StatusChip } from '@/components/ui/StatusChip';
import { Gate } from '@/components/Gate';
import { Route } from '@/routes/_app/courses';

export function CoursesPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const policy = usePolicy();
  const { user } = useSession();

  /**
   * The role read that scopes the completed-courses lookup below. A student's
   * `GET /enrollments` is self-scoped server-side; no other role's rows would say
   * anything about what the viewer has COMPLETED.
   */
  const isStudent = user?.role === 'STUDENT';
  const completed = useCompletedCourseIds(isStudent);

  /**
   * The ladder rung a card names, when it is one the viewer still owes — Phase 6's
   * catalogue half. Data-driven and viewer-independent for everyone except a
   * signed-in student who has ALREADY completed the named course, whose card goes
   * back to saying nothing; nobody else's completion is decidable here, so their
   * cards always state the requirement. Unknown (lookup unsettled) counts as owed:
   * a badge that disappears late is noise, one that appears late is a warning the
   * student got exactly when it became true.
   */
  const requiresLabel = (course: CourseListItem): string | null => {
    if (course.prerequisite === null) return null;
    if (
      isStudent &&
      completed.ready &&
      completed.completedCourseIds?.includes(course.prerequisite.id)
    ) {
      return null;
    }
    return `Requires: ${course.prerequisite.code} ${course.prerequisite.name}`;
  };

  // Local mirror of the URL query so typing does not push a history entry per
  // keystroke; the URL is updated on a debounce below.
  const [term, setTerm] = useState(search.q ?? '');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if ((search.q ?? '') === term) return;
      void navigate({
        search: (previous) => ({ ...previous, q: term || undefined, page: 1 }),
        replace: true,
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [term, search.q, navigate]);

  const courses = useQuery({
    queryKey: qk.courses(search),
    queryFn: () =>
      api.get<Paginated<CourseListItem>>('/courses', {
        query: {
          page: search.page,
          limit: 20,
          q: search.q,
          departmentId: search.departmentId,
          // The URL says `status=published|draft`; the endpoint takes `published`
          // (listCoursesQuerySchema, course.ts:141-154) and its zod object STRIPS
          // anything else, so sending `status` filtered nothing and failed silently.
          ...(search.status ? { published: search.status === 'published' } : {}),
        },
      }),
    // Keeps the previous page on screen while the next one loads instead of
    // collapsing the list back to a skeleton on every page change.
    placeholderData: (previous) => previous,
  });

  const isFiltered = Boolean(search.q || search.departmentId || search.status);

  return (
    // `min-h-0 flex-1` so the table below can claim the remaining height — the
    // catalogue is this screen's main content, same contract as AdminUsers.
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Courses"
        description="Everything you are entitled to see. Private courses are not listed."
        actions={
          <Gate action="course:create">
            <Button
              block
              className="sm:w-auto"
              leadingIcon={<Plus aria-hidden="true" className="size-4" />}
            >
              New course
            </Button>
          </Gate>
        }
      />

      <div className="flex flex-col gap-3 pb-(--space-block) md:flex-row md:items-center">
        <Input
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search courses"
          aria-label="Search courses"
          leading={<Search aria-hidden="true" className="size-4" />}
          className="md:w-80"
        />
        {isFiltered ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setTerm('');
              void navigate({ search: { page: 1 } });
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      <DataTable
        fillHeight
        items={courses.data?.data ?? []}
        loading={courses.isPending}
        caption="Courses"
        getKey={(course) => course.id}
        columns={[
          {
            id: 'name',
            header: 'Course',
            cell: (course) => (
              <div className="flex flex-col">
                <Link
                  to="/courses/$courseId"
                  params={{ courseId: course.id }}
                  className="font-medium text-fg hover:text-fg-brand"
                >
                  {course.name}
                </Link>
                <span className="text-xs text-fg-tertiary">{course.code}</span>
              </div>
            ),
          },
          {
            id: 'department',
            header: 'Department',
            cell: (course) => course.department.name,
          },
          {
            id: 'teacher',
            header: 'Teacher',
            cell: (course) => course.teacher.name,
            secondary: true,
          },
          {
            id: 'duration',
            header: 'Duration',
            cell: (course) => formatDuration(course.duration.value, course.duration.unit),
            secondary: true,
          },
          {
            id: 'intake',
            header: 'Next intake',
            align: 'end',
            cell: (course) => {
              const intake = nextIntakeCell(course);
              return (
                <span className="flex flex-col text-xs">
                  <span>{intake.label}</span>
                  {intake.seats !== null ? (
                    <span className="tabular-nums">{intake.seats}</span>
                  ) : null}
                </span>
              );
            },
          },
          {
            id: 'status',
            header: 'Status',
            align: 'end',
            cell: (course) => {
              // The per-intake statuses derive the course-level chip; teachers and
              // admins receive null on every intake, so their rows keep publish state.
              const viewerStatus = courseViewerStatus(course.offerings);
              return viewerStatus ? (
                <StatusChip status={viewerStatus} />
              ) : (
                <StatusChip status={course.publishedAt ? 'PUBLISHED' : 'DRAFT'} />
              );
            },
          },
        ]}
        renderCard={(course) => {
          const requires = requiresLabel(course);
          const intake = nextIntakeCell(course);
          const viewerStatus = courseViewerStatus(course.offerings);
          return (
            <Card interactive className="relative flex flex-col gap-2">
              <div className="flex items-start justify-between gap-3">
                <CardTitle className="text-base">
                  <Link
                    to="/courses/$courseId"
                    params={{ courseId: course.id }}
                    className="outline-none after:absolute after:inset-0"
                  >
                    {course.name}
                  </Link>
                </CardTitle>
                {viewerStatus ? (
                  <StatusChip status={viewerStatus} />
                ) : (
                  <StatusChip status={course.publishedAt ? 'PUBLISHED' : 'DRAFT'} />
                )}
              </div>
              <p className="text-xs text-fg-tertiary">
                {course.code} · {course.department.name}
              </p>
              <p className="line-clamp-2 text-sm text-fg-secondary">
                {course.description ?? 'No description yet.'}
              </p>
              {requires ? (
                /*
                 * On the card only, like the blurb above it: the table's columns
                 * are facts about every row, and the enrol decision this badge
                 * feeds happens on the detail screen the card links to.
                 */
                <p className="text-xs font-medium text-fg-brand">{requires}</p>
              ) : null}
              <dl className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs text-fg-tertiary">
                <div className="flex gap-1">
                  <dt>Teacher:</dt>
                  <dd className="text-fg-secondary">{course.teacher.name}</dd>
                </div>
                <div className="flex gap-1">
                  <dt>Duration:</dt>
                  <dd className="text-fg-secondary">
                    {formatDuration(course.duration.value, course.duration.unit)}
                  </dd>
                </div>
                <div className="flex gap-1">
                  <dt>Next intake:</dt>
                  <dd className="text-fg-secondary">
                    {intake.label}
                    {intake.seats !== null ? (
                      <span className="tabular-nums"> · {intake.seats}</span>
                    ) : null}
                  </dd>
                </div>
              </dl>
            </Card>
          );
        }}
        empty={
          isFiltered ? (
            <EmptyState
              variant="no-results"
              description="No course matched that search. Try fewer words, or clear the filters."
              actionLabel="Clear filters"
              onAction={() => {
                setTerm('');
                void navigate({ search: { page: 1 } });
              }}
            />
          ) : (
            <EmptyState
              variant="empty"
              title="No courses yet"
              description={
                policy.can('course:create')
                  ? 'Create the first course and it will be listed here.'
                  : 'Nothing has been published for your department yet.'
              }
              {...(policy.can('course:create')
                ? { actionLabel: 'New course', onAction: () => undefined }
                : {})}
            />
          )
        }
        pagination={
          courses.data
            ? {
                page: courses.data.meta.page,
                totalPages: courses.data.meta.totalPages,
                total: courses.data.meta.total,
                limit: courses.data.meta.limit,
                onPageChange: (page) =>
                  void navigate({ search: (previous) => ({ ...previous, page }) }),
              }
            : undefined
        }
      />
    </div>
  );
}
