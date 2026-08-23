import { Link, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BookOpen, UserRound, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { qk } from '@/lib/query';
import { usePolicy } from '@/lib/policy';
import type { DepartmentDetail as DepartmentDetailDto } from '@/lib/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
// `Route.id`, not a hand-typed path: route ids carry their layout prefix
// ('/_app/departments/$id'), and guessing them is how the previous attempt
// failed to compile.
import { Route as departmentDetailRoute } from '@/routes/_app/departments.$id';

/**
 * The one caller `GET /departments/:id` has been waiting for: the summary plus the
 * three head-counts it computes with real `_count` joins (departments.service.ts
 * `toDepartmentDetail`). It lives under `_app`, not under `/admin` —
 * `department:read` allows every signed-in role and denies only anonymous, so a
 * student following a course's department link is entitled to exactly this page.
 */
export function DepartmentDetailPage() {
  const { id } = useParams({ from: departmentDetailRoute.id });
  const policy = usePolicy();

  const department = useQuery({
    queryKey: qk.department(id),
    queryFn: () => api.get<DepartmentDetailDto>(`/departments/${id}`),
    // Subject-independent action — safe to ask without a subject, and the route
    // guard has already proved there is a session.
    enabled: policy.can('department:read'),
  });

  if (department.isPending || department.isError) {
    return (
      <EmptyState
        variant={department.isError ? 'error' : 'empty'}
        description={
          department.isError
            ? 'The department could not be loaded. Nothing you did caused this.'
            : undefined
        }
      />
    );
  }

  const entry = department.data;
  const counts = [
    { key: 'courses', label: 'Courses', value: entry.courseCount, icon: BookOpen },
    { key: 'teachers', label: 'Teachers', value: entry.teacherCount, icon: UserRound },
    { key: 'students', label: 'Students', value: entry.studentCount, icon: Users },
  ];

  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow={
          <Button asChild variant="ghost" size="sm" className="-ms-2">
            <Link to="/admin/departments" search={{ page: 1 }}>
              <ArrowLeft aria-hidden="true" className="size-4" />
              Departments
            </Link>
          </Button>
        }
        title={entry.name}
        description={entry.description ?? 'No description yet.'}
      />

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {counts.map((count) => (
          <li key={count.key}>
            <Card className="flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-md bg-brand-soft text-brand-on-soft">
                <count.icon aria-hidden="true" className="size-5" />
              </span>
              <div className="flex min-w-0 flex-col">
                <span className="text-2xl leading-none font-semibold tabular-nums">
                  {count.value}
                </span>
                <span className="truncate text-xs text-fg-tertiary">{count.label}</span>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
