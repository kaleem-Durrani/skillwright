import { useEffect, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
/*
 * The page envelope comes from the package that DEFINES it, on the same reasoning as
 * `Courses.tsx`'s identical import: `@/lib/api` keeps a hand-written copy of
 * `Paginated`, and the API validates every response against `paginated(...)` before
 * it sends it, so inferring from there is the only version that cannot drift.
 */
import type { Paginated } from '@skillwright/shared/schema';
import { api } from '@/lib/api';
import { qk } from '@/lib/query';
import { usePolicy } from '@/lib/policy';
import { formatDate } from '@/lib/format';
/*
 * `AnnouncementSummary`, NOT `AnnouncementDetail`. `GET /announcements` serves
 * `paginated(announcementSummarySchema)` (announcements.routes.ts:45-54): the excerpt
 * built server-side, never the full `content` — a list page must not ship every
 * post's whole body just to render a card.
 */
import type { AnnouncementSummary, AnnouncementTypeValue } from '@/lib/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge, type BadgeProps } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { DataList } from '@/components/ui/DataList';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Pagination } from '@/components/ui/Pagination';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/Select';
import { StatusChip } from '@/components/ui/StatusChip';
import { Gate } from '@/components/Gate';
import { AnnouncementFormDialog } from '@/components/announcements/AnnouncementFormDialog';
import { Route } from '@/routes/_app/announcements';

/**
 * Not in `STATUS_MAP` (StatusChip.tsx): that map is domain STATUSES — published,
 * draft, pending — and a post's TYPE is not a state it moves through. A second,
 * type-specific map is what `ResourceFormDialog.tsx`'s `TYPE_LABEL` does for the same
 * reason: resource type and resource status are two different questions.
 */
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

function TypeBadge({ type }: { type: AnnouncementTypeValue }) {
  return (
    <Badge tone={TYPE_TONE[type]} size="sm">
      {TYPE_LABEL[type]}
    </Badge>
  );
}

/** Published date if it has one, a Draft chip otherwise — never both. */
function PublishedCell({ publishedAt }: { publishedAt: string | null }) {
  return publishedAt ? (
    <span className="text-fg-secondary">{formatDate(publishedAt)}</span>
  ) : (
    <StatusChip status="DRAFT" />
  );
}

export function AnnouncementsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const policy = usePolicy();
  const [creating, setCreating] = useState(false);

  // Local mirror of the URL query so typing does not push a history entry per
  // keystroke; the URL is updated on a debounce below (Courses.tsx's pattern).
  // The route's validateSearch already carried `q`; the API's list handler has
  // ranked matching since Phase 3 slice 1 — only this input was missing.
  const [term, setTerm] = useState(search.q ?? '');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if ((search.q ?? '') === term) return;
      void navigate({
        search: (previous) => ({ ...previous, q: term || undefined, page: 1 }),
        replace: true,
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [term, search.q, navigate]);

  const announcements = useQuery({
    queryKey: qk.announcements(search),
    queryFn: () =>
      api.get<Paginated<AnnouncementSummary>>('/announcements', {
        query: { page: search.page, limit: 20, q: search.q, type: search.type },
      }),
    // Keeps the previous page on screen while the next one loads instead of
    // collapsing the list back to a skeleton on every page or filter change.
    placeholderData: (previous) => previous,
  });

  const isFiltered = Boolean(search.type || search.q);
  /*
   * Same ceiling as the API's own `listAnnouncementsQuerySchema` (`q.max(120)`),
   * so a longer term is refused at the keystroke instead of answered with a 422.
   */
  const maxQueryLength = 120;

  function clearFilters() {
    setTerm('');
    void navigate({ search: { page: 1 } });
  }
  const canCreate = policy.can('announcement:create');

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Announcements"
        description="News, events and general announcements for everyone entitled to see them."
        actions={
          <Gate action="announcement:create">
            <Button
              block
              className="sm:w-auto"
              leadingIcon={<Plus aria-hidden="true" className="size-4" />}
              onClick={() => setCreating(true)}
            >
              New announcement
            </Button>
          </Gate>
        }
      />

      <div className="flex flex-col gap-3 pb-(--space-block) md:flex-row md:items-center">
        <Input
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search announcements"
          aria-label="Search announcements"
          leading={<Search aria-hidden="true" className="size-4" />}
          maxLength={maxQueryLength}
          className="md:w-80"
        />
        <Select
          value={search.type ?? 'ALL'}
          onValueChange={(next) =>
            void navigate({
              search: (previous) => ({
                ...previous,
                page: 1,
                ...(next === 'ALL' ? {} : { type: next as AnnouncementTypeValue }),
              }),
            })
          }
        >
          <SelectTrigger aria-label="Filter by type" className="md:w-56" />
          <SelectContent>
            <SelectItem value="ALL">All types</SelectItem>
            <SelectItem value="NEWS">News</SelectItem>
            <SelectItem value="EVENT">Event</SelectItem>
            <SelectItem value="ANNOUNCEMENT">Announcement</SelectItem>
          </SelectContent>
        </Select>
        {isFiltered ? (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        ) : null}
      </div>

      <DataList
        items={announcements.data?.data ?? []}
        loading={announcements.isPending}
        caption="Announcements"
        getKey={(announcement) => announcement.id}
        columns={[
          {
            id: 'title',
            header: 'Announcement',
            cell: (announcement) => (
              <div className="flex flex-col gap-0.5">
                <Link
                  to="/announcements/$announcementId"
                  params={{ announcementId: announcement.id }}
                  className="font-medium text-fg hover:text-fg-brand"
                >
                  {announcement.title}
                </Link>
                <span className="line-clamp-1 text-xs text-fg-tertiary">
                  {announcement.excerpt}
                </span>
              </div>
            ),
          },
          {
            id: 'type',
            header: 'Type',
            cell: (announcement) => <TypeBadge type={announcement.type} />,
          },
          {
            id: 'author',
            header: 'Author',
            cell: (announcement) => announcement.author.name,
            secondary: true,
          },
          {
            id: 'published',
            header: 'Published',
            align: 'end',
            cell: (announcement) => <PublishedCell publishedAt={announcement.publishedAt} />,
          },
        ]}
        renderCard={(announcement) => (
          <Card interactive className="relative flex flex-col gap-2">
            <div className="flex items-start justify-between gap-3">
              <CardTitle className="text-base">
                <Link
                  to="/announcements/$announcementId"
                  params={{ announcementId: announcement.id }}
                  className="outline-none after:absolute after:inset-0"
                >
                  {announcement.title}
                </Link>
              </CardTitle>
              <PublishedCell publishedAt={announcement.publishedAt} />
            </div>
            <div className="flex items-center gap-2 text-xs text-fg-tertiary">
              <TypeBadge type={announcement.type} />
              <span>{announcement.author.name}</span>
            </div>
            <p className="line-clamp-2 text-sm text-fg-secondary">{announcement.excerpt}</p>
          </Card>
        )}
        empty={
          isFiltered ? (
            <EmptyState
              variant="no-results"
              description="No announcement matched that search or filter. Try fewer words, or clear them."
              actionLabel="Clear filters"
              onAction={clearFilters}
            />
          ) : (
            <EmptyState
              variant="empty"
              title="Nothing posted yet"
              description={
                canCreate
                  ? 'Post the first announcement and it will be listed here.'
                  : 'Nothing has been published yet.'
              }
              {...(canCreate
                ? { actionLabel: 'New announcement', onAction: () => setCreating(true) }
                : {})}
            />
          )
        }
      />

      {announcements.data ? (
        <Pagination
          label="Announcements pagination"
          page={announcements.data.meta.page}
          totalPages={announcements.data.meta.totalPages}
          total={announcements.data.meta.total}
          limit={announcements.data.meta.limit}
          onPageChange={(page) => void navigate({ search: (previous) => ({ ...previous, page }) })}
        />
      ) : null}

      <AnnouncementFormDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
