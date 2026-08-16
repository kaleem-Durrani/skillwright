import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { ArrowRight, BookOpen, FileText, MessagesSquare, UserRoundCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { qk } from '@/lib/query';
import { cn } from '@/lib/cn';
import { useMotionKit } from '@/lib/motion';
import { usePolicy } from '@/lib/policy';
import { useSession } from '@/lib/session';
import { formatRelative } from '@/lib/format';
import type { CourseSummary, DashboardStats, EnrollmentSummary } from '@/lib/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusChip } from '@/components/ui/StatusChip';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonCard, SkeletonStats } from '@/components/ui/Skeleton';
import { WORKSPACE_LABEL } from '@/components/layout/nav';

export function DashboardPage() {
  const { user } = useSession();
  const policy = usePolicy();
  const { variants } = useMotionKit();

  const stats = useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn: () => api.get<DashboardStats>('/dashboard/stats'),
  });

  const courses = useQuery({
    queryKey: qk.courses({ scope: 'mine', limit: 4 }),
    queryFn: () =>
      api.get<{ data: CourseSummary[] }>('/courses', {
        query: { scope: 'mine', limit: 4 },
      }),
    enabled: policy.can('course:read'),
  });

  const pending = useQuery({
    queryKey: qk.enrollments({ status: 'PENDING', limit: 5 }),
    queryFn: () =>
      api.get<{ data: EnrollmentSummary[] }>('/enrollments', {
        query: { status: 'PENDING', limit: 5 },
      }),
    // Only someone who can act on a request should be shown the queue.
    enabled: policy.can('enrollment:approve'),
  });

  if (!user) return null;

  const tiles = [
    { key: 'courses', label: 'Courses', icon: BookOpen, value: stats.data?.courses },
    {
      key: 'pending',
      label: 'Pending requests',
      icon: UserRoundCheck,
      value: stats.data?.pendingEnrollments,
    },
    {
      key: 'messages',
      label: 'Unread messages',
      icon: MessagesSquare,
      value: stats.data?.unreadMessages,
    },
    { key: 'resources', label: 'Resources', icon: FileText, value: stats.data?.resources },
  ];

  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow={WORKSPACE_LABEL[user.role]}
        title={`Good to see you, ${user.name.split(' ')[0]}`}
        description="Everything you have access to, in one place."
      />

      {stats.isPending ? (
        <SkeletonStats />
      ) : (
        <motion.ul
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
          variants={variants.stagger}
          initial="hidden"
          animate="visible"
        >
          {tiles.map((tile) => (
            <motion.li key={tile.key} variants={variants.staggerItem}>
              <Card className="flex items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-md bg-brand-soft text-brand-on-soft">
                  <tile.icon aria-hidden="true" className="size-5" />
                </span>
                <div className="flex min-w-0 flex-col">
                  <span className="text-2xl leading-none font-semibold tabular-nums">
                    {tile.value ?? 0}
                  </span>
                  <span className="truncate text-xs text-fg-tertiary">{tile.label}</span>
                </div>
              </Card>
            </motion.li>
          ))}
        </motion.ul>
      )}

      <section className="pt-8" aria-labelledby="dashboard-courses">
        <div className="flex items-center justify-between gap-3 pb-3">
          <h2 id="dashboard-courses" className="font-display text-lg font-semibold">
            Your courses
          </h2>
          <Button asChild variant="ghost" size="sm">
            <Link to="/courses" search={{ page: 1 }}>
              See all
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </Button>
        </div>

        {courses.isPending ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <SkeletonCard />
            <SkeletonCard className="hidden lg:block" />
          </div>
        ) : (courses.data?.data.length ?? 0) === 0 ? (
          <EmptyState
            variant="empty"
            compact
            title="No courses yet"
            description={
              policy.can('course:create')
                ? 'Create your first course and it will appear here.'
                : 'Once your enrolment is approved, your courses show up here.'
            }
            action={
              <Button asChild block className="sm:w-auto">
                <Link to="/courses" search={{ page: 1 }}>
                  Browse courses
                </Link>
              </Button>
            }
          />
        ) : (
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {courses.data?.data.map((course) => (
              <li key={course.id}>
                <Card interactive className="relative flex h-full flex-col gap-2">
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="text-base">
                      <Link
                        to="/courses/$courseId"
                        params={{ courseId: course.id }}
                        className="outline-none after:absolute after:inset-0 focus-visible:underline"
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
                    {course.code} · {course.departmentName}
                  </p>
                  <p className="line-clamp-2 text-sm text-fg-secondary">
                    {course.description ?? 'No description yet.'}
                  </p>
                  <CapacityBar approved={course.approvedCount} capacity={course.capacity} />
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {policy.can('enrollment:approve') ? (
        <section className="pt-8" aria-labelledby="dashboard-requests">
          <h2 id="dashboard-requests" className="pb-3 font-display text-lg font-semibold">
            Enrolment requests
          </h2>

          {pending.isPending ? (
            <SkeletonCard />
          ) : (pending.data?.data.length ?? 0) === 0 ? (
            <EmptyState
              variant="empty"
              compact
              title="Nothing waiting"
              description="Approved and rejected requests move out of this queue automatically."
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {pending.data?.data.map((request) => (
                <li key={request.id}>
                  <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium">{request.studentName}</span>
                      <span className="truncate text-xs text-fg-tertiary">
                        {request.courseName} · asked {formatRelative(request.requestedAt)}
                      </span>
                    </div>
                    <Button asChild variant="secondary" size="sm" className="shrink-0">
                      <Link to="/courses/$courseId" params={{ courseId: request.courseId }}>
                        Review
                      </Link>
                    </Button>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}

function CapacityBar({ approved, capacity }: { approved: number; capacity: number }) {
  const ratio = capacity > 0 ? Math.min(1, approved / capacity) : 0;
  const full = capacity > 0 && approved >= capacity;

  return (
    <div className="flex flex-col gap-1.5 pt-1">
      <div className="flex items-center justify-between text-2xs text-fg-tertiary">
        <span>
          {approved} of {capacity} places taken
        </span>
        {full ? <span className="font-semibold text-danger-fg">Full</span> : null}
      </div>
      <div
        role="progressbar"
        aria-valuenow={approved}
        aria-valuemin={0}
        aria-valuemax={capacity}
        aria-label="Enrolment capacity"
        className="h-1.5 w-full overflow-hidden rounded-full bg-sunken"
      >
        <div
          className={cn('h-full rounded-full', full ? 'bg-danger' : 'bg-brand')}
          style={{ inlineSize: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
}
