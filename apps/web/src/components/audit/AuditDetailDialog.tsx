import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { api } from '@/lib/api';
import { qk } from '@/lib/query';
import { formatDateTime, formatRelative } from '@/lib/format';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { SkeletonList } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';

/**
 * The body of `GET /audit-events/:id` — mirrored by hand, not re-exported.
 *
 * The audit wire shapes are deliberately API-local (apps/api audit.schema.ts:1-18;
 * the Phase 8 scoping note keeps them out of @skillwright/shared), so there is no
 * shared schema to import and this file is the SPA's one copy — the same position
 * `DashboardStats` in lib/types.ts is in, with the same one-commit fix when a shared
 * shape ever exists. The LIST row this dialog is opened FROM stays seven fields; only
 * here do the stored forensics cross the wire.
 */
export interface AuditEventDetail {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorId: string | null;
  actorName: string | null;
  createdAt: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

/** Pretty-printed, stable-keyed JSON for one side of a diff. */
function jsonBlock(value: Record<string, unknown> | null): string {
  if (!value) return '— nothing recorded —';
  return JSON.stringify(value, null, 2);
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="shrink-0 text-2xs font-semibold tracking-wide text-fg-tertiary uppercase sm:w-28 sm:pt-0.5">
        {label}
      </dt>
      <dd className="min-w-0 break-words text-sm text-fg-secondary">{value}</dd>
    </div>
  );
}

export interface AuditDetailDialogProps {
  /** The feed row to inspect, or null when the dialog is closed. */
  eventId: string | null;
  onClose: () => void;
}

/**
 * One audit event's forensics: who acted, what changed on each side of it, and the
 * request metadata the extension recorded (packages/db/src/audit.ts:259-269).
 *
 * A DIALOG rather than a route, per house patterns — the feed is an admin overview,
 * not a destination of its own, so detail is a layer over it that Escape dismisses
 * back to the exact page state it came from (the suspend and department dialogs work
 * the same way). It displays what is STORED and does nothing else: RESTORE/REINSTATE
 * rows can be read here but still cannot be written, because no endpoint causes those
 * transitions yet.
 *
 * Fetching is keyed on the id alone and enabled only while open, so closing cancels
 * nothing and reopening refetches rather than trusting a cache entry that could have
 * been stale — though rows are append-only, which makes staleness impossible today;
 * the query is simply not worth caching beyond its viewing.
 */
export function AuditDetailDialog({ eventId, onClose }: AuditDetailDialogProps) {
  const detail = useQuery({
    queryKey: qk.auditEvent(eventId ?? ''),
    queryFn: () => api.get<AuditEventDetail>(`/audit-events/${eventId}`),
    enabled: eventId !== null,
    staleTime: Number.POSITIVE_INFINITY,
  });

  return (
    <Dialog open={eventId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title="Audit event"
        description={detail.data ? `${detail.data.action} · ${detail.data.entityType}` : undefined}
      >
        {detail.isPending ? (
          <SkeletonList rows={2} />
        ) : detail.isError || !detail.data ? (
          <EmptyState
            variant="error"
            compact
            title="This event could not be loaded"
            description="It may have been requested with a malformed id."
            actionLabel="Try again"
            onAction={() => detail.refetch()}
          />
        ) : (
          <div className="flex flex-col gap-4">
            <dl className="flex flex-col gap-2.5">
              <Field label="Actor" value={detail.data.actorName ?? 'system'} />
              <Field label="Action" value={detail.data.action} />
              <Field label="Entity" value={`${detail.data.entityType} · ${detail.data.entityId}`} />
              <Field
                label="When"
                value={
                  <>
                    {formatDateTime(detail.data.createdAt)}{' '}
                    <span className="text-xs text-fg-tertiary">
                      ({formatRelative(detail.data.createdAt)})
                    </span>
                  </>
                }
              />
              <Field label="IP" value={detail.data.ip ?? '—'} />
              <Field label="User agent" value={detail.data.userAgent ?? '—'} />
              <Field
                label="Request ID"
                value={<span className="font-mono text-xs">{detail.data.requestId ?? '—'}</span>}
              />
            </dl>

            <div className="flex flex-col gap-1">
              <h3 className="text-2xs font-semibold tracking-wide text-fg-tertiary uppercase">
                Before
              </h3>
              <pre className="scroll-y max-h-44 rounded-md bg-sunken p-3 font-mono text-xs break-all whitespace-pre-wrap text-fg-secondary">
                {jsonBlock(detail.data.before)}
              </pre>
            </div>

            <div className="flex flex-col gap-1">
              <h3 className="text-2xs font-semibold tracking-wide text-fg-tertiary uppercase">
                After
              </h3>
              <pre className="scroll-y max-h-44 rounded-md bg-sunken p-3 font-mono text-xs break-all whitespace-pre-wrap text-fg-secondary">
                {jsonBlock(detail.data.after)}
              </pre>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
