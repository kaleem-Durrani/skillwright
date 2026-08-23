import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Download,
  ExternalLink,
  FileText,
  Link2,
  Video,
  type LucideIcon,
} from 'lucide-react';
import { rejectEnrollmentSchema } from '@skillwright/shared/schema';
import { api, type Paginated } from '@/lib/api';
import { qk } from '@/lib/query';
import { subject, usePolicy, type PolicySubject } from '@/lib/policy';
import { formatBytes, formatDate, formatDuration, formatRelative } from '@/lib/format';
import type {
  CourseDetail,
  DownloadUrlResponse,
  EnrollmentDto,
  ResourceDto,
  ResourceTypeValue,
} from '@/lib/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { DataList } from '@/components/ui/DataList';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonCard, SkeletonList } from '@/components/ui/Skeleton';
import { StatusChip } from '@/components/ui/StatusChip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { Textarea } from '@/components/ui/Textarea';
import { toast } from '@/components/ui/Toast';
import { Route } from '@/routes/_app/courses.$courseId';

/**
 * Keyed by `ResourceTypeValue` (resource.ts:11-12), not by whatever the object
 * literal happens to contain. The key type is what makes `RESOURCE_ICON[resource.type]`
 * a checked lookup instead of an implicit-any index, and it means adding a fourth
 * resource type to the schema breaks THIS line rather than rendering `undefined` as a
 * component at runtime.
 */
const RESOURCE_ICON: Record<ResourceTypeValue, LucideIcon> = {
  DOCUMENT: FileText,
  VIDEO: Video,
  LINK: Link2,
};

/**
 * The policy Subject for every course-scoped decision on this screen, built to match
 * the SERVER's loaders field for field — `loadCourseSubject` and
 * `loadCourseEnrollmentSubject` (courses.service.ts:110-159).
 *
 * The key names are the whole point. Every `Subject` field is optional and a rule that
 * reads an absent field DENIES rather than throws (actor.ts:46-51), so a plausible-looking
 * wrong key is a silent, permanent denial:
 *
 *   - `courseTeacherId`, never `teacherId` — `ownsCourse` reads the former
 *     (combinators.ts:55-59). With `teacherId` the owning teacher got no "Edit course",
 *     no Students tab and no Approve button on their own course.
 *   - `enrollmentStatus`, never `viewerEnrollmentStatus` — `enrolledApproved` reads the
 *     former (combinators.ts:62-65). With the DTO's name an approved student was denied
 *     `resource:read`, so the Resources tab never even fetched.
 *
 * `capacity` and `approvedCount` are gone because no rule reads them: seats are checked
 * by the service under SERIALIZABLE, not by the policy, and `isFull` on the DTO is what
 * the button disables on.
 *
 * `studentId` is deliberately NOT set. The server adds it for a STUDENT so
 * `isEnrolledStudent` passes and the enrollments service then narrows the rows to that
 * student's own; on the client the same subject would open a "Students" roster that
 * shows one person their own request, which the header's StatusChip already says. Being
 * NARROWER than the server hides nothing a student needs and renders no button that
 * would 403 — the failure this layer exists to prevent.
 */
function courseSubject(course: CourseDetail): PolicySubject {
  return subject({
    id: course.id,
    courseId: course.id,
    courseTeacherId: course.teacher.id,
    departmentId: course.department.id,
    publishedAt: course.publishedAt,
    enrollmentStatus: course.viewerEnrollmentStatus,
  });
}

/**
 * The Subject for ONE resource row. `resource:download` is
 * `or(isPublic, enrolledApproved)` for a student and `or(isPublic, ownsCourse, isAuthor)`
 * for a teacher (policy.ts:217-226), so the decision needs three fields the resource
 * carries plus two only the course knows.
 *
 * WHY it is not `subject({ ...resource })`: a spread supplies `isPublic` and `courseId`
 * and nothing else the rules read. `ResourceDto` nests `author: UserSummary`, so there is
 * no `authorId` to spread (resource.ts:21), and it carries neither the course's teacher
 * nor the viewer's enrollment — which left the teacher who wrote the file, and the
 * student who is enrolled in the course, both unable to see a Download button.
 */
function resourceSubject(resource: ResourceDto, course: CourseDetail): PolicySubject {
  return subject({
    id: resource.id,
    courseId: resource.courseId,
    courseTeacherId: course.teacher.id,
    authorId: resource.author.id,
    isPublic: resource.isPublic,
    // The COURSE's publication state. Both read rules' public branch is
    // `and(isPublic, isPublished)`, so a resource in a draft course is not public to
    // anyone but its teacher, its author, an approved student and an admin. Omitting it
    // here would hide the Download button from people the API would serve — the
    // client-side half of LESSONS-LEARNED #31.
    publishedAt: course.publishedAt,
    enrollmentStatus: course.viewerEnrollmentStatus,
  });
}

/**
 * Approve carries an optional note, reject carries a MANDATORY reason — two different
 * bodies for two different endpoints (enrollment.ts:39-49), which is why this is a union
 * and not one optional string. The old single `decisionNote` field matched neither
 * schema, so every decision this screen sent was answered 422 before the policy gate ran.
 */
type Decision =
  | { id: string; action: 'approve'; note?: string }
  | { id: string; action: 'reject'; reason: string };

/**
 * Never bodyless, even when there is nothing to say: Fastify hands a POST with no body
 * to the validator as `null`, which an all-optional object schema rejects — the failure
 * `courses.routes.ts:159-165` records from the server side.
 */
function decisionBody(decision: Decision): Record<string, string> {
  if (decision.action === 'reject') return { reason: decision.reason };
  return decision.note === undefined ? {} : { note: decision.note };
}

export function CourseDetailPage() {
  const { courseId } = Route.useParams();
  const policy = usePolicy();
  const client = useQueryClient();
  const [rejecting, setRejecting] = useState<EnrollmentDto | null>(null);

  // `GET /courses/:id` serves `courseDetailSchema` (courses.routes.ts:70-79) — the
  // summary plus the blurb, the dates, the syllabus and the viewer's own enrollment.
  const course = useQuery({
    queryKey: qk.course(courseId),
    queryFn: () => api.get<CourseDetail>(`/courses/${courseId}`),
  });

  /**
   * The policy subject is built from what THIS screen has loaded — teacher,
   * publication state, the viewer's own enrolment. Nothing is fetched by the
   * policy layer itself; `can()` is a pure function over this bag.
   */
  const viewerSubject = course.data ? courseSubject(course.data) : undefined;

  /*
   * No `enabled` gate, deliberately — and it used to have one.
   *
   * `resource:read` is decided PER ROW: its anonymous rule is `isPublic` and its
   * STUDENT rule is `or(isPublic, enrolledApproved)` (policy.ts:191-196). The gate here
   * asked that question with `viewerSubject`, which is a COURSE — and a course has no
   * `isPublic`, only `publishedAt`. So the `isPublic` disjunct could never fire and the
   * tab was closed to every signed-in non-admin who was not enrolled, while the API
   * served those same public rows to anyone including logged-out visitors. Driven in a
   * browser on 2026-08-23: four public resources, visible to `curl`, invisible to a
   * teacher looking at a colleague's course.
   *
   * This is the shape of mistake LESSONS-LEARNED #15 describes, one step along: not a
   * `can()` with NO subject, but a `can()` with the wrong KIND of subject. Both fail
   * silently and both deny.
   *
   * A list has no single subject, so it does not get a subject gate. The server scopes
   * the rows — `visibilityWhere` in resources.service.ts mirrors the same policy rows
   * as SQL, and the route's own gate is `course:read`, which being on this page already
   * satisfies. What comes back is what this viewer may see.
   */
  const resources = useQuery({
    queryKey: qk.courseResources(courseId),
    queryFn: () => api.get<Paginated<ResourceDto>>(`/courses/${courseId}/resources`),
  });

  const enrollments = useQuery({
    queryKey: qk.courseEnrollments(courseId),
    queryFn: () => api.get<Paginated<EnrollmentDto>>(`/courses/${courseId}/enrollments`),
    enabled: policy.can('enrollment:read', viewerSubject),
  });

  // The path owns the course, so the body is empty; the route declares it `.nullish()`
  // for exactly this call (courses.routes.ts:154-167) and answers with the new row.
  const requestEnrollment = useMutation({
    mutationFn: () => api.post<EnrollmentDto>(`/courses/${courseId}/enrollments`),
    onSuccess: async () => {
      toast.success('Request sent', {
        description: 'The teacher will review it. You will be notified either way.',
      });
      await client.invalidateQueries({ queryKey: qk.course(courseId) });
    },
    onError: (error) => toast.fromError(error, 'Could not send that request'),
  });

  const decide = useMutation({
    mutationFn: (decision: Decision) =>
      api.post<EnrollmentDto>(
        `/enrollments/${decision.id}/${decision.action}`,
        decisionBody(decision),
      ),
    onSuccess: async () => {
      setRejecting(null);
      await Promise.all([
        client.invalidateQueries({ queryKey: qk.courseEnrollments(courseId) }),
        client.invalidateQueries({ queryKey: qk.course(courseId) }),
      ]);
    },
    onError: (error) => toast.fromError(error, 'Could not record that decision'),
  });

  /*
   * `GET /resources/:id/download` answers `{ url, expiresAt, filename }`
   * (upload.ts:108-113) — a URL signed for five minutes against a PRIVATE bucket,
   * never a path. The gate is `resource:download`, which is strictly narrower than
   * the `resource:read` that got the row onto this screen: anonymous is `deny`
   * (policy.ts:217-226), so a logged-out visitor sees the row and is answered 401
   * for the bytes.
   *
   * `window.location.assign`, not an `<a download>`: the signed GET carries
   * `ResponseContentDisposition: attachment` (storage.ts:178-196), so the
   * browser saves the file and this page stays put — no navigation, no lost query
   * cache. The `download` attribute would have been the obvious alternative and is
   * ignored on a cross-origin href by every browser, which is exactly why the server
   * puts the name in the disposition header. The response's `filename` is therefore
   * for display, not for wiring, and nothing here needs it.
   *
   * ONE mutation for the whole list, not one per row — hooks cannot be called from
   * inside `renderCard`. `variables` holds the id it was called with while the
   * request is in flight, which is how only the clicked row shows a spinner.
   */
  const download = useMutation({
    mutationFn: (resourceId: string) =>
      api.get<DownloadUrlResponse>(`/resources/${resourceId}/download`),
    onSuccess: (result) => window.location.assign(result.url),
    // A 409 lands here too — the row's upload was presigned but never committed, so
    // there are no bytes (resources.service.ts:439-441). It renders as the generic
    // CONFLICT copy, because the SPA renders errors by `code` and never by `detail`
    // (LESSONS-LEARNED #25); the fallback below is only for a transport failure,
    // which carries no code at all.
    onError: (error) => toast.fromError(error, 'Could not start that download'),
  });

  if (course.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <SkeletonCard />
        <SkeletonList rows={3} />
      </div>
    );
  }

  if (!course.data) {
    return (
      <EmptyState
        variant="error"
        title="Course unavailable"
        description="This course could not be loaded. It may have been removed."
      />
    );
  }

  const data = course.data;
  // Derived server-side and shipped on the DTO (course.ts:37-39). The SPA never redoes
  // capacity arithmetic, because two answers to "is it full" is one answer too many.
  const isFull = data.isFull;
  const pendingCount =
    enrollments.data?.data.filter((entry) => entry.status === 'PENDING').length ?? 0;

  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow={
          <Link
            to="/courses"
            search={{ page: 1 }}
            className="inline-flex items-center gap-1.5 text-fg-secondary hover:text-fg"
          >
            <ArrowLeft aria-hidden="true" className="size-3.5" />
            All courses
          </Link>
        }
        title={data.name}
        description={data.description ?? undefined}
        actions={
          <>
            {data.viewerEnrollmentStatus ? (
              <StatusChip status={data.viewerEnrollmentStatus} />
            ) : policy.can('enrollment:request', viewerSubject) ? (
              <Button
                block
                className="sm:w-auto"
                disabled={isFull}
                loading={requestEnrollment.isPending}
                onClick={() => requestEnrollment.mutate()}
              >
                {isFull ? 'Course is full' : 'Request enrolment'}
              </Button>
            ) : null}

            {policy.can('course:update', viewerSubject) ? (
              <Button variant="secondary" block className="sm:w-auto">
                Edit course
              </Button>
            ) : null}
          </>
        }
      />

      <dl className="grid grid-cols-2 gap-3 pb-6 lg:grid-cols-4">
        <Fact label="Code" value={data.code} />
        <Fact label="Department" value={data.department.name} />
        <Fact label="Teacher" value={data.teacher.name} />
        <Fact label="Duration" value={formatDuration(data.duration.value, data.duration.unit)} />
        <Fact label="Starts" value={formatDate(data.startDate)} />
        <Fact label="Ends" value={formatDate(data.endDate)} />
        <Fact label="Places" value={`${data.approvedCount} / ${data.capacity}`} />
        <Fact label="Visibility" value={data.publishedAt ? 'Published' : 'Draft'} />
      </dl>

      <Tabs defaultValue="resources">
        <TabsList>
          <TabsTrigger value="resources">Resources</TabsTrigger>
          {policy.can('enrollment:read', viewerSubject) ? (
            <TabsTrigger value="students" count={pendingCount}>
              Students
            </TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="resources">
          {resources.isPending ? (
            <SkeletonList rows={3} />
          ) : (
            <DataList
              items={resources.data?.data ?? []}
              caption="Course resources"
              getKey={(resource) => resource.id}
              columns={[
                {
                  id: 'title',
                  header: 'Resource',
                  cell: (resource) => <span className="font-medium text-fg">{resource.title}</span>,
                },
                { id: 'type', header: 'Type', cell: (resource) => resource.type },
                {
                  id: 'author',
                  header: 'Added by',
                  cell: (resource) => resource.author.name,
                  secondary: true,
                },
                {
                  id: 'added',
                  header: 'Added',
                  cell: (resource) => formatRelative(resource.createdAt),
                  secondary: true,
                },
                {
                  id: 'access',
                  header: 'Access',
                  align: 'end',
                  cell: (resource) => (
                    <StatusChip status={resource.isPublic ? 'PUBLIC' : 'PRIVATE'} />
                  ),
                },
                /*
                 * The affordance has to be in BOTH renderings, because they are not a
                 * fallback and a primary: `DataList` puts the card list and the table in
                 * the DOM together and switches them with `display` at `md`
                 * (DataList.tsx:75-101). Wiring only `renderCard` would have shipped a
                 * download button that no desktop viewport can ever show — the tab has
                 * looked complete on a phone and had no way to fetch a file on a laptop
                 * for as long as the dead button existed.
                 */
                {
                  id: 'open',
                  header: 'Open',
                  align: 'end',
                  cell: (resource) =>
                    policy.can('resource:download', resourceSubject(resource, data)) ? (
                      <ResourceAccess
                        resource={resource}
                        pending={download.isPending && download.variables === resource.id}
                        onDownload={() => download.mutate(resource.id)}
                      />
                    ) : null,
                },
              ]}
              renderCard={(resource) => {
                const Icon = RESOURCE_ICON[resource.type];
                return (
                  <Card className="flex gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-md bg-sunken text-fg-tertiary">
                      <Icon aria-hidden="true" className="size-5" />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <CardTitle className="text-sm">{resource.title}</CardTitle>
                      {resource.description ? (
                        <p className="line-clamp-2 text-xs text-fg-secondary">
                          {resource.description}
                        </p>
                      ) : null}
                      <p className="text-2xs text-fg-tertiary">
                        {resource.author.name} · {formatRelative(resource.createdAt)}
                        {resource.sizeBytes ? ` · ${formatBytes(resource.sizeBytes)}` : ''}
                      </p>
                      {policy.can('resource:download', resourceSubject(resource, data)) ? (
                        <ResourceAccess
                          resource={resource}
                          className="mt-1 self-start"
                          pending={download.isPending && download.variables === resource.id}
                          onDownload={() => download.mutate(resource.id)}
                        />
                      ) : null}
                    </div>
                  </Card>
                );
              }}
              empty={
                /*
                 * Three descriptions, because an empty list means three different
                 * things and only one of them used to be said.
                 *
                 * "The teacher has not published anything" is a claim about the whole
                 * course, and a viewer without an approved enrolment cannot know that:
                 * the list they were served is the PUBLIC slice, so private material
                 * may well exist. Saying it anyway was a guess dressed as a fact. The
                 * middle branch says only what is true from where they stand, and
                 * still does not confirm that anything private is there.
                 *
                 * There is no "Add a resource" action any more. It called
                 * `() => undefined`. `POST /resources` exists now, but no screen builds
                 * that form yet, and a button that does nothing is worse than no button
                 * — the same call as the suspend dialog's reinstatement promise.
                 */
                <EmptyState
                  variant="empty"
                  title="No resources yet"
                  description={
                    policy.can('resource:create', viewerSubject)
                      ? 'Nothing has been added to this course yet.'
                      : data.viewerEnrollmentStatus === 'APPROVED'
                        ? 'The teacher has not published anything for this course yet.'
                        : 'Nothing public has been published here. Enrolled students may see more.'
                  }
                />
              }
            />
          )}
        </TabsContent>

        {policy.can('enrollment:read', viewerSubject) ? (
          <TabsContent value="students">
            <DataList
              items={enrollments.data?.data ?? []}
              loading={enrollments.isPending}
              caption="Enrolled students and requests"
              getKey={(entry) => entry.id}
              columns={[
                {
                  id: 'student',
                  header: 'Student',
                  /*
                   * Name and avatar, no email. The old second line read
                   * `entry.studentEmail`, which no endpoint has ever served:
                   * `EnrollmentDto.student` is a `UserSummary` — `{ id, name, role,
                   * avatarUrl }` and nothing else (user.ts:22-27) — because it is embedded
                   * in payloads other students can read. The email lives on `UserDetail`,
                   * which this response does not carry and `enrollment:read` does not
                   * entitle the screen to fetch.
                   */
                  cell: (entry) => (
                    <div className="flex items-center gap-2.5">
                      <Avatar name={entry.student.name} src={entry.student.avatarUrl} size="sm" />
                      <span className="truncate font-medium text-fg">{entry.student.name}</span>
                    </div>
                  ),
                },
                {
                  id: 'requested',
                  header: 'Requested',
                  cell: (entry) => formatRelative(entry.requestedAt),
                  secondary: true,
                },
                {
                  id: 'status',
                  header: 'Status',
                  cell: (entry) => <StatusChip status={entry.status} />,
                },
                {
                  id: 'actions',
                  header: 'Decision',
                  align: 'end',
                  cell: (entry) =>
                    entry.status === 'PENDING' ? (
                      <DecisionButtons
                        onApprove={() => decide.mutate({ id: entry.id, action: 'approve' })}
                        onReject={() => setRejecting(entry)}
                        disabled={
                          decide.isPending || !policy.can('enrollment:approve', viewerSubject)
                        }
                      />
                    ) : (
                      <span className="text-xs text-fg-tertiary">
                        {formatDate(entry.decidedAt)}
                      </span>
                    ),
                },
              ]}
              renderCard={(entry) => (
                <Card className="flex flex-col gap-3">
                  <div className="flex items-start gap-3">
                    <Avatar name={entry.student.name} src={entry.student.avatarUrl} size="md" />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">{entry.student.name}</span>
                      <span className="truncate text-2xs text-fg-tertiary">
                        Requested {formatRelative(entry.requestedAt)}
                      </span>
                    </div>
                    <StatusChip status={entry.status} />
                  </div>
                  {entry.decisionNote ? (
                    <p className="text-xs text-fg-secondary">{entry.decisionNote}</p>
                  ) : null}
                  {entry.status === 'PENDING' && policy.can('enrollment:approve', viewerSubject) ? (
                    <DecisionButtons
                      block
                      onApprove={() => decide.mutate({ id: entry.id, action: 'approve' })}
                      onReject={() => setRejecting(entry)}
                      disabled={decide.isPending}
                    />
                  ) : null}
                </Card>
              )}
              empty={
                <EmptyState
                  variant="empty"
                  title="Nobody has asked yet"
                  description="Enrolment requests appear here the moment a student sends one."
                />
              }
            />
          </TabsContent>
        ) : null}
      </Tabs>

      <RejectDialog
        // Remounts per request, so the reason box never opens holding the text typed
        // for the previous student.
        key={rejecting?.id ?? 'none'}
        enrollment={rejecting}
        pending={decide.isPending}
        onClose={() => setRejecting(null)}
        onConfirm={(reason) =>
          rejecting && decide.mutate({ id: rejecting.id, action: 'reject', reason })
        }
      />
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-2xs tracking-wide text-fg-tertiary uppercase">{label}</dt>
      <dd className="text-sm font-medium text-fg">{value}</dd>
    </div>
  );
}

/**
 * The one thing a viewer can do with a resource row, rendered identically by the card
 * list and by the table so the two cannot drift.
 *
 * The branch is on `uploadId`, NOT on `type === 'LINK'`, and mirrors the server's
 * (resources.service.ts:420-424, :436): `type` is a label the creator picks (resource.ts:11)
 * while the CHECK from migration 0002 is what actually guarantees one source per row.
 * `createResourceSchema` forbids only the other pairing — a LINK may not carry an upload
 * (resource.ts:56-62) — so a row typed DOCUMENT and backed by an `externalUrl` is legal,
 * and branching on the label would offer it a Download button the API answers 409.
 *
 * Neither affordance styles itself. `Button` carries the focus ring the whole app uses
 * (Button.tsx:23), and `asChild` hands those same classes to the anchor through Radix's
 * Slot — which matters more than tidiness here: Tailwind v4 compiles `outline-2` to
 * `outline-style: var(--tw-outline-style)`, and the `outline-none` sitting on the same
 * element sets that variable to `none`. A ring hand-written without `outline-solid`
 * paints a width and a colour over a style of `none` and renders nothing at all, and
 * neither axe nor the mobile-first lint evaluates `:focus-visible`, so it fails silently.
 */
function ResourceAccess({
  resource,
  pending,
  onDownload,
  className,
}: {
  resource: ResourceDto;
  pending: boolean;
  onDownload: () => void;
  className?: string;
}) {
  if (resource.uploadId === null) {
    // No upload and no URL cannot happen — the CHECK forbids it — but the DTO types both
    // as nullable, so the impossible row renders nothing rather than a dead anchor.
    if (resource.externalUrl === null) return null;
    return (
      <Button asChild variant="secondary" size="sm" className={className}>
        {/*
         * `target="_blank"` needs `rel="noreferrer noopener"`: `noopener` denies the new
         * document a handle on this one via `window.opener`, and `noreferrer` withholds
         * the referrer, which for a course page leaks the course id to a third party.
         * The visible label plus the arrow say "you are leaving"; the sr-only tail says
         * it to a screen reader, which cannot see the arrow.
         */}
        <a href={resource.externalUrl} target="_blank" rel="noreferrer noopener">
          <ExternalLink aria-hidden="true" className="size-4" />
          Open link
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </Button>
    );
  }

  return (
    <Button
      variant="secondary"
      size="sm"
      className={className}
      loading={pending}
      leadingIcon={<Download aria-hidden="true" className="size-4" />}
      onClick={onDownload}
    >
      Download
    </Button>
  );
}

function DecisionButtons({
  onApprove,
  onReject,
  disabled,
  block = false,
}: {
  onApprove: () => void;
  onReject: () => void;
  disabled?: boolean;
  block?: boolean;
}) {
  return (
    <div className={block ? 'flex flex-col gap-2 sm:flex-row' : 'flex justify-end gap-2'}>
      <Button size="sm" onClick={onApprove} disabled={disabled} block={block}>
        Approve
      </Button>
      <Button size="sm" variant="secondary" onClick={onReject} disabled={disabled} block={block}>
        Reject
      </Button>
    </div>
  );
}

function RejectDialog({
  enrollment,
  pending,
  onClose,
  onConfirm,
}: {
  enrollment: EnrollmentDto | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');

  /*
   * The reason is REQUIRED, and the rule is the shared schema's rather than a length
   * copied out of it: `rejectEnrollmentSchema` is `min(4).max(500)` because the reason is
   * the only thing the student is ever shown (enrollment.ts:45-49). Checking it here
   * means the button that would be answered 422 is disabled instead of sent — the same
   * arrangement `Settings.tsx:52-57` uses for `phoneSchema`.
   */
  const isValid = rejectEnrollmentSchema.safeParse({ reason }).success;

  return (
    <Dialog open={enrollment !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title="Reject this request?"
        description={
          enrollment
            ? `${enrollment.student.name} will be told, and will see whatever you write below.`
            : undefined
        }
        footer={
          <>
            <Button variant="ghost" block className="sm:w-auto" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="danger"
              block
              className="sm:w-auto"
              loading={pending}
              disabled={!isValid}
              onClick={() => onConfirm(reason)}
            >
              Reject request
            </Button>
          </>
        }
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Reason</span>
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            autoResize
            placeholder="This intake is full — apply again for the spring cohort."
          />
          <span className="text-2xs text-fg-tertiary">
            Required, and shown to the student. At least four characters.
          </span>
        </label>
      </DialogContent>
    </Dialog>
  );
}
