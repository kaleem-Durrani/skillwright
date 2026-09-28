import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ClipboardList,
  Download,
  ExternalLink,
  FileText,
  Link2,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
  Video,
  type LucideIcon,
} from 'lucide-react';
import { rejectEnrollmentSchema, MAX_PAGE_SIZE } from '@skillwright/shared/schema';
import { api, type Paginated } from '@/lib/api';
import { qk } from '@/lib/query';
import { subject, useCompletedCourseIds, usePolicy, type PolicySubject } from '@/lib/policy';
import { courseViewerStatus, formatOfferingDates } from '@/lib/offerings';
import { ApiError } from '@/lib/problem';
import { useSession } from '@/lib/session';
import { formatBytes, formatDuration, formatRelative } from '@/lib/format';
import type {
  CourseDetail,
  DownloadUrlResponse,
  EnrollmentDto,
  ResourceDto,
  ResourceTypeValue,
} from '@/lib/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { AttendanceRegister } from '@/components/attendance/AttendanceRegister';
import { EnrollmentAttendance } from '@/components/attendance/EnrollmentAttendance';
import { CourseOfferings } from '@/components/courses/CourseOfferings';
import {
  CompletionStamp,
  EnrollmentCompletionActions,
} from '@/components/courses/EnrollmentCompletionActions';
import { MessageTeacherButton } from '@/components/courses/MessageTeacherButton';
import { RegisterExportButtons } from '@/components/courses/RegisterExportButtons';
import { ViewerSeatActions } from '@/components/courses/ViewerSeatActions';
import { AssignmentsPanel } from '@/components/assignments/AssignmentsPanel';
import { EnrollmentCertificateActions } from '@/components/certificates/EnrollmentCertificateActions';
import { IssueCertificateDialog } from '@/components/certificates/IssueCertificateDialog';
import { QualificationsPanel } from '@/components/certificates/QualificationsPanel';
import { ResourceFormDialog } from '@/components/resources/ResourceFormDialog';
import { Avatar } from '@/components/ui/Avatar';
import { Button, IconButton } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu';
import { EmptyState } from '@/components/ui/EmptyState';
import { FormField } from '@/components/ui/FormField';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/Select';
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
  // Added in migration 0010, which reversed the reservation at schema.prisma:75-78:
  // an assignment's brief is course material, so it is filed as a Resource rather than
  // through a second attachment mechanism. Icon rather than removed, because the key
  // type is what makes this a checked lookup — deleting the entry would restore
  // exactly the implicit-any index the Record exists to prevent.
  ASSIGNMENT: ClipboardList,
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
 *   - `enrollmentStatus`, never the DTO's field name — `enrolledApproved` reads the
 *     former (combinators.ts:62-65). With the DTO's name an approved student was denied
 *     `resource:read`, so the Resources tab never even fetched. Since Phase 9 the
 *     per-intake statuses live in `offerings`; the COURSE-level answer is DERIVED from
 *     them (`courseViewerStatus`), because that is what the server's own loader does:
 *     APPROVED on any live intake wins.
 *
 * `capacity` and `approvedCount` are gone because no rule reads them: seats are checked
 * by the service under SERIALIZABLE, not by the policy, and the offerings' `isFull`
 * flags are what the enrol buttons disable on.
 *
 * `prerequisiteCourseId` and `completedCourseIds` are BACK, because a rule now reads
 * them: `enrollment:request` composes `and(isPublished, hasCompletedPrerequisite)`, and
 * that combinator reads both (combinators.ts). They are the client half of what
 * `loadCourseEnrollmentSubject` loads server-side — the rung this course names, and the
 * rungs the VIEWER has completed. Omitting either denies every gated course silently and
 * hides an enrol button the API would serve: LESSONS-LEARNED #31 again, in its newest
 * costume. The completed list travels only for a STUDENT, exactly as the server loader
 * scopes it — no other role's cell for this action reads it.
 *
 * `studentId` is deliberately NOT set. The server adds it for a STUDENT so
 * `isEnrolledStudent` passes and the enrollments service then narrows the rows to that
 * student's own; on the client the same subject would open a "Students" roster that
 * shows one person their own request, which the intakes section already says. Being
 * NARROWER than the server hides nothing a student needs and renders no button that
 * would 403 — the failure this layer exists to prevent.
 */
function courseSubject(
  course: CourseDetail,
  completedCourseIds?: readonly string[],
): PolicySubject {
  return subject({
    id: course.id,
    courseId: course.id,
    courseTeacherId: course.teacher.id,
    departmentId: course.department.id,
    publishedAt: course.publishedAt,
    // Derived from the per-intake statuses — APPROVED anywhere wins, which is every
    // rule's reading of this field (only `enrolledApproved` consumes it).
    enrollmentStatus: courseViewerStatus(course.offerings),
    // Explicit null means "ungated" — the DTO always carries the field, so the
    // subject must too. An ABSENT key would deny even an ungated course.
    prerequisiteCourseId: course.prerequisiteCourseId,
    ...(completedCourseIds ? { completedCourseIds } : {}),
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
    // Derived per intake → course, exactly as `courseSubject` does.
    enrollmentStatus: courseViewerStatus(course.offerings),
  });
}

/**
 * Every decision this screen sends to `POST /enrollments/:id/<verb>`, as one
 * union rather than four mutations.
 *
 * Four shapes, because the wire does: `reject` carries a MANDATORY reason, the two
 * completion verbs carry an optional note or nothing, and `withdraw` carries a
 * reason that is OPTIONAL on the wire (enrollment.ts:67-70) and is collected by
 * `ViewerSeatActions`' own dialog rather than here. The old single `decisionNote`
 * field matched neither the rejection nor the approval schema, so every decision
 * this screen sent was answered 422 before the policy gate ran.
 */
type Decision =
  | { id: string; action: 'approve'; note?: string }
  | { id: string; action: 'reject'; reason: string }
  | { id: string; action: 'complete'; note?: string }
  | { id: string; action: 'uncomplete' };

/**
 * Never bodyless, even when there is nothing to say: Fastify hands a POST with no body
 * to the validator as `null`, which an all-optional object schema rejects — the
 * failure `courses.routes.ts:159-165` records from the server side. `uncomplete` is
 * bodyless BY CONTRACT and is bound `.nullish()` for the same reason, so it sends
 * the empty object rather than nothing.
 */
function decisionBody(decision: Decision): Record<string, string> {
  if (decision.action === 'reject') return { reason: decision.reason };
  if (decision.action === 'uncomplete') return {};
  return decision.note === undefined ? {} : { note: decision.note };
}

export function CourseDetailPage() {
  const { courseId } = Route.useParams();
  const policy = usePolicy();
  const client = useQueryClient();
  const { user } = useSession();
  const [rejecting, setRejecting] = useState<EnrollmentDto | null>(null);

  /**
   * The role read that scopes the completed-courses lookup below — the same single
   * legitimate read `ViewerAttendanceSection` makes. `hasCompletedPrerequisite` is
   * only ever asked of a STUDENT's subject; every other role's `enrollment:request`
   * cell decides on the role alone.
   */
  const isStudent = user?.role === 'STUDENT';

  /**
   * The seat a certificate dialog is open for, or `null`.
   *
   * One value rather than an `open` boolean beside a nullable row, for the reason
   * `resourceForm` above gives: there is no way to represent an open dialog that is
   * neither creating nor editing, which is the state a stale `setOpen(true)` produces.
   * The dialog is remounted per target by `key` below, so it never opens holding the
   * previous student's name.
   */
  const [issuingFor, setIssuingFor] = useState<EnrollmentDto | null>(null);

  /**
   * The resource form's target in ONE value: `null` is closed, `'new'` is create, and a
   * row is edit-that-row.
   *
   * Not an `open` boolean beside a nullable row, because those two can disagree and this
   * cannot: there is no way to represent an open form that is neither creating nor
   * editing, which is the state a stale `setOpen(true)` produces and which
   * `ResourceFormDialog` would have to guess its way out of.
   */
  const [resourceForm, setResourceForm] = useState<ResourceDto | 'new' | null>(null);
  const [deletingResource, setDeletingResource] = useState<ResourceDto | null>(null);
  /**
   * The intake whose register and exports are on screen. Null means "the soonest
   * live one" — resolved below against THIS course's offerings, so a stale id left
   * over from another course's visit can never pin a register to an intake that is
   * not on the page.
   */
  const [registerOfferingId, setRegisterOfferingId] = useState<string | null>(null);

  // `GET /courses/:id` serves `courseDetailSchema` (courses.routes.ts:70-79) — the
  // summary plus the blurb, the dates, the syllabus and the viewer's own enrollment.
  const course = useQuery({
    queryKey: qk.course(courseId),
    queryFn: () => api.get<CourseDetail>(`/courses/${courseId}`),
  });

  /**
   * The viewer's completed rungs, fetched whenever a STUDENT is on screen: since
   * Phase 9 every open intake carries its own enrol affordance, and each of those
   * decisions reads this list (`hasCompletedPrerequisite`). A student already seated
   * on one intake can still apply to the next, so "already approved" no longer
   * spares anyone the lookup.
   */
  const completed = useCompletedCourseIds(isStudent);

  /**
   * The policy subject is built from what THIS screen has loaded — teacher,
   * publication state, the viewer's own enrolment and, for a student, their
   * completed courses. Nothing else is fetched by the policy layer itself; `can()`
   * is a pure function over this bag.
   */
  const viewerSubject = course.data
    ? courseSubject(course.data, isStudent ? completed.completedCourseIds : undefined)
    : undefined;

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

  // The path owns the course, so the body used to be empty; since Phase 9 the POST
  // requires an `offeringId`, and naming the intake is the offerings section's job —
  // one affordance per row, where the seats and dates actually live.

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
        /*
         * The `['enrollments']` PREFIX, and this is the third key for a reason that
         * is not uniformity. The self-scoped list is read by three screens from three
         * keys — `ViewerSeatActions` and the viewer's own attendance below, plus the
         * completed-rungs lookup behind every enrol button in the intakes section —
         * and a completion is the one decision that CHANGES what that lookup answers:
         * a course recorded COMPLETED stops being an APPROVED seat, so a stale
         * `completedCourseIds` would keep a met prerequisite looking unmet and a
         * student off a course they have finished. See `useCompletedCourseIds`,
         * which reads the same endpoint.
         */
        client.invalidateQueries({ queryKey: ['enrollments'] }),
      ]);
    },
    onError: (error, decision) => {
      /*
       * CAPACITY_EXCEEDED maps to one sentence per code (problem.ts ERROR_COPY:
       * "This course is full."), and the 409's distinguishing `detail` is
       * diagnostics, not user copy — the SPA renders errors by code, never by
       * detail (LESSONS-LEARNED #25). Which bound fired is not a mystery to THIS
       * screen, though: the cached enrolment row carries its intake, and that
       * intake knows both bounds and the derived remainder. When the workshop is
       * the exhausted one on THAT INTAKE, the teacher gets that sentence instead
       * of a wrong "course full"; anything else keeps the code-mapped default.
       */
      if (error instanceof ApiError && error.is('CAPACITY_EXCEEDED')) {
        const row = enrollments.data?.data.find((entry) => entry.id === decision.id);
        if (
          row !== undefined &&
          row.offering.workshopCapacity !== null &&
          row.offering.workshopSeatsRemaining === 0
        ) {
          toast.error('The workshop for this intake is full');
          return;
        }
      }
      toast.fromError(error, 'Could not record that decision');
    },
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

  /*
   * `DELETE /resources/:id` answers 204 with no body (resources.routes.ts:149-160), and
   * the service only stamps `deletedAt` (resources.service.ts:609-620) — the row and its
   * comments stay in the database. `api.del` returns `undefined` for a 204, so nothing
   * here reads a result, and the declared `void` says that rather than inventing a shape.
   *
   * BOTH keys are invalidated because the row is counted in two caches: the list under
   * `qk.courseResources`, and `resourceCount` on the course detail (course.ts:50).
   * Invalidating only the list leaves a count that disagrees with the rows under it.
   *
   * The row's upload is deliberately left alone by the server, so there is nothing to
   * clean up here either (resources.service.ts:597-608).
   */
  const removeResource = useMutation({
    mutationFn: (resourceId: string) => api.del<void>(`/resources/${resourceId}`),
    onSuccess: async () => {
      setDeletingResource(null);
      toast.success('Resource removed', {
        description: 'It is gone from the course. The discussion on it is kept.',
      });
      await Promise.all([
        client.invalidateQueries({ queryKey: qk.courseResources(courseId) }),
        client.invalidateQueries({ queryKey: qk.course(courseId) }),
      ]);
    },
    onError: (error) => toast.fromError(error, 'Could not remove that resource'),
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
  const pendingCount =
    enrollments.data?.data.filter((entry) => entry.status === 'PENDING').length ?? 0;

  /*
   * Enrolment refusal, computed from DATA so it can be SHOWN rather than acted on
   * by vanishing. Scoped to a STUDENT with the lookup ANSWERED, mirroring where the
   * server loader puts `completedCourseIds`. Before `ready` the state is unknown,
   * not unmet: refusing on data not yet received would disable enrolment on a guess,
   * which is LESSONS-LEARNED #15's failure pointed the other way.
   *
   * The rung is a COURSE fact — every intake's gate reads the same one — so this
   * single answer feeds every row of the intakes section below.
   */
  const prerequisiteUnmet =
    isStudent &&
    completed.ready &&
    data.prerequisite !== null &&
    !completed.completedCourseIds?.includes(data.prerequisite.id);

  /*
   * `resource:create` is COURSE-scoped — `ownsCourse` for a teacher, with no publication
   * term (policy.ts:221-228) — so it is asked with the course subject, exactly once, and
   * the same answer drives the header button and the empty state's action. Two `can()`
   * calls for one decision is two places for one of them to be given the wrong subject.
   */
  const canAddResource = policy.can('resource:create', viewerSubject);

  /*
   * The register's intake. The wire requires an `offeringId` on every attendance
   * read/write/export, so when a course runs several intakes the tab shows a
   * selector; the default is the SOONEST LIVE one (the payload's first row), which
   * for this tab's only permitted viewer — the owning teacher or an admin — is the
   * intake they are teaching next. A student never sees this tab, so "the viewer's
   * own intake" has no one to mean here.
   */
  /*
   * UNDEFINED when the course has no live intake, which is reachable: `deleteOffering`
   * (courses.service.ts) refuses to retire an intake that still holds pending or
   * approved seats, but nothing stops retiring the LAST one when it holds none. A
   * course created and then emptied lands here, and every consumer below dereferences
   * this. `noUncheckedIndexedAccess` is what surfaced it.
   */
  const selectedOffering =
    data.offerings.find((offering) => offering.id === registerOfferingId) ?? data.offerings[0];

  // `'new'` and `null` both mean "no row to edit". Narrowing here once keeps the two
  // props the dialog reads — `key` and `resource` — from disagreeing about which it is.
  const editingResource =
    resourceForm !== null && resourceForm !== 'new' ? resourceForm : undefined;

  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow={
          <Link
            to="/courses"
            search={{ page: 1 }}
            /*
             * `tap md:min-h-0`: this back-link measured 18px — the height of one
             * line of `text-sm` — and on a course page a phone user is most often
             * holding it because they have just scrolled a long syllabus, not
             * because they are at the top of anything. `md:min-h-0` restores the
             * natural line height from `md` up, where a pointer is not a thumb.
             */
            className="tap inline-flex items-center gap-1.5 text-fg-secondary hover:text-fg md:min-h-0"
          >
            <ArrowLeft aria-hidden="true" className="size-3.5" />
            All courses
          </Link>
        }
        title={data.name}
        description={data.description ?? undefined}
        actions={
          <>
            {/*
              Phase 5, gap 2. `/messages`' empty state says "Start one from a course
              page, or wait for a teacher to reach out" — and until this button no
              course page had the affordance, so the copy was a lie. The POST is
              find-or-create server-side, so this is one request and no client-side
              lookup to lose a race with; `MessageTeacherButton` carries the
              reasoning, and it renders nothing for the teacher themself.
            */}
            <MessageTeacherButton teacher={data.teacher} />

            {/*
              The enrol affordance lives in the Intakes section below, one per open
              intake — since Phase 9 a request NAMES an intake, so a header button
              would have to guess which one the student means. The section's
              disabled-with-reason rows carry the same visible-but-refusing pattern
              this header used to.
            */}
            {policy.can('course:update', viewerSubject) ? (
              <Button variant="secondary" block className="sm:w-auto">
                Edit course
              </Button>
            ) : null}

            {/*
              Served inside `courseDetailSchema` as a signed GET against the private
              bucket, minted by `toCourseDetail` only while the syllabus upload is
              COMMITTED — presence IS the permission. No policy gate wraps this: the
              URL reached only viewers who were already entitled to it, and inventing
              a client-side second answer is how #15/#31 denials get written.

              Null renders nothing — a disabled-looking affordance for a file that does
              not exist would read as broken, not as absent.

              The anchor is a real download link, not the resource rows'
              `window.location.assign` dance: there is no API call left to make, so the
              href can be the signed URL itself and navigation costs nothing. The
              `download` attribute states the intent for same-origin cases; on this
              cross-origin href browsers ignore it and do the right thing anyway,
              because the signed GET carries `ResponseContentDisposition: attachment`
              (storage.ts) — the page stays put and the file saves.
            */}
            {data.syllabusUrl ? (
              <Button asChild variant="secondary" block className="sm:w-auto">
                <a href={data.syllabusUrl} download>
                  <Download aria-hidden="true" className="size-4" />
                  Download syllabus
                </a>
              </Button>
            ) : null}
          </>
        }
      />

      <dl className="grid grid-cols-2 gap-3 pb-(--space-block) lg:grid-cols-4">
        <Fact label="Code" value={data.code} />
        <Fact label="Department" value={data.department.name} />
        <Fact label="Teacher" value={data.teacher.name} />
        <Fact label="Duration" value={formatDuration(data.duration.value, data.duration.unit)} />
        {/*
          Data-driven, viewer-independent: the rung this course names, shown to
          everyone whenever it names one. Whether the VIEWER has met it is the
          enrol buttons' business in the intakes section, not a fact about the
          template.
        */}
        {data.prerequisite !== null ? (
          <Fact label="Requires" value={`${data.prerequisite.code} · ${data.prerequisite.name}`} />
        ) : null}
        <Fact label="Visibility" value={data.publishedAt ? 'Published' : 'Draft'} />
      </dl>

      {/*
        The intakes — dates and seats live here since Phase 9, one row per scheduled
        run, with the per-intake enrol affordance for students and inline manage for
        the teacher or admin. Between the facts and the tabs because choosing an
        intake precedes everything else a visitor does on this page.
      */}
      <CourseOfferings
        course={data}
        viewerSubject={viewerSubject}
        prerequisiteUnmet={prerequisiteUnmet}
      />

      <Tabs defaultValue="resources">
        <TabsList>
          <TabsTrigger value="resources">Resources</TabsTrigger>
          {/*
            The training itself, and ungated by design.

            `assignment:read` is a SUBJECT-dependent rule — a student needs an APPROVED
            seat (`enrolledApproved`) and a teacher needs `ownsCourse` — so gating this
            tab on a subject-free `can()` would deny every viewer including admins, and
            gating it on the COURSE subject would deny every student who is actually
            seated, because the answer is per-INTKE. Both are LESSONS-LEARNED #15 and
            #31, and the list underneath self-scopes on the server exactly as
            `GET /enrollments` does. A tab whose list is a WHERE clause has no subject
            to gate on; what this tab shows is simply what the API serves.
          */}
          <TabsTrigger value="assignments">Assignments</TabsTrigger>
          {/*
            The student's own record of what they have been awarded, and the end of the
            chain this page otherwise stops one step short: seat, attend, submit,
            assessed, completed — and then nowhere to record the outcome.

            SHOWN TO STUDENTS BY A ROLE READ, and that is worth being explicit about,
            because the rule against role reads is about AUTHORIZATION and this is not
            one. `certificate:read` is subject-dependent (`isEnrolledStudent` for a
            student, `or(ownsCourse, isAuthor)` for a teacher), so there is no subject
            this tab could be gated on and a bare `can()` would deny every viewer — the
            panel underneath self-scopes on the server exactly as the Assignments tab
            does, and its own comment says why.

            The read is here to decide what the page is FOR, not who may use it: a
            certificate is a student's record, and a teacher's reader of somebody else's
            is a per-student screen that does not exist yet. That is Phase 5's
            `GET /users/:id` gap, and faking it here — showing a teacher a list of
            certificates with no student on any of them, because the DTO deliberately
            carries no holder — would be a tab that answers no question.
          */}
          {isStudent ? <TabsTrigger value="qualifications">Qualifications</TabsTrigger> : null}
          {policy.can('enrollment:read', viewerSubject) ? (
            <TabsTrigger value="students" count={pendingCount}>
              Students
            </TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="resources">
          {canAddResource ? (
            /*
             * The tab's own header action, and deliberately NOT a child of `TabsList`:
             * that list is a Radix `role="tablist"` with a roving tabindex, so a button
             * among the tabs is both invalid ARIA and unreachable by the arrow keys that
             * move between them. Sitting at the top of the panel instead, it is the
             * first stop after the tab strip in the normal tab order.
             *
             * Full width at the base viewport — it is the primary action of this panel
             * and a thumb should not have to aim — and shrinks to its label from `sm`,
             * where a pointer is doing the aiming.
             */
            <div className="flex flex-col pb-4 sm:flex-row sm:justify-end">
              <Button
                block
                className="sm:w-auto"
                leadingIcon={<Plus aria-hidden="true" className="size-4" />}
                onClick={() => setResourceForm('new')}
              >
                Add a resource
              </Button>
            </div>
          ) : null}

          {resources.isPending ? (
            <SkeletonList rows={3} />
          ) : (
            <DataTable
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
                 * fallback and a primary: `DataTable` renders exactly one of the card
                 * list or the table depending on viewport (DataTable.tsx's header
                 * comment), chosen by `useIsDesktop()`, never both at once. Wiring only
                 * `renderCard` would have shipped a download button that no desktop
                 * viewport can ever show — the tab has looked complete on a phone and
                 * had no way to fetch a file on a laptop for as long as the dead button
                 * existed.
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
              actions={(resource) => (
                <ResourceRowMenu
                  resource={resource}
                  course={data}
                  onEdit={() => setResourceForm(resource)}
                  onDelete={() => setDeletingResource(resource)}
                />
              )}
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
                    {/*
                      Third column of the card, beside the title block rather than under
                      it: `DataTable`'s `actions` prop has no card-view counterpart — the
                      card is the PRIMARY rendering below `md`, not a fallback, and
                      `renderCard` is caller-owned markup with no slot `actions` could
                      inject into (DataTable.tsx's header comment). Below `md` this menu
                      would simply not exist without its own call here. It renders `null`
                      for a viewer who may do neither thing, which is why it is unguarded
                      here.

                      `self-start` for the same reason `ResourceAccess` above carries it:
                      `Card` is a flex row and a flex item defaults to `stretch`, so a
                      44px tap target would otherwise grow to the full height of a card
                      with a two-line description and read as a tall grey bar.
                    */}
                    <ResourceRowMenu
                      resource={resource}
                      course={data}
                      className="self-start"
                      onEdit={() => setResourceForm(resource)}
                      onDelete={() => setDeletingResource(resource)}
                    />
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
                 * The "Add a resource" action is back, and this time it opens a real
                 * form. It was removed while it called `() => undefined`, because a
                 * button that does nothing is worse than no button — the same call as
                 * the suspend dialog's reinstatement promise. It opens the SAME dialog
                 * the panel header opens, so there is one create flow rather than two
                 * that can drift.
                 *
                 * Label and handler travel together in one spread: `EmptyState` paints
                 * the button on `onAction` alone (EmptyState.tsx:111), so setting only
                 * the label to a viewer who may not create would be silent dead copy,
                 * and setting only the handler would render the preset's "Get started".
                 */
                <EmptyState
                  variant="empty"
                  title="No resources yet"
                  description={
                    canAddResource
                      ? 'Nothing has been added to this course yet.'
                      : courseViewerStatus(data.offerings) === 'APPROVED'
                        ? 'The teacher has not published anything for this course yet.'
                        : 'Nothing public has been published here. Enrolled students may see more.'
                  }
                  {...(canAddResource
                    ? { actionLabel: 'Add a resource', onAction: () => setResourceForm('new') }
                    : {})}
                />
              }
            />
          )}
        </TabsContent>

        {/*
          The panel decides which of the two audiences it is rendering — the student's
          own tasks with their hand-ins and marks, or one intake's tasks with the class
          that handed in for each. The intake is `selectedOffering`, the same selection
          the Students tab's register and exports follow, because a task belongs to an
          intake and showing a second, different selection above two tabs would give
          the page two answers to "which intake are we looking at".
        */}
        <TabsContent value="assignments">
          <AssignmentsPanel course={data} offering={selectedOffering} />
        </TabsContent>

        {isStudent ? (
          <TabsContent value="qualifications">
            <QualificationsPanel />
          </TabsContent>
        ) : null}

        {policy.can('enrollment:read', viewerSubject) ? (
          <TabsContent value="students">
            {/*
              Phase 8's register exports, beside the intake they are scoped to. The
              component asks the policy itself (`enrollment:read` / `attendance:read`
              with the COURSE subject — the shapes the export endpoints are gated by
              server-side), so a viewer who may not read one of the registers is not
              shown its file. Both hrefs carry the selected intake's `offeringId` —
              the attendance export REQUIRES it, and an enrolment export mixing two
              intakes would not be a register.
            */}
            {selectedOffering === undefined ? (
              <p className="pb-4 text-sm text-fg-secondary">
                This course has no live intake, so there is no register to keep and nothing to
                export. Add one from the course header — the approvals below stay readable
                meanwhile.
              </p>
            ) : (
              <div className="flex flex-col gap-3 pb-4 md:flex-row md:items-end md:justify-end">
                {data.offerings.length > 1 ? (
                  <FormField label="Intake" className="md:w-72">
                    <Select
                      value={selectedOffering.id}
                      onValueChange={(next) => setRegisterOfferingId(next)}
                    >
                      <SelectTrigger aria-label="Intake" />
                      <SelectContent>
                        {data.offerings.map((offering) => (
                          <SelectItem key={offering.id} value={offering.id}>
                            {formatOfferingDates(offering)}
                            {offering.isFull ? ' · full' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                ) : null}
                <RegisterExportButtons
                  courseId={courseId}
                  teacherId={data.teacher.id}
                  offeringId={selectedOffering.id}
                />
              </div>
            )}

            {/*
              The register, and deliberately ABOVE the roster list: it is this tab's
              working surface, while the list below is approvals bookkeeping. It reads
              ONE intake — two intakes of a course never share a teaching day — so it
              follows the selection above.

              Gated on `attendance:mark` asked with the COURSE subject — the shape the
              server loads for both register endpoints (`loadCourseSubject`,
              attendance.service.ts:63-71), where `ownsCourse` reads
              `courseTeacherId`. A student is denied by their own policy cell before
              the subject even matters, so this branch never renders for them; a
              teacher who does not own the course fails `ownsCourse` exactly as they
              would server-side.
            */}
            {selectedOffering !== undefined && policy.can('attendance:mark', viewerSubject) ? (
              <div className="pb-(--space-block)">
                <AttendanceRegister courseId={courseId} offeringId={selectedOffering.id} />
              </div>
            ) : null}

            <DataTable
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
                      {/*
                        The name opens `GET /enrollments/:id` — the seat's own page,
                        with the decision record and the attendance summary. The
                        avatar beside it stays plain: `user:read` is `isSelf` for a
                        teacher, so a link to `/users/$id` here would be an
                        affordance that renders on this very roster and then answers
                        403 to the teacher looking at it. `EnrollmentDto.student` is
                        a `UserSummary` and carries no email, which is the right
                        amount to know about somebody from a roster.
                      */}
                      <Link
                        to="/enrollments/$id"
                        params={{ id: entry.id }}
                        className="tap -my-2 flex items-center rounded-[var(--control-radius)] px-1 font-medium text-fg hover:underline focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line-focus"
                      >
                        <span className="truncate">{entry.student.name}</span>
                      </Link>
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
                  id: 'intake',
                  header: 'Intake',
                  cell: (entry) => formatOfferingDates(entry.offering),
                  secondary: true,
                },
                {
                  id: 'status',
                  header: 'Status',
                  /*
                   * The chip alone said "Completed" and nothing else, and a
                   * qualification is a claim about WHEN and BY WHOM. `CompletionStamp`
                   * carries the two fields the Phase 1 backend added to the DTO, and
                   * renders nothing for a row that is not COMPLETED — including a
                   * COMPLETED row whose `completedAt` is somehow null, which is a data
                   * problem and not one to paper over with a date.
                   */
                  cell: (entry) => (
                    <div className="flex flex-col items-start gap-0.5">
                      <StatusChip status={entry.status} />
                      <CompletionStamp enrollment={entry} />
                    </div>
                  ),
                },
              ]}
              actions={(entry) =>
                entry.status === 'PENDING' ? (
                  <DecisionButtons
                    onApprove={() => decide.mutate({ id: entry.id, action: 'approve' })}
                    onReject={() => setRejecting(entry)}
                    disabled={decide.isPending || !policy.can('enrollment:approve', viewerSubject)}
                  />
                ) : (
                  <div className="flex items-center justify-end gap-2">
                    <EnrollmentCertificateActions
                      entry={entry}
                      course={data}
                      onIssue={setIssuingFor}
                    />
                    <EnrollmentCompletionActions
                      entry={entry}
                      course={data}
                      pending={decide.isPending}
                      onComplete={(id) => decide.mutate({ id, action: 'complete' })}
                      onUncomplete={(id) => decide.mutate({ id, action: 'uncomplete' })}
                    />
                  </div>
                )
              }
              renderCard={(entry) => (
                <Card className="flex flex-col gap-3">
                  <div className="flex items-start gap-3">
                    <Avatar name={entry.student.name} src={entry.student.avatarUrl} size="md" />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <Link
                        to="/enrollments/$id"
                        params={{ id: entry.id }}
                        className="tap -my-2 flex items-center rounded-[var(--control-radius)] px-1 text-sm font-medium hover:underline focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line-focus"
                      >
                        <span className="truncate">{entry.student.name}</span>
                      </Link>
                      <span className="truncate text-2xs text-fg-tertiary">
                        Intake {formatOfferingDates(entry.offering)} · requested{' '}
                        {formatRelative(entry.requestedAt)}
                      </span>
                    </div>
                    {/*
                      The chip and its stamp stack rather than sit on one line: at
                      375px the card's third column is the chip, and a date beside it
                      would be the first thing to wrap.
                    */}
                    <div className="flex shrink-0 flex-col items-end gap-0.5">
                      <StatusChip status={entry.status} />
                      <CompletionStamp enrollment={entry} />
                    </div>
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
                  ) : entry.status === 'PENDING' ? null : (
                    <div className="flex flex-col gap-2">
                      <EnrollmentCompletionActions
                        block
                        entry={entry}
                        course={data}
                        pending={decide.isPending}
                        onComplete={(id) => decide.mutate({ id, action: 'complete' })}
                        onUncomplete={(id) => decide.mutate({ id, action: 'uncomplete' })}
                      />
                      {/*
                        The card's PRIMARY rendering, not a fallback — see the component's
                        own header. `EnrollmentCompletionActions` is `block` here and the
                        certificate control sits under it rather than beside it, because
                        at 375px a card's action area is one column and two side-by-side
                        controls would put two 44px targets where a thumb expects one.
                      */}
                      <EnrollmentCertificateActions
                        block
                        entry={entry}
                        course={data}
                        onIssue={setIssuingFor}
                      />
                    </div>
                  )}
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

      {/*
        The viewer's OWN seat, and the withdrawal that goes with it. Above the
        attendance section because a seat someone might not want any more comes
        before the register that seat carries — and above the tabs for the same
        reason it is here at all: `enrollment:read` gates the Students tab on the
        COURSE subject, whose shape deliberately omits `studentId` so a student is
        not shown a roster containing their own request. Putting the viewer's own
        row inside that tab would mean widening a gate to make a UI appear, which
        is LESSONS-LEARNED #15's exact mistake.
      */}
      <ViewerSeatActions course={data} />

      {/*
        The viewer's OWN attendance, for a student with an APPROVED seat — the second
        half of Phase 5's frontend line. It sits below the tabs because the Students
        tab itself is teacher-only (`enrollment:read` is asked client-side with the
        course subject, whose shape denies `isEnrolledStudent` on purpose), so there
        is no tab to fold it into without widening that gate and opening the whole
        roster to students.
      */}
      <ViewerAttendanceSection course={data} />

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

      {/*
        The last dialog on this page, and the only one whose target is chosen by a row
        action rather than by a form. It owns its own mutation, its own catalogue fetch
        and its own invalidation, so this component decides only WHICH SEAT it is pointed
        at — the same division `ResourceFormDialog` has below.
      */}
      <IssueCertificateDialog
        // `issue-` prefixed, and that is not a style choice. `RejectDialog` above is a
        // SIBLING keyed on the same `'none'` sentinel while both dialogs are closed, and
        // React warned about two children sharing a key the first time this was run —
        // a dialog that remounts itself unpredictably is a dialog that opens holding the
        // previous request's state.
        key={`issue-${issuingFor?.id ?? 'none'}`}
        open={issuingFor !== null}
        onOpenChange={(open) => !open && setIssuingFor(null)}
        enrollmentId={issuingFor?.id ?? ''}
        studentName={issuingFor?.student.name ?? ''}
        courseName={issuingFor?.course.name ?? data.name}
      />

      {/*
        ONE dialog for create and for edit, remounted per target by `key`.

        The key is load-bearing: the form is seeded from the `resource` prop, and a form
        seeded once at mount would open on the SECOND row still showing the first one's
        title. `RejectDialog` above carries one for the same reason. The cost is the
        close animation — the key returns to 'new' as the state clears, so the dialog
        unmounts instead of sliding out — which is the trade this file already made.

        The dialog owns its own mutations and its own invalidation, so nothing about the
        create or the edit is duplicated here; this component only decides WHICH row it
        is pointed at. Closing is its call too: it refuses to close mid-upload, which is
        why `onOpenChange` and not a `Cancel` handler is what clears the target.
      */}
      <ResourceFormDialog
        key={editingResource?.id ?? 'new'}
        open={resourceForm !== null}
        onOpenChange={(open) => !open && setResourceForm(null)}
        courseId={courseId}
        resource={editingResource}
      />

      <DeleteResourceDialog
        resource={deletingResource}
        pending={removeResource.isPending}
        /*
         * Asked again at the point of action, with the ROW's subject — the menu that
         * opened this is gated the same way, and a decision worth making once is worth
         * making where the request is actually sent. The `=== null` branch is not a
         * formality: `can()` with no subject DENIES silently (LESSONS-LEARNED #15), so
         * the closed state must be answered by this file rather than by the policy.
         */
        disabled={
          deletingResource === null ||
          !policy.can('resource:delete', resourceSubject(deletingResource, data))
        }
        onClose={() => setDeletingResource(null)}
        onConfirm={() => deletingResource && removeResource.mutate(deletingResource.id)}
      />
    </div>
  );
}

/**
 * The signed-in viewer's own attendance on THIS course — one summary PER INTAKE they
 * hold an APPROVED seat on, since a student may sit in several intakes and each
 * keeps its own register.
 *
 * The gate is deliberately NOT a role read: the per-intake `viewerEnrollmentStatus`
 * is served only for STUDENT viewers — the server sends it as null for everyone else
 * (courses.service.ts) — so "APPROVED anywhere" here already means "an approved
 * student". A visitor without an APPROVED enrolment renders nothing at all.
 *
 * Finding their OWN enrolment rows is a lookup, not an assumption: `GET /enrollments`
 * has no per-subject policy gate because it self-scopes (`visibilityWhere` narrows a
 * student's rows to `studentId = actor.id`, enrollments.routes.ts:38-40), and the
 * same scoping is what makes it safe to call with just the course filter. Each row
 * is what `EnrollmentAttendance` builds its enrollment-shaped subject from. Read at
 * the schema's page ceiling, not at 1 — several intakes legitimately hold APPROVED
 * rows for one student, and truncating would silently drop their other registers.
 */
function ViewerAttendanceSection({ course }: { course: CourseDetail }) {
  const approvedAnywhere = courseViewerStatus(course.offerings) === 'APPROVED';

  const mine = useQuery({
    queryKey: qk.enrollments({ courseId: course.id, status: 'APPROVED', limit: MAX_PAGE_SIZE }),
    queryFn: () =>
      api.get<Paginated<EnrollmentDto>>('/enrollments', {
        query: { courseId: course.id, status: 'APPROVED', limit: MAX_PAGE_SIZE },
      }),
    enabled: approvedAnywhere,
  });

  if (!approvedAnywhere) return null;

  const rows = mine.data?.data.filter((entry) => entry.status === 'APPROVED') ?? [];
  // Loaded-or-nothing: a skeleton under "Your attendance" for a query that has not
  // answered yet reads better than a section that pops in late.
  if (rows.length === 0 && !mine.isSuccess) {
    return (
      <div className="pt-(--space-section)">
        <SkeletonCard />
      </div>
    );
  }
  if (rows.length === 0) return null;

  return (
    <div className="pt-(--space-section) flex flex-col gap-3">
      {/*
        One seat: exactly the old card, old heading. Several: each names its intake,
        because "Your attendance" twice says nothing about which register is which.
      */}
      {rows.map((row) => (
        <EnrollmentAttendance
          key={row.id}
          enrollment={row}
          title={
            rows.length === 1
              ? 'Your attendance'
              : `Your attendance · ${formatOfferingDates(row.offering)}`
          }
        />
      ))}
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

/**
 * Edit and Delete for ONE resource row, rendered identically by the card list and by the
 * table for the same reason `ResourceAccess` is a component: `DataTable` renders exactly
 * one of the two per viewport and its `actions` prop has no card-view counterpart, so the
 * menu has to be called once from `actions` for the table and once from `renderCard` for
 * the card, or it would be missing below `md`.
 *
 * THE SUBJECT IS THE ROW, NOT THE COURSE. `resource:update` and `resource:delete` are
 * `ownsCourse` for a TEACHER (policy.ts:229-240), which reads `courseTeacherId` — a field
 * that lives on the course and not on `ResourceDto` — so neither a bare row nor the
 * course subject answers the question being asked here. `resourceSubject` is the
 * projection that carries both halves, and it is the one the download gate already uses.
 * LESSONS-LEARNED #15 and #31 are both about getting this wrong, and both failures are
 * silent denials.
 *
 * `usePolicy` is called here rather than in the page because `renderCard` and a column's
 * `cell` are plain callbacks, not components — a hook cannot be called from either.
 */
function ResourceRowMenu({
  resource,
  course,
  onEdit,
  onDelete,
  className,
}: {
  resource: ResourceDto;
  course: CourseDetail;
  onEdit: () => void;
  onDelete: () => void;
  className?: string;
}) {
  const policy = usePolicy();
  const target = resourceSubject(resource, course);

  const canEdit = policy.can('resource:update', target);
  const canDelete = policy.can('resource:delete', target);

  // Nothing permitted means no menu at all — an empty menu is worse than none, and this
  // is the common case: every student looking at every row.
  if (!canEdit && !canDelete) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/*
         * The label names the ROW. "Actions" alone is what a screen reader hears from
         * every one of these buttons in a list of twelve, with nothing to tell them
         * apart; `IconButton` makes `aria-label` required at the type level for exactly
         * this reason, and the visible title is the only thing that distinguishes them.
         */}
        <IconButton
          aria-label={`Actions for ${resource.title}`}
          icon={<MoreVertical className="size-5" />}
          size="sm"
          className={className}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canEdit ? (
          /*
           * "Edit details", not "Edit": `updateResourceSchema` has no `uploadId`
           * (resource.ts:78-89), so the file behind a row cannot be swapped and the
           * label should not suggest it can. The dialog says the same thing again by
           * showing the current filename as read-only text.
           */
          <DropdownMenuItem
            icon={<Pencil aria-hidden="true" className="size-4" />}
            onSelect={onEdit}
          >
            Edit details
          </DropdownMenuItem>
        ) : null}
        {canEdit && canDelete ? <DropdownMenuSeparator /> : null}
        {canDelete ? (
          <DropdownMenuItem
            destructive
            icon={<Trash2 aria-hidden="true" className="size-4" />}
            onSelect={onDelete}
          >
            Delete resource
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
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

/**
 * The delete confirmation — and specifically NOT a promise that this can be undone.
 *
 * What actually happens, read rather than assumed: `resources.service.ts:609-620` stamps
 * `deletedAt` and nothing else. The row survives, and so do the comments on it — a hard
 * delete would cascade the discussion away, and "remove this file from the course" does
 * not mean "erase what was said about it". Every read in that service filters the column,
 * so the resource disappears from this screen for everyone, an administrator included.
 *
 * What an administrator CAN see is the deletion itself: `Resource` is in AUDITED_MODELS,
 * and the Prisma extension classifies a write that sets `deletedAt` as action `DELETE`
 * with the actor against it (`AUDITED_MODELS` and `deriveUpdateAction`,
 * packages/db/src/audit.ts), which is what the
 * admin overview lists (AdminOverview.tsx:119-155).
 *
 * The audit extension also knows a `RESTORE` (`deriveUpdateAction` in audit.ts returns it
 * when `deletedAt` clears) — but no endpoint exposes
 * one, so putting the row back is a database change and the copy says so instead of
 * implying a button somewhere. Same call as the suspend dialog's, which used to promise
 * a reinstatement nothing could perform (AdminUsers.tsx:292-300).
 */
function DeleteResourceDialog({
  resource,
  pending,
  disabled,
  onClose,
  onConfirm,
}: {
  resource: ResourceDto | null;
  pending: boolean;
  disabled: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={resource !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title="Delete this resource?"
        description={
          resource
            ? `${resource.title} disappears from this course for every student and teacher.`
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
              disabled={disabled}
              onClick={onConfirm}
            >
              Delete resource
            </Button>
          </>
        }
      >
        <p className="text-fg-secondary">
          Nothing is erased: the record is marked deleted and the comments on it are kept. An
          administrator sees the deletion in the audit log with your name against it — but no screen
          in this app puts it back, so restoring it takes a database change.
        </p>
      </DialogContent>
    </Dialog>
  );
}
