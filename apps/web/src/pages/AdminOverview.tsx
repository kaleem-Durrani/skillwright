import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Building2, ScrollText, ShieldAlert, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { usePolicy } from '@/lib/policy';
import { formatRelative } from '@/lib/format';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonList, SkeletonStats } from '@/components/ui/Skeleton';

interface AdminStats {
  users: number;
  suspendedUsers: number;
  departments: number;
  auditEventsToday: number;
}

interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorName: string | null;
  createdAt: string;
}

export function AdminOverviewPage() {
  const policy = usePolicy();

  const stats = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: () => api.get<AdminStats>('/admin/stats'),
  });

  const audit = useQuery({
    queryKey: ['admin', 'audit', 'recent'],
    queryFn: () => api.get<{ data: AuditEntry[] }>('/audit-events', { query: { limit: 8 } }),
    enabled: policy.can('audit:read'),
  });

  // `/admin/users` declares `page` as a required search param, so every link into
  // it states the page it means. The suspended tile also carries the status
  // filter — a tile that counts suspended users must land on the suspended users,
  // not on an unfiltered list the admin then has to filter by hand.
  const tiles = [
    {
      key: 'users',
      label: 'Users',
      icon: Users,
      value: stats.data?.users,
      to: '/admin/users' as const,
      search: { page: 1 } as const,
    },
    {
      key: 'suspended',
      label: 'Suspended',
      icon: ShieldAlert,
      value: stats.data?.suspendedUsers,
      to: '/admin/users' as const,
      search: { page: 1, status: 'SUSPENDED' } as const,
    },
    {
      key: 'departments',
      label: 'Departments',
      icon: Building2,
      value: stats.data?.departments,
      to: null,
    },
    {
      key: 'audit',
      label: 'Audit events today',
      icon: ScrollText,
      value: stats.data?.auditEventsToday,
      to: null,
    },
  ];

  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow="Admin workspace"
        title="Administration"
        description="Identity, structure, and the record of who changed what."
      />

      {stats.isPending ? (
        <SkeletonStats />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {tiles.map((tile) => (
            <li key={tile.key}>
              <Card interactive={Boolean(tile.to)} className="relative flex items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-md bg-brand-soft text-brand-on-soft">
                  <tile.icon aria-hidden="true" className="size-5" />
                </span>
                <div className="flex min-w-0 flex-col">
                  <span className="text-2xl leading-none font-semibold tabular-nums">
                    {tile.value ?? 0}
                  </span>
                  {tile.to ? (
                    <Link
                      to={tile.to}
                      search={tile.search}
                      className="truncate text-xs text-fg-tertiary after:absolute after:inset-0"
                    >
                      {tile.label}
                    </Link>
                  ) : (
                    <span className="truncate text-xs text-fg-tertiary">{tile.label}</span>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {policy.can('audit:read') ? (
        <section className="pt-8" aria-labelledby="admin-audit">
          <h2 id="admin-audit" className="pb-3 font-display text-lg font-semibold">
            Recent activity
          </h2>

          {audit.isPending ? (
            <SkeletonList rows={5} />
          ) : (audit.data?.data.length ?? 0) === 0 ? (
            <EmptyState
              variant="empty"
              compact
              title="Nothing recorded yet"
              description="Every create, update, delete and sign-in lands here automatically."
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {audit.data?.data.map((entry) => (
                <li key={entry.id}>
                  <Card className="flex flex-col gap-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <CardTitle className="text-sm">
                        {entry.action} · {entry.entityType}
                      </CardTitle>
                      <span className="shrink-0 text-2xs text-fg-tertiary">
                        {formatRelative(entry.createdAt)}
                      </span>
                    </div>
                    <p className="truncate font-mono text-2xs text-fg-tertiary">
                      {entry.actorName ?? 'system'} → {entry.entityId}
                    </p>
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
