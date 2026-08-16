import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, FileText, Link2, Video } from 'lucide-react';
import { api } from '@/lib/api';
import { qk } from '@/lib/query';
import { subject, usePolicy } from '@/lib/policy';
import { formatBytes, formatDate, formatDuration, formatRelative } from '@/lib/format';
import type { CourseSummary, EnrollmentSummary, ResourceSummary } from '@/lib/types';
import { PageHeader } from '@/components/layout/PageHeader';
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

const RESOURCE_ICON = {
  DOCUMENT: FileText,
  VIDEO: Video,
  LINK: Link2,
} as const;

export function CourseDetailPage() {
  const { courseId } = Route.useParams();
  const policy = usePolicy();
  const client = useQueryClient();
  const [rejecting, setRejecting] = useState<EnrollmentSummary | null>(null);

  const course = useQuery({
    queryKey: qk.course(courseId),
    queryFn: () => api.get<CourseSummary>(`/courses/${courseId}`),
  });

  /**
   * The policy subject is built from what THIS screen has loaded — teacher,
   * publication state, the viewer's own enrolment. Nothing is fetched by the
   * policy layer itself; `can()` is a pure function over this bag.
   */
  const courseSubject = course.data
    ? subject({
        id: course.data.id,
        teacherId: course.data.teacherId,
        departmentId: course.data.departmentId,
        publishedAt: course.data.publishedAt,
        capacity: course.data.capacity,
        approvedCount: course.data.approvedCount,
        viewerEnrollmentStatus: course.data.viewerEnrollmentStatus,
      })
    : undefined;

  const resources = useQuery({
    queryKey: qk.courseResources(courseId),
    queryFn: () => api.get<{ data: ResourceSummary[] }>(`/courses/${courseId}/resources`),
    enabled: policy.can('resource:read', courseSubject),
  });

  const enrollments = useQuery({
    queryKey: qk.courseEnrollments(courseId),
    queryFn: () => api.get<{ data: EnrollmentSummary[] }>(`/courses/${courseId}/enrollments`),
    enabled: policy.can('enrollment:read', courseSubject),
  });

  const requestEnrollment = useMutation({
    mutationFn: () => api.post<void>(`/courses/${courseId}/enrollments`),
    onSuccess: async () => {
      toast.success('Request sent', {
        description: 'The teacher will review it. You will be notified either way.',
      });
      await client.invalidateQueries({ queryKey: qk.course(courseId) });
    },
    onError: (error) => toast.fromError(error, 'Could not send that request'),
  });

  const decide = useMutation({
    mutationFn: (input: { id: string; action: 'approve' | 'reject'; note?: string }) =>
      api.post<void>(`/enrollments/${input.id}/${input.action}`, {
        ...(input.note ? { decisionNote: input.note } : {}),
      }),
    onSuccess: async () => {
      setRejecting(null);
      await Promise.all([
        client.invalidateQueries({ queryKey: qk.courseEnrollments(courseId) }),
        client.invalidateQueries({ queryKey: qk.course(courseId) }),
      ]);
    },
    onError: (error) => toast.fromError(error, 'Could not record that decision'),
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
  const isFull = data.approvedCount >= data.capacity;
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
            ) : policy.can('enrollment:request', courseSubject) ? (
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

            {policy.can('course:update', courseSubject) ? (
              <Button variant="secondary" block className="sm:w-auto">
                Edit course
              </Button>
            ) : null}
          </>
        }
      />

      <dl className="grid grid-cols-2 gap-3 pb-6 lg:grid-cols-4">
        <Fact label="Code" value={data.code} />
        <Fact label="Department" value={data.departmentName} />
        <Fact label="Teacher" value={data.teacherName} />
        <Fact label="Duration" value={formatDuration(data.durationValue, data.durationUnit)} />
        <Fact label="Starts" value={formatDate(data.startDate)} />
        <Fact label="Ends" value={formatDate(data.endDate)} />
        <Fact label="Places" value={`${data.approvedCount} / ${data.capacity}`} />
        <Fact label="Visibility" value={data.publishedAt ? 'Published' : 'Draft'} />
      </dl>

      <Tabs defaultValue="resources">
        <TabsList>
          <TabsTrigger value="resources">Resources</TabsTrigger>
          {policy.can('enrollment:read', courseSubject) ? (
            <TabsTrigger value="students" count={pendingCount}>
              Students
            </TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="resources">
          {!policy.can('resource:read', courseSubject) ? (
            <EmptyState
              variant="empty"
              title="Resources are for enrolled students"
              description="Request enrolment above. Once a teacher approves it, everything here opens up."
            />
          ) : resources.isPending ? (
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
                  cell: (resource) => resource.authorName,
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
                        {resource.authorName} · {formatRelative(resource.createdAt)}
                        {resource.sizeBytes ? ` · ${formatBytes(resource.sizeBytes)}` : ''}
                      </p>
                      {policy.can('resource:download', subject({ ...resource })) ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          className="mt-1 self-start"
                          leadingIcon={<Download aria-hidden="true" className="size-4" />}
                        >
                          Download
                        </Button>
                      ) : null}
                    </div>
                  </Card>
                );
              }}
              empty={
                <EmptyState
                  variant="empty"
                  title="No resources yet"
                  description={
                    policy.can('resource:create', courseSubject)
                      ? 'Upload a document, link a video, or add an external link.'
                      : 'The teacher has not published anything for this course yet.'
                  }
                  {...(policy.can('resource:create', courseSubject)
                    ? { actionLabel: 'Add a resource', onAction: () => undefined }
                    : {})}
                />
              }
            />
          )}
        </TabsContent>

        {policy.can('enrollment:read', courseSubject) ? (
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
                  cell: (entry) => (
                    <div className="flex flex-col">
                      <span className="font-medium text-fg">{entry.studentName}</span>
                      <span className="text-xs text-fg-tertiary">{entry.studentEmail}</span>
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
                          decide.isPending || !policy.can('enrollment:approve', courseSubject)
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
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium">{entry.studentName}</span>
                      <span className="truncate text-xs text-fg-tertiary">
                        {entry.studentEmail}
                      </span>
                    </div>
                    <StatusChip status={entry.status} />
                  </div>
                  <p className="text-2xs text-fg-tertiary">
                    Requested {formatRelative(entry.requestedAt)}
                  </p>
                  {entry.status === 'PENDING' && policy.can('enrollment:approve', courseSubject) ? (
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
        enrollment={rejecting}
        pending={decide.isPending}
        onClose={() => setRejecting(null)}
        onConfirm={(note) =>
          rejecting && decide.mutate({ id: rejecting.id, action: 'reject', note })
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
  enrollment: EnrollmentSummary | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState('');

  return (
    <Dialog open={enrollment !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title="Reject this request?"
        description={
          enrollment
            ? `${enrollment.studentName} will be told, and will see whatever you write below.`
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
              onClick={() => onConfirm(note)}
            >
              Reject request
            </Button>
          </>
        }
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Reason (optional)</span>
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            autoResize
            placeholder="This intake is full — apply again for the spring cohort."
          />
        </label>
      </DialogContent>
    </Dialog>
  );
}
