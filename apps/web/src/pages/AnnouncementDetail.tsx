import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { qk } from '@/lib/query';
import { subject, usePolicy, type PolicySubject } from '@/lib/policy';
import { formatDate, formatDateTime } from '@/lib/format';
import type { AnnouncementDetail, AnnouncementTypeValue } from '@/lib/types';
import { AnnouncementFormDialog } from '@/components/announcements/AnnouncementFormDialog';
import { CommentThread } from '@/components/comments/CommentThread';
import { PageHeader } from '@/components/layout/PageHeader';
import { Avatar } from '@/components/ui/Avatar';
import { Badge, type BadgeProps } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonCard, SkeletonList } from '@/components/ui/Skeleton';
import { StatusChip } from '@/components/ui/StatusChip';
import { toast } from '@/components/ui/Toast';
import { Route } from '@/routes/_app/announcements.$announcementId';

/** Same label/tone maps as `Announcements.tsx` — each screen owns its own, on the
 * same footing as `ResourceFormDialog.tsx`'s `TYPE_LABEL` beside `CourseDetail.tsx`'s
 * `RESOURCE_ICON`: two small presentation maps for two different screens, not one
 * shared module a third caller would have to guess the intent of. */
const TYPE_LABEL: Record<AnnouncementTypeValue, string> = {
  NEWS: 'News',
  EVENT: 'Event',
  ANNOUNCEMENT: 'Announcement',
};

const TYPE_TONE: Record<AnnouncementTypeValue, NonNullable<BadgeProps['tone']>> = {
  NEWS: 'info',
  EVENT: 'brand',
  ANNOUNCEMENT: 'neutral',
};

/**
 * The policy Subject for every announcement-scoped decision on this screen, built to
 * match the SERVER's loader field for field — `loadAnnouncementSubject`
 * (announcements.service.ts). `update`, `delete` and `publish` are all TEACHER:
 * `isAuthor` / ADMIN: `allow` (policy.ts), which reads `authorId`; `read`'s TEACHER
 * branch additionally reads `publishedAt`, carried here for the same reason even
 * though this screen never asks that question itself — a successful fetch already
 * proved the read, on the same reasoning `CourseDetail.tsx` gives for not re-asking
 * `course:read` client-side.
 */
function announcementSubject(announcement: AnnouncementDetail): PolicySubject {
  return subject({
    id: announcement.id,
    authorId: announcement.author.id,
    publishedAt: announcement.publishedAt,
  });
}

export function AnnouncementDetailPage() {
  const { announcementId } = Route.useParams();
  const navigate = useNavigate({ from: Route.fullPath });
  const policy = usePolicy();
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // `GET /announcements/:id` serves `announcementDetailSchema`
  // (announcements.routes.ts:56-65) — the summary plus the full body, the comment
  // count and `updatedAt`.
  const announcement = useQuery({
    queryKey: qk.announcement(announcementId),
    queryFn: () => api.get<AnnouncementDetail>(`/announcements/${announcementId}`),
  });

  const publish = useMutation({
    // The route answers 200 with the updated `announcementDetailSchema` row
    // (announcements.routes.ts:98-111); the declared type is the served one so it
    // cannot quietly become a lie.
    mutationFn: () =>
      api.post<AnnouncementDetail>(`/announcements/${announcementId}/publish`, {
        published: true,
      }),
    onSuccess: async (saved) => {
      toast.success('Announcement published', {
        description: 'It is now visible to everyone entitled to see it.',
      });
      client.setQueryData(qk.announcement(announcementId), saved);
      await client.invalidateQueries({ queryKey: ['announcements'] });
    },
    onError: (error) => toast.fromError(error, 'Could not publish that announcement'),
  });

  /*
   * SOFT delete — the service only stamps `deletedAt` (announcements.routes.ts:113-
   * 132), same as `resources.service.ts`'s `remove`. `api.del` returns `undefined`
   * for the 204, so nothing here reads a result.
   *
   * Deleting the row this whole page is ABOUT means there is nothing left to stay
   * on, unlike `CourseDetail.tsx`'s resource delete — a resource is one row in a
   * list nested under a course that keeps existing. This screen navigates back to
   * the list instead.
   */
  const remove = useMutation({
    mutationFn: () => api.del<void>(`/announcements/${announcementId}`),
    onSuccess: async () => {
      toast.success('Announcement removed', {
        description: 'It is gone from the list. The discussion on it is kept.',
      });
      await client.invalidateQueries({ queryKey: ['announcements'] });
      void navigate({ to: '/announcements', search: { page: 1 } });
    },
    onError: (error) => toast.fromError(error, 'Could not remove that announcement'),
  });

  if (announcement.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <SkeletonCard />
        <SkeletonList rows={2} />
      </div>
    );
  }

  if (!announcement.data) {
    return (
      <EmptyState
        variant="error"
        title="Announcement unavailable"
        description="This announcement could not be loaded. It may have been removed."
      />
    );
  }

  const data = announcement.data;
  const target = announcementSubject(data);
  const canPublish = !data.publishedAt && policy.can('announcement:publish', target);
  const canUpdate = policy.can('announcement:update', target);
  const canDelete = policy.can('announcement:delete', target);

  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow={
          <Link
            to="/announcements"
            search={{ page: 1 }}
            // `tap md:min-h-0` — see the same back-link on CourseDetail.
            className="tap inline-flex items-center gap-1.5 text-fg-secondary hover:text-fg md:min-h-0"
          >
            <ArrowLeft aria-hidden="true" className="size-3.5" />
            All announcements
          </Link>
        }
        title={data.title}
        actions={
          <>
            {canPublish ? (
              <Button
                block
                className="sm:w-auto"
                loading={publish.isPending}
                onClick={() => publish.mutate()}
              >
                Publish
              </Button>
            ) : null}
            {canUpdate ? (
              <Button
                variant="secondary"
                block
                className="sm:w-auto"
                onClick={() => setEditing(true)}
              >
                Edit
              </Button>
            ) : null}
            {canDelete ? (
              <Button
                variant="danger"
                block
                className="sm:w-auto"
                onClick={() => setDeleting(true)}
              >
                Delete
              </Button>
            ) : null}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3 pb-(--space-block) text-sm text-fg-secondary">
        <Badge tone={TYPE_TONE[data.type]} size="sm">
          {TYPE_LABEL[data.type]}
        </Badge>
        {data.publishedAt ? (
          <span>Published {formatDate(data.publishedAt)}</span>
        ) : (
          <StatusChip status="DRAFT" />
        )}
        {data.type === 'EVENT' && data.eventDate ? (
          <span>Event on {formatDateTime(data.eventDate)}</span>
        ) : null}
        <span className="flex items-center gap-1.5">
          <Avatar name={data.author.name} src={data.author.avatarUrl} size="xs" />
          {data.author.name}
        </span>
      </div>

      {/*
        Plain text, deliberately: `announcementDetailSchema.content` is
        `z.string()` with no markup flag (schema/announcement.ts), and nothing in
        this codebase sanitises HTML for rendering. `whitespace-pre-wrap` is what
        preserves the author's paragraph breaks without a markdown renderer or a
        `dangerouslySetInnerHTML` this app has no sanitiser to back.
      */}
      <p className="measure pb-(--space-section) text-sm whitespace-pre-wrap text-fg">
        {data.content}
      </p>

      <div className="flex flex-col gap-3 border-t border-line-subtle pt-(--space-block)">
        <h2 className="font-display text-lg font-semibold">Discussion</h2>
        <CommentThread announcementId={announcementId} />
      </div>

      <AnnouncementFormDialog open={editing} onOpenChange={setEditing} announcement={data} />

      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent
          title="Delete this announcement?"
          description={`${data.title} disappears from the list for everyone who could see it.`}
          footer={
            <>
              <Button
                variant="ghost"
                block
                className="sm:w-auto"
                onClick={() => setDeleting(false)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                block
                className="sm:w-auto"
                loading={remove.isPending}
                disabled={!canDelete}
                onClick={() => remove.mutate()}
              >
                Delete announcement
              </Button>
            </>
          }
        >
          <p className="text-fg-secondary">
            Nothing is erased: the record is marked deleted and the comments on it are kept. An
            administrator sees the deletion in the audit log with your name against it — but no
            screen in this app puts it back, so restoring it takes a database change.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
