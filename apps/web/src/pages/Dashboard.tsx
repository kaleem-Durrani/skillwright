import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { ArrowRight, BookOpen, FileText, MessagesSquare, UserRoundCheck } from 'lucide-react';
/*
 * The catalogue row and the page envelope, taken from the package that DEFINES them.
 *
 * `GET /courses` serves `paginated(courseListItemSchema)` (courses.routes.ts:49-58), not
 * the `courseSummarySchema` this file used to name. `CourseListItem` is the summary plus
 * `description` and `viewerEnrollmentStatus` (course.ts:77-81), so every field read below
 * is unchanged — the type now just says what the wire actually sends instead of a
 * narrower guess at it.
 *
 * It comes from this specifier rather than `@/lib/types` only because that barrel does
 * not re-export it yet and this change may not edit it; the specifier is the same one
 * the barrel re-exports everything else from. `Paginated` comes from here for a stronger
 * reason: `@/lib/api` keeps a hand-written copy of an envelope the schema already
 * describes (api.ts:110-127), and its cursor twin is outright wrong — CONTRIBUTING.md:51.
 *
 * Type-only, so this specifier erases at build time and pulls no zod into the bundle.
 */
import type { CourseListItem, Paginated } from '@skillwright/shared/schema';
import { api } from '@/lib/api';
import { qk } from '@/lib/query';
import { cn } from '@/lib/cn';
import { useMotionKit } from '@/lib/motion';
import { subject, usePolicy } from '@/lib/policy';
import { useSession } from '@/lib/session';
import { formatDuration, formatRelative } from '@/lib/format';
import type { DashboardStats, EnrollmentDto } from '@/lib/types';
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

  /**
   * There is no `scope` filter on `GET /courses`. `listCoursesQuerySchema`
   * (course.ts:141-155) accepts departmentId, teacherId, published, hasSeats, q and
   * pagination — nothing else — so the `scope: 'mine'` this query used to send was
   * never read by anything.
   *
   * "Yours" is expressible for a teacher and only for a teacher: `teacherId` narrows
   * the list to exactly the rows the Courses tile counts (dashboard.service.ts:55-69).
   * A student has no equivalent key, and does not need one — the endpoint already
   * narrows their rows to published courses plus the ones they are approved on
   * (`visibilityWhere`, courses.service.ts:221-236). An admin sees the catalogue, which
   * is also what their tile counts.
   */
  const courseQuery = user?.role === 'TEACHER' ? { teacherId: user.id, limit: 4 } : { limit: 4 };

  /*
   * No `enabled: policy.can('course:read')` here, deliberately — the client-side mirror
   * of the argument courses.routes.ts:41-43 makes on the server.
   *
   * `course:read` is Subject-dependent for both non-admin roles: STUDENT is
   * `or(isPublished, enrolledApproved)` and TEACHER is `or(isPublished, ownsCourse)`
   * (policy.ts:119-125), which read `publishedAt`, `enrollmentStatus` and
   * `courseTeacherId` (combinators.ts:55-59, :62-65, :95-98). `can()` substitutes
   * EMPTY_SUBJECT when the third argument is omitted (can.ts:53) and a rule that reads an
   * absent field must deny (actor.ts:46-51), so the subject-free call was false for every
   * student and every teacher — only ADMIN got through, on its bare `allow`. That is not
   * a hidden button: an `enabled: false` query stays `status: 'pending'` in React Query
   * v5, so `courses.isPending` never cleared and "Your courses" rendered `SkeletonCard`
   * forever on the one screen every signed-in user lands on.
   *
   * No subject can be passed instead — a slice of the catalogue is not a single course.
   * The rows arrive already narrowed by `visibilityWhere`, which mirrors those same
   * policy rows, and `_app` gates this whole area on authentication (routes/_app.tsx:17).
   * So just run the query.
   */
  const courses = useQuery({
    queryKey: qk.courses(courseQuery),
    // `paginated(courseListItemSchema)` — `{ data, meta }` (courses.routes.ts:49-58).
    queryFn: () => api.get<Paginated<CourseListItem>>('/courses', { query: courseQuery }),
  });

  /**
   * Who the enrolment queue is for — asked through `can()` WITH the subject every row
   * in it shares, rather than subject-free or by reading the role by hand.
   *
   * `enrollment:approve` is STUDENT `deny` / TEACHER `ownsCourse` / ADMIN `allow`
   * (policy.ts:167-172), and `ownsCourse` reads `Subject.courseTeacherId`
   * (combinators.ts:55-59). Asked with no subject at all it was false for a TEACHER too —
   * the one person this queue exists for — because `can()` falls back to EMPTY_SUBJECT
   * (can.ts:53) and a rule that reads an absent field must deny (actor.ts:46-51). That
   * disabled the query permanently and hid the whole section from every teacher, leaving
   * only admins with an enrolment queue.
   *
   * The subject is not invented. `GET /enrollments` scopes a teacher's rows to
   * `course.teacherId = actor.id` (`visibilityWhere`, enrollments.service.ts:216-222), so
   * `courseTeacherId: user.id` is the one fact EVERY row this queue can contain shares —
   * it is `Course.teacherId` for all of them (actor.ts:67-68). The other two roles never
   * read the field: STUDENT is a bare `deny` and ADMIN a bare `allow`, so it decides
   * nothing for them. Deriving the subject from the actor is the same move the per-user
   * lists make with `{ userId: actor.id }` (policy.ts:460).
   *
   * One boolean drives the fetch AND the render, so this section can never show a
   * skeleton for a query that will not run. And a student is not merely spared a request
   * they cannot use: their OWN pending applications are rows on this endpoint, and
   * listing those under "Enrolment requests" beside a Review button would read as a queue
   * they are being asked to decide.
   */
  const canReviewRequests = policy.can(
    'enrollment:approve',
    // Built conditionally: the early return below is what proves `user`, and hooks run
    // above it. An anonymous actor is denied by the `anonymous` row regardless.
    user ? subject({ courseTeacherId: user.id }) : undefined,
  );

  const pending = useQuery({
    queryKey: qk.enrollments({ status: 'PENDING', limit: 5 }),
    queryFn: () =>
      // `paginated(enrollmentSchema)` (enrollments.routes.ts:46).
      api.get<Paginated<EnrollmentDto>>('/enrollments', {
        query: { status: 'PENDING', limit: 5 },
      }),
    enabled: canReviewRequests,
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
                    {/*
                      The row is a `courseListItem`, so `viewerEnrollmentStatus` IS on it
                      (course.ts:77-81) — but the server sends it as null for everyone who
                      is not a STUDENT (courses.service.ts:196), so it cannot be the badge
                      on a card three roles read. Publish state is carried for all of them.
                    */}
                    <StatusChip status={course.publishedAt ? 'PUBLISHED' : 'DRAFT'} />
                  </div>
                  <p className="text-xs text-fg-tertiary">
                    {course.code} · {course.department.name}
                  </p>
                  {/*
                    `description` is on this row as well, but it is nullable free text
                    (course.ts:78): a second line that disappears on half the catalogue is
                    worse than one that always reads. Teacher and duration are non-null on
                    every course, so the line always says something true.
                  */}
                  <p className="truncate text-sm text-fg-secondary">
                    {course.teacher.name} ·{' '}
                    {formatDuration(course.duration.value, course.duration.unit)}
                  </p>
                  <CapacityBar
                    approved={course.approvedCount}
                    capacity={course.capacity}
                    seatsRemaining={course.seatsRemaining}
                    isFull={course.isFull}
                  />
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Same boolean as the query above, for the reasons argued there. */}
      {canReviewRequests ? (
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
                      <span className="truncate text-sm font-medium">{request.student.name}</span>
                      <span className="truncate text-xs text-fg-tertiary">
                        {request.course.name} · asked {formatRelative(request.requestedAt)}
                      </span>
                    </div>
                    <Button asChild variant="secondary" size="sm" className="shrink-0">
                      <Link to="/courses/$courseId" params={{ courseId: request.course.id }}>
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

/**
 * `seatsRemaining` and `isFull` are served pre-computed on every course payload
 * (course.ts:37-39) precisely so no screen recomputes them and drifts from the answer
 * the enrol button is gated on. Only the bar's WIDTH is derived here, because a
 * percentage is presentation rather than a domain fact.
 */
function CapacityBar({
  approved,
  capacity,
  seatsRemaining,
  isFull,
}: {
  approved: number;
  capacity: number;
  seatsRemaining: number;
  isFull: boolean;
}) {
  const ratio = capacity > 0 ? Math.min(1, approved / capacity) : 0;

  return (
    <div className="flex flex-col gap-1.5 pt-1">
      <div className="flex items-center justify-between text-2xs text-fg-tertiary">
        <span>
          {approved} of {capacity} places taken
        </span>
        {isFull ? (
          <span className="font-semibold text-danger-fg">Full</span>
        ) : (
          <span>{seatsRemaining} left</span>
        )}
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
          className={cn('h-full rounded-full', isFull ? 'bg-danger' : 'bg-brand')}
          style={{ inlineSize: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
}
