import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MoreVertical,
  Pencil,
  Plus,
  Search,
  UserRound,
  UserRoundCheck,
  UserRoundX,
  UsersRound,
} from 'lucide-react';
import { api, type Paginated } from '@/lib/api';
import { qk } from '@/lib/query';
import { subject, usePolicy } from '@/lib/policy';
import { formatRelative } from '@/lib/format';
import type { UserDetail } from '@/lib/types';
import { Gate } from '@/components/Gate';
import { UserBulkImportDialog } from '@/components/users/UserBulkImportDialog';
import { UserCreateDialog } from '@/components/users/UserCreateDialog';
import { UserEditDialog } from '@/components/users/UserEditDialog';
import { PageHeader } from '@/components/layout/PageHeader';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { StatusChip } from '@/components/ui/StatusChip';
import { toast } from '@/components/ui/Toast';
import { ROLE_LABEL } from '@/components/layout/nav';
import { Route } from '@/routes/_app/admin.users';

/**
 * There is no top-level department on a person. `User` has no `departmentId`
 * column (users.service.ts:31-36) — membership hangs off whichever profile the
 * account has, and an ADMIN has neither — so `userDetailSchema` nests it as
 * `teacherProfile.departmentName` / `studentProfile.departmentName`, both nullable
 * (user.ts:30-45, :64-65). The old `entry.departmentName` read a field no endpoint
 * has ever served, which is why this column rendered an em dash for every row.
 */
function departmentNameOf(user: UserDetail): string | null {
  return user.teacherProfile?.departmentName ?? user.studentProfile?.departmentName ?? null;
}

/**
 * The policy Subject for a `user:*` decision, built to match the SERVER's byte for
 * byte: `users.routes.ts:51-53` passes `{ userId: idOf(request) }`.
 *
 * WHY it is not a spread of the row. `isSelf` matches on `Subject.userId` and denies
 * when it is absent rather than defaulting to the actor (combinators.ts:46-49). A
 * user DTO carries `id`, never `userId`, so a spread left `userId` undefined,
 * `isSelf` false and — because `user:suspend` for ADMIN is `not(isSelf)`
 * (policy.ts:312-318) — the check came back TRUE for an admin acting on their own
 * account. The SPA offered "Suspend account" against yourself and the API refused
 * it. The spread also drags `teacherProfile` / `studentProfile` into a Subject that
 * has no such fields.
 */
function userSubject(user: Pick<UserDetail, 'id'>) {
  return subject({ userId: user.id });
}

export function AdminUsersPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const policy = usePolicy();
  const client = useQueryClient();

  const [term, setTerm] = useState(search.q ?? '');
  const [suspending, setSuspending] = useState<UserDetail | null>(null);
  const [creating, setCreating] = useState(false);
  /*
    The cohort import, `hidden md:flex` at its trigger — the desktop-only decision
    and its reason are at the button itself, not here.
  */
  const [importing, setImporting] = useState(false);
  /*
   * The row being edited, held as the WHOLE record rather than an id, because the
   * dialog seeds its form from the row it was handed and the row already carries
   * every field the shared update schema accepts. A second `GET /users/:id` would
   * buy a fresh copy of data this page is already holding, and
   * `user:read` is self-only for non-admins — the one caller that could be harmed
   * by the round trip is the one that would 403 on it.
   */
  const [editing, setEditing] = useState<UserDetail | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if ((search.q ?? '') === term) return;
      void navigate({
        // `q` is OPTIONAL on AdminUsersSearch, so an empty box means the key is
        // ABSENT, not present-and-undefined — `{ ...previous, q: undefined }` is a
        // different type and does not compile under exactOptionalPropertyTypes.
        // Drop the old value by destructuring it away, then spread the new one back
        // in only when there is one. That is the same conditional-spread idiom this
        // route's own `validateSearch` uses to build the object
        // (routes/_app/admin.users.tsx:18-25), so both halves agree on what "no
        // filter" looks like — and it keeps `?q=` out of the URL entirely rather
        // than serialising an empty one.
        search: ({ q: _clearedQ, ...previous }) => ({
          ...previous,
          ...(term ? { q: term } : {}),
          page: 1,
        }),
        replace: true,
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [term, search.q, navigate]);

  const users = useQuery({
    queryKey: qk.users(search),
    queryFn: () =>
      // `GET /users` serves `paginated(userDetailSchema)` (users.routes.ts:75), and
      // deliberately so: the summary is four fields and cannot draw this table.
      api.get<Paginated<UserDetail>>('/users', {
        query: {
          page: search.page,
          limit: 20,
          q: search.q,
          role: search.role,
          status: search.status,
        },
      }),
    placeholderData: (previous) => previous,
  });

  const suspend = useMutation({
    // The route answers 200 with the updated `userDetailSchema` row
    // (users.routes.ts:152); nothing here reads it, but the declared type is the
    // served one so it cannot quietly become a lie.
    mutationFn: (id: string) => api.post<UserDetail>(`/users/${id}/suspend`),
    onSuccess: async () => {
      setSuspending(null);
      toast.success('Account suspended', {
        description: 'Every session for that account has been destroyed.',
      });
      await client.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (error) => toast.fromError(error, 'Could not suspend that account'),
  });

  const reinstate = useMutation({
    // Same contract as suspend above: 200 with the updated detail row. The service is
    // idempotent — reinstating an ACTIVE account returns it unchanged and writes no
    // second audit event — so a double click costs nothing.
    mutationFn: (id: string) => api.post<UserDetail>(`/users/${id}/reinstate`),
    onSuccess: async () => {
      toast.success('Account reinstated', {
        description: 'They can sign in again immediately.',
      });
      await client.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (error) => toast.fromError(error, 'Could not reinstate that account'),
  });

  const isFiltered = Boolean(search.q || search.role || search.status);

  return (
    // `min-h-0 flex-1` so the table below can claim the remaining height —
    // AppShell bounds `main` from `md` up and this is the page half of that contract.
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Users"
        description="One identity table. Role is a column, and suspension destroys sessions immediately."
        actions={
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {/*
              `user:create` is subject-free — every cell is a terminal allow/deny
              decided by role alone (policy.ts:338-347), which is what makes it safe to
              gate an affordance with no target on it. A teacher or student never sees
              the button; the API would refuse them anyway.
            */}
            <Gate action="user:create">
              <Button
                block
                className="sm:w-auto"
                leadingIcon={<Plus aria-hidden="true" className="size-4" />}
                onClick={() => setCreating(true)}
              >
                Add a user
              </Button>
            </Gate>

            {/*
              THE COHORT IMPORT IS A DESKTOP TASK AND SAYS SO, which is what the
              `hidden md:flex` below is. An import is a spreadsheet: a wide grid of
              twenty columns, a file picker, and a results table with row numbers
              beside it. At 375px every one of those becomes a horizontal scroll
              inside a dialog that is already one column wide, and the person
              checking their import against the file is now comparing two things
              neither of which fits.

              Hiding it is not the alternative being rejected. The alternative is
              shipping a phone-shaped import that nobody uses and that fails
              silently — the 44px floor is what a control needs to be TAPPABLE, not
              what it needs to be READABLE, and a table of email addresses is the
              second thing. ADR 0008 makes the phone the baseline and the desktop the
              enhancement; this is the enhancement, and the honest way to say so is a
              class that stops rendering it below `md` with the reason in this
              comment.

              A `hidden` base with a `md:` override styles the SMALL viewport as
              the base, which is the rule the script enforces. The equivalent-looking
              spelling that switches off above a width is a max-width query wearing
              a Tailwind hat, and `scripts/check-mobile-first.ts` refuses every
              member of that family — including the one it names here, which is why
              it is described rather than written out.
            */}
            <Gate action="user:bulk-create">
              <Button
                className="hidden w-auto md:inline-flex"
                variant="secondary"
                leadingIcon={<UsersRound aria-hidden="true" className="size-4" />}
                onClick={() => setImporting(true)}
              >
                Import cohort
              </Button>
            </Gate>
          </div>
        }
      />

      <div className="flex flex-col gap-3 pb-(--space-block) md:flex-row md:items-center">
        <Input
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search by name or email"
          aria-label="Search users"
          leading={<Search aria-hidden="true" className="size-4" />}
          className="md:w-80"
        />
        {isFiltered ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setTerm('');
              void navigate({ search: { page: 1 } });
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      <DataTable
        fillHeight
        items={users.data?.data ?? []}
        loading={users.isPending}
        caption="User accounts"
        getKey={(entry) => entry.id}
        columns={[
          {
            id: 'user',
            header: 'User',
            cell: (entry) => (
              <div className="flex items-center gap-2.5">
                <Avatar name={entry.name} src={entry.avatarUrl} size="sm" />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-medium text-fg">{entry.name}</span>
                  <span className="truncate text-xs text-fg-tertiary">{entry.email}</span>
                </div>
              </div>
            ),
          },
          { id: 'role', header: 'Role', cell: (entry) => ROLE_LABEL[entry.role] },
          {
            id: 'department',
            header: 'Department',
            cell: (entry) => departmentNameOf(entry) ?? '—',
            secondary: true,
          },
          {
            id: 'lastLogin',
            header: 'Last seen',
            cell: (entry) => formatRelative(entry.lastLoginAt),
            secondary: true,
          },
          {
            id: 'status',
            header: 'Status',
            cell: (entry) => <StatusChip status={entry.status} />,
          },
        ]}
        actions={(entry) => (
          <RowMenu
            user={entry}
            onView={() => void navigate({ to: '/users/$id', params: { id: entry.id } })}
            onEdit={() => setEditing(entry)}
            onSuspend={() => setSuspending(entry)}
            onReinstate={() => reinstate.mutate(entry.id)}
          />
        )}
        pagination={
          users.data
            ? {
                page: users.data.meta.page,
                totalPages: users.data.meta.totalPages,
                total: users.data.meta.total,
                limit: users.data.meta.limit,
                onPageChange: (page) =>
                  void navigate({ search: (previous) => ({ ...previous, page }) }),
              }
            : undefined
        }
        renderCard={(entry) => {
          const department = departmentNameOf(entry);
          return (
            <Card className="flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <Avatar name={entry.name} src={entry.avatarUrl} size="md" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{entry.name}</span>
                  <span className="truncate text-xs text-fg-tertiary">{entry.email}</span>
                </div>
                <RowMenu
                  user={entry}
                  onView={() => void navigate({ to: '/users/$id', params: { id: entry.id } })}
                  onEdit={() => setEditing(entry)}
                  onSuspend={() => setSuspending(entry)}
                  onReinstate={() => reinstate.mutate(entry.id)}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="neutral" size="sm">
                  {ROLE_LABEL[entry.role]}
                </Badge>
                <StatusChip status={entry.status} size="sm" />
                {department ? (
                  <span className="text-2xs text-fg-tertiary">{department}</span>
                ) : null}
              </div>
            </Card>
          );
        }}
        empty={
          isFiltered ? (
            <EmptyState
              variant="no-results"
              description="No account matched those filters."
              actionLabel="Clear filters"
              onAction={() => {
                setTerm('');
                void navigate({ search: { page: 1 } });
              }}
            />
          ) : (
            <EmptyState
              variant="empty"
              title="No accounts"
              description="Nothing to administer yet."
            />
          )
        }
      />

      {/*
        Mounted once, toggled by the header button. The create mutation sweeps the
        `users` prefix, so a successful POST re-reads this list and the new row is
        on screen without any local bookkeeping here.
      */}
      <UserCreateDialog open={creating} onOpenChange={setCreating} />

      {/*
        The cohort import. Mounted once like its siblings, and the dry run is its
        own path through the same dialog — an admin who checks a file and comes back
        tomorrow has to re-paste it either way, which is a cost the format has rather
        than the component.
      */}
      <UserBulkImportDialog open={importing} onOpenChange={setImporting} />

      {/*
        The edit surface for `PATCH /users/:id`, which had a route, a policy gate
        and no caller in the SPA at all — an admin could create, suspend and
        reinstate, and could not fix a typo in a name. It is a sibling of the
        create dialog rather than a route, for the same reason: the two share the
        form layout, and a detail screen for a row this list already holds would
        be a second place to draw a person.
      */}
      <UserEditDialog user={editing} onOpenChange={(open) => !open && setEditing(null)} />

      <Dialog open={suspending !== null} onOpenChange={(open) => !open && setSuspending(null)}>
        <DialogContent
          title="Suspend this account?"
          description={
            suspending
              ? `${suspending.name} will be signed out of every device immediately and will not be able to sign back in.`
              : undefined
          }
          footer={
            <>
              <Button
                variant="ghost"
                block
                className="sm:w-auto"
                onClick={() => setSuspending(null)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                block
                className="sm:w-auto"
                loading={suspend.isPending}
                disabled={
                  !policy.can('user:suspend', suspending ? userSubject(suspending) : undefined)
                }
                onClick={() => suspending && suspend.mutate(suspending.id)}
              >
                Suspend account
              </Button>
            </>
          }
        >
          {/*
            This used to say "There is no way to undo this from the app — reinstating
            the account takes a database change." That was true when it was written:
            there was no `user:reinstate` action, no endpoint, and the audit
            extension's REINSTATE branch could never fire. Phase 5 of the UI roadmap
            spent the cost the old comment priced — policy action, matrix rows,
            regenerated docs/permissions.md — so the copy now offers the real undo.
          */}
          <p className="text-fg-secondary">
            You can undo this later with <strong>Reinstate account</strong> in the row's action
            menu. Every session is destroyed now, and both actions are written to the audit log with
            your name against them.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RowMenu({
  user,
  onView,
  onEdit,
  onSuspend,
  onReinstate,
}: {
  user: UserDetail;
  /**
   * Opens `GET /users/:id`.
   *
   * A CALLBACK rather than a `<Link>` in the row, and that is not a style
   * preference. `DataTable` renders a real `<table>` from `md` up and a card list
   * below it, so a link on the name would have to be written twice and would put a
   * router dependency into every cell renderer this table has; the row menu is
   * already the one place each row's actions live, and it renders in both
   * layouts. The page owns the `navigate` and hands it down, which also means the
   * navigation is testable without a mounted router — the reason this table's
   * suite has never needed one.
   */
  onView: () => void;
  onEdit: () => void;
  onSuspend: () => void;
  onReinstate: () => void;
}) {
  const policy = usePolicy();
  const target = userSubject(user);

  const canSuspend = policy.can('user:suspend', target) && user.status !== 'SUSPENDED';
  const canUpdate = policy.can('user:update', target);
  /*
   * `user:reinstate` is subject-free — every cell is a terminal allow/deny decided by
   * role alone (policy.ts), the `user:create` argument — so the bare, no-subject call
   * is a complete gate for an affordance whose row is right here anyway. Asking it per
   * row keeps a suspended account's menu honest without a second subject build.
   */
  const canReinstate = policy.can('user:reinstate') && user.status === 'SUSPENDED';
  /*
   * `user:read` is asked with the row's own subject, not bare. Its ADMIN cell is a
   * bare `allow` but its STUDENT and TEACHER cells are `isSelf` (policy.ts), so a
   * subject-free call would be false for a teacher looking at a colleague — which is
   * the LESSONS-LEARNED #15 trap in its other direction: it would hide the action
   * from the one role that legitimately has it.
   */
  const canView = policy.can('user:read', target);

  // Nothing permitted means no menu at all — an empty menu is worse than none.
  if (!canView && !canSuspend && !canUpdate && !canReinstate) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          aria-label={`Actions for ${user.name}`}
          icon={<MoreVertical className="size-5" />}
          size="sm"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {/*
          FIRST, because it is the only READ-only item in a menu of writes, and an
          admin opening a menu is far more often asking "who is this" than "change
          this".
        */}
        {canView ? (
          <DropdownMenuItem icon={<UserRound className="size-4" />} onSelect={onView}>
            View account
          </DropdownMenuItem>
        ) : null}
        {/*
          This item was rendered with no `onSelect` behind it — a menu entry that
          looked available and did nothing, which is worse than its absence,
          because an admin who chose it had been told the correction was possible
          and then nothing happened. The gate was always right: `user:update` is
          `isSelf` for STUDENT and TEACHER and `allow` for ADMIN (the `targetSubject`
          argument in users.routes.ts), so `canUpdate` is true for exactly the rows
          this dialog can serve — the only thing missing was the handler.
        */}
        {canUpdate ? (
          <DropdownMenuItem icon={<Pencil className="size-4" />} onSelect={onEdit}>
            Edit account
          </DropdownMenuItem>
        ) : null}
        {canSuspend ? (
          <DropdownMenuItem
            destructive
            icon={<UserRoundX className="size-4" />}
            onSelect={onSuspend}
          >
            Suspend account
          </DropdownMenuItem>
        ) : null}
        {canReinstate ? (
          <DropdownMenuItem icon={<UserRoundCheck className="size-4" />} onSelect={onReinstate}>
            Reinstate account
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
