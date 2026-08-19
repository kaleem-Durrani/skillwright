import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, RotateCcw } from 'lucide-react';
/*
 * The page envelope comes from the package that DEFINES it, not from `@/lib/api`'s
 * hand-written copy of it (Courses.tsx:5-13 argues this at length). Type-only, so
 * the specifier erases at build time and pulls no zod into the bundle.
 */
import type { Paginated } from '@skillwright/shared/schema';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatRelative } from '@/lib/format';
import { subject, usePolicy } from '@/lib/policy';
import { qk } from '@/lib/query';
import { useSession } from '@/lib/session';
import type { NotificationDto, UnreadCountResponse } from '@/lib/types';
import { Badge } from '@/components/ui/Badge';
import { IconButton } from '@/components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu';
import { EmptyState } from '@/components/ui/EmptyState';
import { ScrollArea } from '@/components/ui/ScrollArea';
import { Skeleton } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/Toast';

/**
 * How many rows the bell shows. This is a PANEL, not the archive: ten rows is
 * roughly two thumb-scrolls at 375px, and the list endpoint is paginated, so
 * asking for more would only lengthen a menu nobody reads to the bottom of.
 */
const PANEL_LIMIT = 10;

/**
 * The notification bell and the panel behind it.
 *
 * WHY a DropdownMenu rather than a bespoke popover: the account menu two
 * elements to the right is already one, and Radix's menu brings focus return to
 * the trigger, escape-to-close, outside-click dismissal, roving arrow-key
 * navigation and `aria-expanded` with it. A hand-rolled panel gets none of that
 * for free and loses at least one of them in review.
 *
 * `unreadCount` is a PROP rather than a second `useQuery` here. AppShell already
 * owns `GET /notifications/unread-count` because it decides whether to render
 * the bell at all; querying it twice would put two copies of the badge number on
 * screen and let them disagree during a mutation.
 */
export function NotificationBell({ unreadCount }: { unreadCount: number }) {
  const { user } = useSession();
  const policy = usePolicy();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);

  /*
   * `notification:read` and `notification:update` are `isSelf` for every role, so
   * both rules read `subject.userId`. A subject-free `can()` reads an absent
   * field, denies, and silently disables the whole feature for everyone — the
   * exact bug that hid this bell in the first place. Never ask without the
   * subject; when there is no user there is nothing to ask about.
   */
  const self = user ? subject({ userId: user.id }) : undefined;
  const canRead = self ? policy.can('notification:read', self) : false;
  const canMarkRead = self ? policy.can('notification:update', self) : false;

  /*
   * Keyed through `qk`. `qk.notifications(false)` is THIS list;
   * `qk.notificationsUnread` is the scalar count AppShell holds. Two keys for two
   * shapes — they were one slot until recently, which meant a paginated envelope
   * and a `{ unread }` number shared a cache entry.
   *
   * `enabled` waits for the panel to open. A bell that fetches ten rows on every
   * page load spends the request on a menu most sessions never open; the badge
   * alone is what the closed state actually needs.
   */
  const list = useQuery({
    queryKey: qk.notifications(false),
    queryFn: () =>
      api.get<Paginated<NotificationDto>>('/notifications', { query: { limit: PANEL_LIMIT } }),
    enabled: canRead && open,
  });

  /*
   * One mutation for both verbs, because the API is one verb: `POST /read` with
   * `{ ids }` marks those rows, and WITHOUT `ids` marks everything. `{}` rather
   * than a bodyless POST for the mark-all case — an object always reaches the
   * validator, so `read` picks up its schema default instead of relying on the
   * route's `.nullish()` rescue of a `null` body.
   */
  const markRead = useMutation({
    mutationFn: (ids: string[] | undefined) =>
      api.post<UnreadCountResponse>('/notifications/read', ids === undefined ? {} : { ids }),
    onSuccess: async (result) => {
      /*
       * The badge updates from the RESPONSE. `POST /read` answers with the
       * recomputed count on the same round trip precisely so this is a cache
       * write rather than a second GET that can race another tab.
       */
      client.setQueryData<UnreadCountResponse>(qk.notificationsUnread, result);
      // The rows themselves still have to come back from the server — `readAt`
      // is a server timestamp, not something the client is entitled to invent.
      await client.invalidateQueries({ queryKey: qk.notifications(false) });
    },
    onError: (error) => toast.fromError(error, 'Could not mark those as read'),
  });

  /**
   * Opening the panel refreshes BOTH halves of it.
   *
   * The list refetches on its own — its query is `enabled` only while open, so it
   * remounts each time. The count does not: it lives in AppShell with a 60s
   * staleTime, no `refetchInterval`, and the client-wide
   * `refetchOnWindowFocus: false`, so after mount it changed only when the
   * mutation below wrote it back. A notification that arrived server-side
   * therefore rendered as an unread ROW while the badge showed nothing and "Mark
   * all read" sat disabled — the panel disagreeing with itself. Invalidating on
   * the same trigger as the list puts the two back on one clock.
   */
  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      void client.invalidateQueries({ queryKey: qk.notificationsUnread });
    }
  }

  if (!user || !canRead) return null;

  const notifications = list.data?.data ?? [];
  const isEmpty = !list.isPending && !list.isError && notifications.length === 0;

  /*
   * The ROWS are a second opinion on the badge. `unreadCount` arrives as a prop
   * from a query this component does not own, so it can still be a moment behind
   * even with the invalidation above — and an unread row on screen is direct
   * evidence that there is something for "Mark all read" to do. Either source
   * saying yes is enough to enable it; the mutation is idempotent if both are
   * wrong.
   */
  const hasUnread =
    unreadCount > 0 || notifications.some((notification) => notification.readAt === null);

  /**
   * Selecting a row does up to two things, and either one on its own is a
   * complete interaction:
   *
   *   - an unread row is marked read by id
   *   - a row with a `linkPath` navigates there, which closes the menu
   *
   * `linkPath` is a server-built string, not one of the router's literal route
   * paths, so it goes through `href` — the option TanStack Router documents for
   * a fully built path. `to` would demand a path the type system already knows.
   *
   * A row with nothing to open keeps the panel OPEN (`preventDefault`), so
   * triaging a stack of notifications is one tap each rather than tap, reopen,
   * tap.
   */
  function selectNotification(notification: NotificationDto, event: Event) {
    if (notification.readAt === null && canMarkRead) {
      markRead.mutate([notification.id]);
    }
    if (notification.linkPath !== null) {
      void navigate({ href: notification.linkPath });
      return;
    }
    event.preventDefault();
  }

  return (
    /*
     * `shrink-0` is not decoration. This is a flex child of the top bar, and
     * globals.css sets `min-inline-size: 0` on `*`, so without it the wrapper
     * compresses below the 44px IconButton it contains. The badge is positioned
     * absolutely AGAINST this wrapper, so the moment it narrows the count
     * detaches from the bell it is counting for. At 375px with the "Demo" badge
     * present there is no slack left to absorb.
     */
    <div className="relative shrink-0">
      <DropdownMenu open={open} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger asChild>
          <IconButton
            aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
            icon={<Bell aria-hidden="true" className="size-5" />}
          />
        </DropdownMenuTrigger>

        {/*
         * The width is the smaller of a comfortable reading column and whatever
         * Radix measured between the trigger and the viewport edge, so at 375px
         * the panel fits inside the 12px collision padding instead of pushing
         * the page sideways. Same mechanism the shared content already uses for
         * its height.
         */}
        {/*
         * `aria-busy` on the MENU, not on the skeleton: this is the element with
         * the role, so it is the one an assistive technology is tracking. It flips
         * false when the rows land, which is the cue to re-read the panel.
         */}
        <DropdownMenuContent
          align="end"
          aria-busy={list.isPending}
          aria-label="Notifications"
          className="[inline-size:min(21rem,var(--radix-dropdown-menu-content-available-width))]"
        >
          <DropdownMenuLabel className="flex items-center justify-between gap-2">
            <span>Notifications</span>
            {unreadCount > 0 ? (
              <Badge tone="brand" variant="solid" size="sm">
                {unreadCount} new
              </Badge>
            ) : null}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          {/*
           * Every branch that is NOT a row is wrapped in `role="none"`.
           *
           * ARIA lets a `menu` own only menuitem/menuitemcheckbox/menuitemradio/
           * group/separator. EmptyState renders `role="alert"`/`"status"` with an
           * <h3> and a <p> inside, and the skeleton is a bare div — as direct
           * children of the menu those are invalid owned elements, and a screen
           * reader walking the panel in menu mode skipped straight past them. A
           * user whose notifications failed to load heard an empty menu.
           *
           * `role="none"` on the wrapper is the minimal fix: it stops the branch
           * presenting itself as a child with a competing role. Rewriting the
           * panel onto Popover would satisfy ARIA more completely and cost the
           * roving arrow-key focus, which is the reason this is a menu at all.
           */}
          {list.isPending ? (
            <div role="none">
              <NotificationRowsPending />
            </div>
          ) : list.isError ? (
            <>
              <div role="none">
                <EmptyState
                  variant="error"
                  compact
                  title="Notifications did not load"
                  description="Nothing you did caused this."
                  className="border-0 bg-transparent"
                />
              </div>
              {/*
               * The retry is a real DropdownMenuItem, NOT EmptyState's `onAction`
               * button. Radix preventDefaults Tab inside its menu content and its
               * roving focus only walks nodes registered in the Menu.Item
               * collection, so a plain <button> in here is reachable by mouse and
               * by nothing else: a keyboard or screen-reader user whose
               * notifications failed to load had no way back but Escape. As a
               * Menu.Item it joins the collection and answers to arrow keys —
               * registration is by context, not DOM nesting, which is also why
               * the rows keep working inside ScrollArea's wrapper divs.
               *
               * `preventDefault` keeps the panel open so the refetch it triggers
               * has somewhere to render.
               */}
              <DropdownMenuItem
                icon={<RotateCcw aria-hidden="true" className="size-4" />}
                onSelect={(event) => {
                  event.preventDefault();
                  void list.refetch();
                }}
              >
                Try again
              </DropdownMenuItem>
            </>
          ) : isEmpty ? (
            <div role="none">
              <EmptyState
                variant="empty"
                compact
                title="You are all caught up"
                description="Enrolment decisions, new resources and replies land here."
                className="border-0 bg-transparent"
              />
            </div>
          ) : (
            <ScrollArea viewportClassName="[max-block-size:min(20rem,50dvh)]">
              {/*
               * No <ul>/<li> around these. The content is `role="menu"` and Radix
               * gives each row `role="menuitem"`; a list element between the two
               * breaks that ownership and reads to a screen reader as a list that
               * happens to contain menu items.
               */}
              {notifications.map((notification) => (
                <NotificationRow
                  key={notification.id}
                  notification={notification}
                  onSelect={(event) => selectNotification(notification, event)}
                />
              ))}
            </ScrollArea>
          )}

          {/*
           * Last, after a separator, and full width — the same shape as the
           * account menu's terminal action. At the bottom it is also where a
           * thumb already is after scrolling the list.
           *
           * `preventDefault` keeps the panel open so the unread dots visibly
           * clear. Closing it would hide the only evidence the tap worked.
           */}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            icon={<CheckCheck aria-hidden="true" className="size-4" />}
            disabled={!canMarkRead || !hasUnread || markRead.isPending}
            onSelect={(event) => {
              event.preventDefault();
              markRead.mutate(undefined);
            }}
          >
            Mark all read
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/*
       * Outside the trigger, not inside it: a count that lives in the button's
       * flow would push the icon off centre as it grows from 1 to 9+. It is
       * `aria-hidden` because the trigger's own label already says "3 unread",
       * and a screen reader should hear that once.
       */}
      {unreadCount > 0 ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute end-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-brand px-1 text-2xs font-bold text-fg-on-brand tabular-nums"
        >
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      ) : null}
    </div>
  );
}

/**
 * One row.
 *
 * `payload` carries EXACTLY `{ title, body }` — `notificationPayloadSchema` is a
 * closed object and the API strips anything else a producer denormalised into
 * the column, so there is no avatar, no actor name and no count to render here.
 * The timestamp and the unread state come off the DTO itself.
 */
function NotificationRow({
  notification,
  onSelect,
}: {
  notification: NotificationDto;
  onSelect: (event: Event) => void;
}) {
  const isUnread = notification.readAt === null;

  return (
    <DropdownMenuItem
      onSelect={onSelect}
      // `items-start` because the dot belongs beside the TITLE, not floating in
      // the middle of a two-line row.
      //
      // The last-child override is load-bearing: the shared item truncates its
      // content slot to a single line, which is right for a menu of verbs and
      // wrong for a notification that has a body. Allowing that one span to wrap
      // is a smaller change than a second item primitive.
      className="items-start [&>span:last-child]:whitespace-normal"
      icon={
        <span
          className={cn(
            'mt-1.5 block size-2 rounded-full',
            isUnread ? 'bg-brand' : 'bg-transparent',
          )}
        />
      }
    >
      {isUnread ? <span className="sr-only">Unread. </span> : null}

      <span className="flex items-baseline gap-2">
        <span
          className={cn(
            'flex-1 truncate text-sm',
            isUnread ? 'font-semibold text-fg' : 'font-medium text-fg-secondary',
          )}
        >
          {notification.payload.title}
        </span>
        <time dateTime={notification.createdAt} className="shrink-0 text-2xs text-fg-tertiary">
          {formatRelative(notification.createdAt)}
        </time>
      </span>

      <span className="mt-0.5 line-clamp-2 text-xs text-fg-secondary">
        {notification.payload.body}
      </span>
    </DropdownMenuItem>
  );
}

/**
 * Mirrors the two text lines of a real row, so nothing jumps when they arrive.
 *
 * `role="status"` is what gives the sr-only text a chance of being heard. It was
 * previously a bare span inside a non-focusable div, which no assistive
 * technology has any reason to read: the panel opened silent and the rows
 * appeared silent. A polite live region announces without stealing focus from
 * the menu, which matters here because focus is what drives the whole panel.
 */
function NotificationRowsPending() {
  return (
    <div role="status" className="flex flex-col gap-3 px-2.5 py-3">
      <span className="sr-only">Loading notifications</span>
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="flex flex-col gap-1.5">
          <Skeleton shape="text" className="w-2/5" />
          <Skeleton shape="text" className="w-4/5" />
        </div>
      ))}
    </div>
  );
}
