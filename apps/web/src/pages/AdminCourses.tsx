import { useEffect, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import type { Paginated } from '@skillwright/shared/schema';
import { api } from '@/lib/api';
import { qk } from '@/lib/query';
import { usePolicy } from '@/lib/policy';
import type { CourseListItem } from '@/lib/types';
import { formatDuration } from '@/lib/format';
// Same seats line as the catalogue: soonest OPEN intake, in `hasSeats` semantics.
// No viewer-status chip here: an ADMIN receives null per intake, so rows keep
// publish state, exactly as before the split.
import { formatOfferingDates, soonestOpenOffering } from '@/lib/offerings';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { DataList } from '@/components/ui/DataList';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Pagination } from '@/components/ui/Pagination';
import { StatusChip } from '@/components/ui/StatusChip';
import { Gate } from '@/components/Gate';
import { CourseFormDialog } from '@/components/courses/CourseFormDialog';
import { CoursePublishButton } from '@/components/courses/CoursePublishButton';
import { CourseRowActions } from '@/components/courses/CourseRowActions';
import { Route } from '@/routes/_app/admin.courses';

/**
 * The seats line for one admin row: the soonest intake that still has seats, with
 * the workshop bound beside it when that intake binds one. An admin sees the same
 * `hasSeats` reading the catalogue does — a template has no capacity of its own.
 */
function nextIntakeCell(course: CourseListItem): {
  label: string;
  places: string | null;
  workshop: string | null;
} {
  const open = soonestOpenOffering(course.offerings);
  if (open !== undefined) {
    return {
      label: formatOfferingDates(open),
      places: `${open.seatsRemaining} of ${open.capacity} places left`,
      workshop:
        open.workshopCapacity !== null
          ? `${open.workshopSeatsRemaining} of ${open.workshopCapacity} workshop places left`
          : null,
    };
  }
  if (course.offerings.length > 0) {
    return { label: 'All intakes full', places: null, workshop: null };
  }
  return { label: 'No intakes scheduled', places: null, workshop: null };
}

/**
 * The ADMIN view of every course — created or not, published or not. It reads the
 * same `GET /courses` the catalogue does (`listCoursesQuerySchema` has no
 * admin-only filter; an ADMIN's policy row for `course:read` is a bare allow and
 * the service's visibility WHERE clause lets an admin through everything), which
 * is why there is no second endpoint behind this screen.
 */
export function AdminCoursesPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const policy = usePolicy();

  const [term, setTerm] = useState(search.q ?? '');
  const [creating, setCreating] = useState(false);
  /** The summary row being edited, if any. Absent means the dialog creates. */
  const [editing, setEditing] = useState<CourseListItem | null>(null);

  // Same debounced mirror of the URL as AdminUsers and the catalogue.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if ((search.q ?? '') === term) return;
      void navigate({
        search: ({ q: _clearedQ, ...previous }) => ({
          ...previous,
          ...(term ? { q: term } : {}),
          page: 1,
        }),
        replace: true,
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [term, search.q, navigate]);

  const courses = useQuery({
    queryKey: qk.courses(search),
    queryFn: () =>
      api.get<Paginated<CourseListItem>>('/courses', {
        query: { page: search.page, limit: 20, q: search.q },
      }),
    placeholderData: (previous) => previous,
  });

  const isFiltered = Boolean(search.q);

  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow="Admin workspace"
        title="Courses"
        description="Every course in the catalogue, published or not."
        actions={
          <Gate action="course:create">
            <Button
              block
              className="sm:w-auto"
              leadingIcon={<Plus aria-hidden="true" className="size-4" />}
              onClick={() => setCreating(true)}
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
          placeholder="Search by name or code"
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
            id: 'intake',
            header: 'Next intake',
            align: 'end',
            cell: (course) => {
              const intake = nextIntakeCell(course);
              return (
                <span className="flex flex-col text-xs">
                  <span>{intake.label}</span>
                  {intake.places !== null ? (
                    <span className="tabular-nums">{intake.places}</span>
                  ) : null}
                  {/*
                    The second bound, only when the shown intake binds one — an
                    unbound (lecture) intake says nothing about a workshop it does
                    not have.
                  */}
                  {intake.workshop !== null ? (
                    <span className="tabular-nums text-fg-tertiary">{intake.workshop}</span>
                  ) : null}
                </span>
              );
            },
          },
          {
            id: 'status',
            header: 'Status',
            align: 'end',
            cell: (course) => <StatusChip status={course.publishedAt ? 'PUBLISHED' : 'DRAFT'} />,
          },
          {
            id: 'actions',
            header: 'Actions',
            align: 'end',
            width: '12rem',
            cell: (course) => (
              <div className="flex items-center justify-end gap-1">
                <CoursePublishButton
                  course={{
                    id: course.id,
                    publishedAt: course.publishedAt,
                    teacherId: course.teacher.id,
                  }}
                />
                <CourseRowActions
                  course={{ id: course.id, name: course.name, teacherId: course.teacher.id }}
                  onEdit={() => setEditing(course)}
                />
              </div>
            ),
          },
        ]}
        renderCard={(course) => {
          const intake = nextIntakeCell(course);
          return (
            <Card className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col">
                  <CardTitle className="text-base">
                    <Link
                      to="/courses/$courseId"
                      params={{ courseId: course.id }}
                      className="hover:text-fg-brand"
                    >
                      {course.name}
                    </Link>
                  </CardTitle>
                  <p className="text-xs text-fg-tertiary">
                    {course.code} · {course.department.name}
                  </p>
                </div>
                <StatusChip status={course.publishedAt ? 'PUBLISHED' : 'DRAFT'} size="sm" />
              </div>
              <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-tertiary">
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
                    {intake.places !== null ? (
                      <span className="tabular-nums"> · {intake.places}</span>
                    ) : null}
                  </dd>
                </div>
              </dl>
              <div className="relative z-10 flex items-center justify-end gap-1 pt-1">
                {/* Positioned above nothing here — the card title's link is not an
                    overlay in this rendering — but kept in one piece with the table's
                    action column so both stay the same controls. */}
                <CoursePublishButton
                  course={{
                    id: course.id,
                    publishedAt: course.publishedAt,
                    teacherId: course.teacher.id,
                  }}
                />
                <CourseRowActions
                  course={{ id: course.id, name: course.name, teacherId: course.teacher.id }}
                  onEdit={() => setEditing(course)}
                />
              </div>
            </Card>
          );
        }}
        empty={
          isFiltered ? (
            <EmptyState
              variant="no-results"
              description="No course matched that search. Try fewer words, or clear it."
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
                  : 'Nothing has been added yet.'
              }
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

      <CourseFormDialog open={creating} onOpenChange={setCreating} />
      {editing ? (
        <CourseFormDialog
          open
          onOpenChange={(open) => !open && setEditing(null)}
          course={{
            id: editing.id,
            name: editing.name,
            code: editing.code,
            slug: editing.slug,
          }}
        />
      ) : null}
    </div>
  );
}
