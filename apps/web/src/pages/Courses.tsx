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
import { usePolicy } from '@/lib/policy';
import { formatDuration } from '@/lib/format';
/*
 * The catalogue row is `CourseListItem`, NOT `CourseSummary`.
 *
 * `GET /courses` serves `paginated(courseListItemSchema)` (courses.routes.ts:49-58):
 * every field of the summary plus `description` and `viewerEnrollmentStatus`
 * (course.ts:77-81). Those two are what the cards below render — the blurb, and the
 * chip that tells a student which courses they have already applied to.
 *
 * They are a third schema rather than two more fields on `courseSummarySchema`
 * because the summary is embedded as `enrollmentSchema.course`, where a
 * viewer-relative status would read as a second, contradictory status on a row that
 * already has one. Naming `CourseSummary` here would therefore be a lie in both
 * directions: too narrow for this response, and unfixable at its own definition.
 */
import type { CourseListItem } from '@/lib/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { DataList } from '@/components/ui/DataList';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Pagination } from '@/components/ui/Pagination';
import { StatusChip } from '@/components/ui/StatusChip';
import { Gate } from '@/components/Gate';
import { Route } from '@/routes/_app/courses';

export function CoursesPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const policy = usePolicy();

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
    <div className="flex flex-col">
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

      <div className="flex flex-col gap-3 pb-5 md:flex-row md:items-center">
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

      <DataList
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
            id: 'places',
            header: 'Places',
            align: 'end',
            cell: (course) => (
              <span className="tabular-nums">
                {course.approvedCount}/{course.capacity}
              </span>
            ),
          },
          {
            id: 'status',
            header: 'Status',
            align: 'end',
            cell: (course) =>
              course.viewerEnrollmentStatus ? (
                <StatusChip status={course.viewerEnrollmentStatus} />
              ) : (
                <StatusChip status={course.publishedAt ? 'PUBLISHED' : 'DRAFT'} />
              ),
          },
        ]}
        renderCard={(course) => (
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
              {course.viewerEnrollmentStatus ? (
                <StatusChip status={course.viewerEnrollmentStatus} />
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
                <dt>Places:</dt>
                <dd className="text-fg-secondary tabular-nums">
                  {course.approvedCount}/{course.capacity}
                </dd>
              </div>
            </dl>
          </Card>
        )}
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
      />

      {courses.data ? (
        <Pagination
          label="Courses pagination"
          page={courses.data.meta.page}
          totalPages={courses.data.meta.totalPages}
          total={courses.data.meta.total}
          limit={courses.data.meta.limit}
          onPageChange={(page) => void navigate({ search: (previous) => ({ ...previous, page }) })}
        />
      ) : null}
    </div>
  );
}
