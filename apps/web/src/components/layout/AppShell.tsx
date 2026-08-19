import { useMemo, type ReactNode } from 'react';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { LogOut, User as UserIcon } from 'lucide-react';
import { BRAND } from '@skillwright/shared/brand';
import { cn } from '@/lib/cn';
import { api } from '@/lib/api';
import { qk } from '@/lib/query';
import { useMotionKit } from '@/lib/motion';
import { subject, usePolicy } from '@/lib/policy';
import { useLogout, useSession } from '@/lib/session';
import type { UnreadCountResponse } from '@/lib/types';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu';
import { ThemeToggle } from '@/components/ThemeToggle';
import { NAV_BY_ROLE, ROLE_LABEL, WORKSPACE_LABEL, primaryNav, type NavItem } from './nav.js';
import { NotificationBell } from './NotificationBell.js';

function useActivePath(): string {
  return useRouterState({ select: (state) => state.location.pathname });
}

function isActive(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`);
}

/**
 * The application chrome.
 *
 * MOBILE FIRST, structurally:
 *   < md  a fixed BOTTOM TAB BAR. Not a hamburger that hides the navigation
 *         behind a second tap, and not a sidebar that slides over the content —
 *         the destinations are always visible and always within thumb reach.
 *   >= md a persistent sidebar, because the horizontal space now exists.
 *
 * The two are different DOM, switched by `display`, so neither is a compromised
 * version of the other. Every role gets identical chrome; the role is expressed
 * by the nav items and by a stated workspace chip, never by a different layout
 * and never by the URL.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const policy = usePolicy();
  const pathname = useActivePath();

  const items = useMemo<NavItem[]>(() => {
    if (!user) return [];
    return NAV_BY_ROLE[user.role].filter((item) => (item.action ? policy.can(item.action) : true));
  }, [user, policy]);

  const tabs = useMemo(() => primaryNav(items), [items]);

  if (!user) return <>{children}</>;

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <a
        href="#main-content"
        className="skip-link ms-3 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-fg-on-brand shadow-e3"
      >
        Skip to content
      </a>

      <TopBar />

      <div className="flex-1 md:grid md:grid-cols-[var(--shell-sidebar-w)_minmax(0,1fr)]">
        <Sidebar items={items} pathname={pathname} />

        <main
          id="main-content"
          tabIndex={-1}
          className={cn(
            'gutter-safe pt-4 outline-none md:pt-6',
            // Clear the fixed tab bar plus the home indicator. Without this the
            // last row of every list is permanently unreachable on a phone.
            'pb-[calc(var(--shell-tabbar-h)+var(--shell-safe-bottom)+1.5rem)] md:pb-12',
          )}
        >
          <div className="wide">{children}</div>
        </main>
      </div>

      <BottomTabs items={tabs} pathname={pathname} />
    </div>
  );
}

function TopBar() {
  const { user, isDemo } = useSession();
  const policy = usePolicy();
  const navigate = useNavigate();
  const logout = useLogout();

  // `notification:read` is `isSelf` for every role (policy.ts), so it reads
  // `subject.userId`. Asked with no subject it denied everyone and hid the bell.
  const canReadNotifications = user
    ? policy.can('notification:read', subject({ userId: user.id }))
    : false;
  // `notificationsUnread`, not `notifications(true)`: the count is a scalar with
  // its own key, not the unread-filtered LIST. See qk in lib/query.ts.
  const { data: unread } = useQuery({
    queryKey: qk.notificationsUnread,
    queryFn: () => api.get<UnreadCountResponse>('/notifications/unread-count'),
    enabled: canReadNotifications,
    staleTime: 60_000,
  });

  if (!user) return null;

  const unreadCount = unread?.unread ?? 0;

  return (
    <header className="safe-top sticky top-0 z-40 border-b border-line-subtle bg-surface/90 backdrop-blur-md">
      <div className="gutter-safe flex h-[var(--shell-topbar-h)] items-center gap-2">
        <Link
          to="/dashboard"
          className="flex items-center gap-2 rounded-md outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line-focus"
        >
          <span
            aria-hidden="true"
            className="grid size-8 shrink-0 place-items-center rounded-md bg-brand font-display text-sm font-bold text-fg-on-brand"
          >
            SW
          </span>
          {/* `min-w-0 truncate` so the brand name is what gives way when the bar
              runs out of room. It is a single unbreakable word, so without this it
              holds its full intrinsic width and the squeeze lands on the controls
              at the other end instead — at 375px with the "Demo" badge showing,
              that is the notification bell. */}
          <span className="min-w-0 truncate font-display text-base font-semibold tracking-tight">
            {BRAND.name}
          </span>
        </Link>

        {/* The workspace chip states the role in words. It is not a switcher —
            there is nothing to switch to, and pretending otherwise invites the
            user to look for a permission they do not have. */}
        <Badge
          tone={user.role === 'ADMIN' ? 'brand' : 'neutral'}
          variant="soft"
          size="sm"
          className="hidden sm:inline-flex"
        >
          {WORKSPACE_LABEL[user.role]}
        </Badge>

        {isDemo ? (
          <Badge tone="warning" variant="soft" size="sm">
            Demo
          </Badge>
        ) : null}

        <div className="flex-1" />

        {canReadNotifications ? <NotificationBell unreadCount={unreadCount} /> : null}

        <ThemeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Account menu for ${user.name}`}
              className="tap grid shrink-0 place-items-center rounded-full outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line-focus md:size-9 md:min-h-0 md:min-w-0"
            >
              <Avatar name={user.name} src={user.avatarUrl} size="sm" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[15rem]">
            <div className="flex items-center gap-3 px-2.5 py-2">
              <Avatar name={user.name} src={user.avatarUrl} size="md" />
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-semibold">{user.name}</span>
                <span className="truncate text-xs text-fg-tertiary">{user.email}</span>
              </div>
            </div>
            <DropdownMenuLabel>{ROLE_LABEL[user.role]}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              icon={<UserIcon className="size-4" />}
              onSelect={() => void navigate({ to: '/settings' })}
            >
              Profile and settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              destructive
              icon={<LogOut className="size-4" />}
              onSelect={() => {
                logout.mutate(undefined, {
                  onSettled: () => void navigate({ to: '/login' }),
                });
              }}
            >
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

function Sidebar({ items, pathname }: { items: NavItem[]; pathname: string }) {
  const { transitions, reduced } = useMotionKit();

  return (
    <nav
      aria-label="Primary"
      className={cn(
        'hidden md:block',
        'sticky top-[calc(var(--shell-topbar-h)+var(--shell-safe-top))]',
        '[block-size:calc(100dvh-var(--shell-topbar-h)-var(--shell-safe-top))]',
        'scroll-y border-e border-line-subtle bg-surface px-3 py-4',
      )}
    >
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const active = isActive(pathname, item.to);
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                className={cn(
                  'relative flex min-h-10 items-center gap-3 rounded-md px-3 text-sm font-medium',
                  'transition-colors duration-[var(--duration-fast)]',
                  'outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line-focus',
                  active ? 'text-fg-brand' : 'text-fg-secondary hover:bg-hover hover:text-fg',
                )}
              >
                {active ? (
                  <motion.span
                    aria-hidden="true"
                    layoutId={reduced ? undefined : 'sidebar-active'}
                    transition={transitions.fast}
                    className="absolute inset-0 -z-10 rounded-md bg-selected"
                  />
                ) : null}
                <item.icon aria-hidden="true" className="size-[1.125rem] shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function BottomTabs({ items, pathname }: { items: NavItem[]; pathname: string }) {
  const { transitions, reduced } = useMotionKit();

  return (
    <nav
      aria-label="Primary"
      className={cn(
        'safe-bottom fixed inset-x-0 bottom-0 z-40 md:hidden',
        'border-t border-line-subtle bg-surface/95 backdrop-blur-md',
      )}
    >
      <ul className="flex items-stretch">
        {items.map((item) => {
          const active = isActive(pathname, item.to);
          return (
            <li key={item.to} className="flex-1">
              <Link
                to={item.to}
                className={cn(
                  'relative flex min-h-[var(--shell-tabbar-h)] flex-col items-center justify-center gap-1 px-1',
                  'text-2xs font-medium transition-colors duration-[var(--duration-fast)]',
                  'outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-line-focus',
                  active ? 'text-fg-brand' : 'text-fg-tertiary',
                )}
              >
                {active ? (
                  <motion.span
                    aria-hidden="true"
                    layoutId={reduced ? undefined : 'tabbar-active'}
                    transition={transitions.fast}
                    className="absolute inset-x-3 top-0 h-0.5 rounded-b-full bg-brand"
                  />
                ) : null}
                <item.icon aria-hidden="true" className="size-5 shrink-0" />
                <span className="truncate leading-none">{item.shortLabel ?? item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
