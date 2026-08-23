import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Check, CheckCheck } from 'lucide-react';
/*
 * The page envelope comes from the package that DEFINES it, not from `@/lib/api`'s
 * hand-written copy (Courses.tsx:5-13 argues this at length). Type-only, so the
 * specifier erases at build time and pulls no zod into the bundle.
 */
import type { Paginated } from '@skillwright/shared/schema';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatRelative } from '@/lib/format';
import { subject, usePolicy } from '@/lib/policy';
import { qk } from '@/lib/query';
import { useSession } from '@/lib/session';
import type { NotificationDto, UnreadCountResponse } from '@/lib/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pagination } from '@/components/ui/Pagination';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { toast } from '@/components/ui/Toast';
import { Route } from '@/routes/_app/notifications';

/** Same window as every other browsed list (`DEFAULT_PAGE_SIZE`, pagination.ts:3). */
const PAGE_SIZE = 20;

/**
 * The full notification archive — what the bell's panel cannot be, because a
 * panel holding ten rows is a triage surface, not a record.
 *
 * Reachability is by design NOT a primary-nav entry: `primaryNav` slices the
 * bottom bar to five targets and Settings already yielded its slot once
 * (nav.ts:95-104), so a sixth entry would silently drop someone's destination.
 * Every signed-in user reaches this screen through the bell's "View all".
 */
export function NotificationsPage() {
  const search = Route.useSearch();
  /*
   * TWO navigate bindings for two different jobs. The typed one — bound to this
   * route — updates search params; binding it is what makes a wrong search shape
   * a compile error. An UNBOUND one handles server-built `linkPath`s: those are
   * arbitrary strings that may point at any route (the bell does exactly this,
   * NotificationBell.tsx:163-172), and the bound typing would demand THIS route's
   * search params for every href.
   */
  const navigate = useNavigate({ from: Route.fullPath });
  const navigateByHref = useNavigate();
  const client = useQueryClient();
  const { user } = useSession();
  const policy = usePolicy();

  /*
   * Subject discipline (LESSONS-LEARNED #15/#31): `notification:update` is `isSelf`
   * for every role, and `isSelf` READS `subject.userId`. Asked with no subject it
   * denies everyone — but this is an ACTION gate (one button), not a list gate.
   * The subject exists — the `_app` layout's guard proved a session before this
   * screen mounted — so asking WITH it is exact, not a denial trap. The LIST query
   * below asks nothing: the route is authentication-gated and the server scopes
   * rows to the caller (`scopedWhere`), which is the WHERE clause lesson #15 says
   * a cross-user list must rely on instead of any `can()`.
   */
  const canMarkRead = user
    ? policy.can('notification:update', subject({ userId: user.id }))
    : false;

  const list = useQuery({
    queryKey: qk.notifications(search.unreadOnly === true, search.page),
    queryFn: () =>
      api.get<Paginated<NotificationDto>>('/notifications', {
        query: {
          page: search.page,
          limit: PAGE_SIZE,
          // `unreadOnly` is a string enum ('true'|'false') on the wire
          // (listNotificationsQuerySchema); absent means ALL.
          ...(search.unreadOnly === true ? { unreadOnly: 'true' as const } : {}),
        },
      }),
    // Keeps the previous page/filter's rows on screen while the next loads, same
    // as Courses.tsx and Messages.tsx — a filter flip must not collapse to skeleton.
    placeholderData: (previous) => previous,
  });

  /*
   * THE SAME ONE VERB THE BELL USES, and the same cache discipline: `POST /read`
   * answers with the recomputed count precisely so the badge is a cache WRITE from
   * the response rather than a second GET that can race another tab; the ROWS come
   * back from the server because `readAt` is a server timestamp the client is not
   * entitled to invent (NotificationBell.tsx:96-111).
   *
   * Both list prefixes are invalidated — not just the one on screen — because a row
   * marked read leaves the OTHER filter's cached pages too, and the bell's panel
   * window lives under `qk.notifications(false)`. Structural key matching makes
   * each prefix reach every archived page of its filter.
   */
  const markRead = useMutation({
    mutationFn: (ids: string[] | undefined) =>
      api.post<UnreadCountResponse>('/notifications/read', ids === undefined ? {} : { ids }),
    onSuccess: async (result) => {
      client.setQueryData<UnreadCountResponse>(qk.notificationsUnread, result);
      await client.invalidateQueries({ queryKey: qk.notifications(false) });
      await client.invalidateQueries({ queryKey: qk.notifications(true) });
    },
    onError: (error) => toast.fromError(error, 'Could not mark those as read'),
  });

  function setFilter(value: string) {
    // A filter change resets pagination — page 3 of "unread" may not exist, and a
    // stale deep link must not open on a blank page (Announcements.tsx does the same).
    void navigate({ search: { page: 1, ...(value === 'unread' ? { unreadOnly: true } : {}) } });
  }

  function setPage(page: number) {
    void navigate({ search: (previous) => ({ ...previous, page }) });
  }

  /** Follows a row's server-built `linkPath`. Not a router literal — see NotificationRow. */
  function openLink(path: string) {
    void navigateByHref({ href: path });
  }

  const rows = list.data?.data ?? [];

  /*
   * Two opinions on "is there anything to mark", mirroring the bell's own pair
   * (NotificationBell.tsx:137-146): the shell's badge count, read WITHOUT
   * subscribing so this page does not become a second observer of an entry whose
   * staleness AppShell owns; and the rows actually on screen, which are direct
   * evidence even when the count is a moment behind. Either saying yes is enough —
   * the mutation is idempotent if both are wrong.
   */
  const unreadFromBadge =
    client.getQueryData<UnreadCountResponse>(qk.notificationsUnread)?.unread ?? 0;
  const hasUnread =
    unreadFromBadge > 0 || rows.some((notification) => notification.readAt === null);

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Notifications"
        description="Everything that happened while you were away: enrolment decisions, published work, replies and messages."
        actions={
          <Button
            variant="secondary"
            leadingIcon={<CheckCheck aria-hidden="true" className="size-4" />}
            disabled={!canMarkRead || !hasUnread || markRead.isPending}
            onClick={() => markRead.mutate(undefined)}
          >
            Mark all read
          </Button>
        }
      />

      {/*
       * Real Radix tabs — triggers AND panels — so the ARIA ownership stays valid:
       * each trigger controls a real panel below it. Both panels render the same
       * body component with different empty-state copy, because "no notifications
       * at all" and "nothing unread" are genuinely different situations with
       * genuinely different things to say (EmptyState.tsx:18-28).
       */}
      <Tabs value={search.unreadOnly === true ? 'unread' : 'all'} onValueChange={setFilter}>
        <TabsList aria-label="Filter notifications by read state">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="unread">Unread</TabsTrigger>
        </TabsList>

        <TabsContent value="all">
          <NotificationListBody
            list={list}
            emptyTitle="No notifications yet"
            emptyDescription="Enrolment decisions, new resources and replies land here."
            canMarkRead={canMarkRead}
            onMarkRead={(ids) => markRead.mutate(ids)}
            onOpenLink={openLink}
            onRetry={() => void list.refetch()}
            onBackToFirstPage={() => setPage(1)}
          />
        </TabsContent>

        <TabsContent value="unread">
          <NotificationListBody
            list={list}
            emptyTitle="You're all caught up"
            emptyDescription="Switch to All to browse everything you've already read."
            canMarkRead={canMarkRead}
            onMarkRead={(ids) => markRead.mutate(ids)}
            onOpenLink={openLink}
            onRetry={() => void list.refetch()}
            onBackToFirstPage={() => setPage(1)}
          />
        </TabsContent>
      </Tabs>

      {/* One pagination control for either filter, kept OUTSIDE the panels so it
          does not unmount (and lose its place) on every filter flip. */}
      {list.data ? (
        <Pagination
          label="Notifications pagination"
          page={list.data.meta.page}
          totalPages={list.data.meta.totalPages}
          total={list.data.meta.total}
          limit={list.data.meta.limit}
          onPageChange={setPage}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// List body
// ---------------------------------------------------------------------------

interface NotificationListBodyProps {
  list: UseQueryResult<Paginated<NotificationDto>>;
  emptyTitle: string;
  emptyDescription: string;
  canMarkRead: boolean;
  onMarkRead: (ids: string[]) => void;
  onOpenLink: (path: string) => void;
  onRetry: () => void;
  onBackToFirstPage: () => void;
}

/**
 * Everything between the tab strip and the pagination: pending, error, empty and
 * rows. One component rather than four branches inline, because BOTH tab panels
 * render it and the branches must not drift apart.
 */
function NotificationListBody({
  list,
  emptyTitle,
  emptyDescription,
  canMarkRead,
  onMarkRead,
  onOpenLink,
  onRetry,
  onBackToFirstPage,
}: NotificationListBodyProps) {
  const rows = list.data?.data ?? [];
  // A deep link past the end of the list (?page=9 of three pages) arrives as an
  // empty DATA array on a page the list never had — that is "no results", not
  // "nothing yet", and it gets the variant whose fix is an action.
  const isPastEnd = rows.length === 0 && (list.data?.meta.totalPages ?? 1) > 1;

  if (list.isPending) {
    return <SkeletonList rows={5} />;
  }

  if (list.isError) {
    return (
      <EmptyState
        variant="error"
        title="Notifications did not load"
        description="Nothing you did caused this."
        actionLabel="Try again"
        onAction={onRetry}
      />
    );
  }

  if (rows.length === 0) {
    return isPastEnd ? (
      <EmptyState
        variant="no-results"
        title="Nothing on this page"
        description="That page is past the end of this list."
        actionLabel="Back to first page"
        onAction={onBackToFirstPage}
      />
    ) : (
      <EmptyState variant="empty" title={emptyTitle} description={emptyDescription} />
    );
  }

  /*
   * No roles beyond the plain list: unlike the bell's panel there is no menu role
   * to satisfy here, so ordinary <ul>/<li> semantics are exactly right.
   */
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((notification) => (
        <NotificationRow
          key={notification.id}
          notification={notification}
          canMarkRead={canMarkRead}
          onMarkRead={() => onMarkRead([notification.id])}
          onOpenLink={onOpenLink}
        />
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

interface NotificationRowProps {
  notification: NotificationDto;
  canMarkRead: boolean;
  onMarkRead: () => void;
  onOpenLink: (path: string) => void;
}

/**
 * One archive row.
 *
 * The whole content block is ONE anchor when `linkPath` exists — native link
 * semantics keep middle-click, copy-address and the browser's status bar working,
 * none of which survive an onClick'd <div>. `linkPath` is a server-built string,
 * not one of the router's literal paths, so it drives `navigate({ href })` (the
 * option TanStack documents for a fully built path) after preventDefault, exactly
 * as the bell's rows do.
 *
 * An unread row opened THROUGH its link is marked read too — reading a thing is
 * the act that retires its notification, and the panel has always behaved this way
 * (NotificationBell.tsx:163-172). The explicit button beside it exists for
 * triage: retiring a row without following wherever it points.
 */
function NotificationRow({
  notification,
  canMarkRead,
  onMarkRead,
  onOpenLink,
}: NotificationRowProps) {
  const isUnread = notification.readAt === null;
  const title = notification.payload.title;
  // Captured so the non-null narrowing below survives into the anchor's closure —
  // a mutable property access does not.
  const linkPath = notification.linkPath;

  const content = (
    <>
      {/*
       * items-baseline + justify-between, matching the bell's row: title left,
       * relative timestamp right, body under both. The sr-only "Unread." rides
       * WITH the title so a screen reader hears the state where the name is.
       */}
      <span className="flex items-baseline gap-2">
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-sm',
            isUnread ? 'font-semibold text-fg' : 'font-medium text-fg-secondary',
          )}
        >
          {isUnread ? <span className="sr-only">Unread. </span> : null}
          {title}
        </span>
        <time dateTime={notification.createdAt} className="shrink-0 text-2xs text-fg-tertiary">
          {formatRelative(notification.createdAt)}
        </time>
      </span>
      <span className="mt-0.5 line-clamp-2 text-xs text-fg-secondary">
        {notification.payload.body}
      </span>
    </>
  );

  return (
    <li
      className={cn(
        'flex items-start gap-3 rounded-[var(--card-radius)] border p-3',
        isUnread
          ? 'border-line-brand bg-selected'
          : 'border-[var(--card-border)] bg-[var(--card-bg)]',
      )}
    >
      {/*
       * The unread dot is decorative — the sr-only text above already says it —
       * so it is aria-hidden and transparent once read, keeping the column from
       * reflowing when rows change state.
       */}
      <span
        aria-hidden="true"
        className={cn(
          'mt-2 size-2 shrink-0 rounded-full',
          isUnread ? 'bg-brand' : 'bg-transparent',
        )}
      />

      {linkPath !== null ? (
        <a
          href={linkPath}
          className="min-w-0 flex-1 flex-col outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line-focus"
          onClick={(event) => {
            event.preventDefault();
            if (isUnread && canMarkRead) onMarkRead();
            onOpenLink(linkPath);
          }}
        >
          {content}
        </a>
      ) : (
        <div className="min-w-0 flex-1">{content}</div>
      )}

      {isUnread && canMarkRead ? (
        <IconButton
          aria-label={`Mark '${title}' as read`}
          icon={<Check aria-hidden="true" className="size-4" />}
          size="sm"
          variant="ghost"
          onClick={onMarkRead}
        />
      ) : null}
    </li>
  );
}
