import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  ArrowLeft,
  Download,
  ExternalLink,
  FileText,
  Link2,
  Video,
  type LucideIcon,
} from 'lucide-react';
import { api } from '@/lib/api';
import { qk } from '@/lib/query';
import { useSession } from '@/lib/session';
import { formatBytes, formatDate } from '@/lib/format';
import type { DownloadUrlResponse, ResourceDto, ResourceTypeValue } from '@/lib/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { StatusChip } from '@/components/ui/StatusChip';
import { toast } from '@/components/ui/Toast';
import { CommentThread } from '@/components/comments/CommentThread';
import { Route } from '@/routes/_app/resources.$resourceId';

/** Same map CourseDetail.tsx keeps (RESOURCE_ICON, courses.$courseId screen) — not
 * exported there, so it is kept here rather than reached into a file this page does
 * not own. Keyed by `ResourceTypeValue` so a fourth resource type breaks this line
 * at compile time instead of rendering `undefined` as a component. */
const RESOURCE_ICON: Record<ResourceTypeValue, LucideIcon> = {
  DOCUMENT: FileText,
  VIDEO: Video,
  LINK: Link2,
};

export function ResourceDetailPage() {
  const { resourceId } = Route.useParams();
  const session = useSession();

  // `GET /resources/:id` is gated by `resource:read` at the route
  // (resources.routes.ts), which for STUDENT/TEACHER is `resourceVisibleToStudent` /
  // `resourceVisibleToTeacher` and for `anonymous` is `publicAndLive` — so a row
  // reaching this screen at all is either public-and-published or one this viewer
  // is specifically entitled to (enrolled, owns the course, or wrote it).
  const resource = useQuery({
    // Same key the route's own loader warms (routes/_app/resources.$resourceId.tsx),
    // so this mounts with data already in cache instead of a skeleton that swaps.
    queryKey: qk.resource(resourceId),
    queryFn: () => api.get<ResourceDto>(`/resources/${resourceId}`),
  });

  /*
   * `GET /resources/:id/download` answers `{ url, expiresAt, filename }`
   * (upload.ts:108-113), a URL signed against a private bucket, never a path.
   * `window.location.assign`, not an `<a download>`: the signed GET carries
   * `ResponseContentDisposition: attachment` (storage.ts:178-196), so the browser
   * saves the file and this page stays put — the same call CourseDetail.tsx's
   * `download` mutation makes and for the same reason.
   */
  const download = useMutation({
    mutationFn: () => api.get<DownloadUrlResponse>(`/resources/${resourceId}/download`),
    onSuccess: (result) => window.location.assign(result.url),
    onError: (error) => toast.fromError(error, 'Could not start that download'),
  });

  if (resource.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <SkeletonCard />
      </div>
    );
  }

  if (!resource.data) {
    return (
      <EmptyState
        variant="error"
        title="Resource unavailable"
        description="This resource could not be loaded. It may have been removed."
      />
    );
  }

  const data = resource.data;
  const Icon = RESOURCE_ICON[data.type];

  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow={
          <Link
            to="/courses/$courseId"
            params={{ courseId: data.courseId }}
            // `tap md:min-h-0` — see the same back-link on CourseDetail.
            className="tap inline-flex items-center gap-1.5 text-fg-secondary hover:text-fg md:min-h-0"
          >
            <ArrowLeft aria-hidden="true" className="size-3.5" />
            {data.courseName}
          </Link>
        }
        title={data.title}
        description={data.description ?? undefined}
        actions={<StatusChip status={data.isPublic ? 'PUBLIC' : 'PRIVATE'} />}
      />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pb-(--space-block) text-sm text-fg-secondary">
        <span className="inline-flex items-center gap-1.5">
          <Icon aria-hidden="true" className="size-4 text-fg-tertiary" />
          {data.type}
        </span>
        <span aria-hidden="true" className="text-fg-tertiary">
          ·
        </span>
        <span className="inline-flex items-center gap-2">
          <Avatar name={data.author.name} src={data.author.avatarUrl} size="xs" />
          Added by {data.author.name}
        </span>
        <span aria-hidden="true" className="text-fg-tertiary">
          ·
        </span>
        <span>{formatDate(data.createdAt)}</span>
        {data.sizeBytes !== null ? (
          <>
            <span aria-hidden="true" className="text-fg-tertiary">
              ·
            </span>
            <span>{formatBytes(data.sizeBytes)}</span>
          </>
        ) : null}
      </div>

      <div className="flex pb-(--space-section)">
        <ResourceAccess
          resource={data}
          authenticated={session.isAuthenticated}
          pending={download.isPending}
          onDownload={() => download.mutate()}
        />
      </div>

      <section aria-labelledby="comments-heading">
        <h2 id="comments-heading" className="pb-3 font-display text-lg font-semibold text-fg">
          Comments
        </h2>
        <CommentThread resourceId={resourceId} />
      </section>
    </div>
  );
}

/**
 * The one thing a viewer can do with this resource: download the file, or open the
 * link. The branch is on `uploadId`, NOT on `type === 'LINK'`, mirroring
 * `ResourceAccess` in CourseDetail.tsx and the server's own reasoning
 * (resources.service.ts): `type` is a label the creator picks, while the CHECK
 * from migration 0002 is what actually guarantees one source per row.
 *
 * Gated on `authenticated` rather than a rebuilt `resource:download` Subject: that
 * gate is `resourceVisibleToStudent` / `resourceVisibleToTeacher` for the two
 * signed-in roles — the EXACT same combinators `resource:read` uses (policy.ts:
 * 215-220 vs :246-251) — so a signed-in viewer who reached this page (read already
 * passed) is guaranteed to pass download too, with no course-teacher or
 * enrolment field this page would otherwise have to fetch just to ask the
 * question. The two rules diverge only for `anonymous`: `deny` here against
 * `isPublic` for read, which is the anti-scraping line `resources.routes.ts`
 * documents at `GET /resources/:id/download` — a public row may be SEEN by a
 * logged-out visitor, and its bytes may not.
 */
function ResourceAccess({
  resource,
  authenticated,
  pending,
  onDownload,
}: {
  resource: ResourceDto;
  authenticated: boolean;
  pending: boolean;
  onDownload: () => void;
}) {
  if (!authenticated) {
    return (
      <p className="text-sm text-fg-tertiary">
        Sign in to {resource.uploadId === null ? 'open this link' : 'download this file'}.
      </p>
    );
  }

  if (resource.uploadId === null) {
    // No upload and no URL cannot happen — the CHECK forbids it — but the DTO types
    // both as nullable, so the impossible row renders nothing rather than a dead link.
    if (resource.externalUrl === null) return null;
    return (
      <Button asChild variant="secondary">
        {/* `noopener` denies the new document a handle on this one via
            `window.opener`; `noreferrer` withholds the referrer, which for a
            resource page leaks the course id to a third party. */}
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
      loading={pending}
      leadingIcon={<Download aria-hidden="true" className="size-4" />}
      onClick={onDownload}
    >
      Download
    </Button>
  );
}
