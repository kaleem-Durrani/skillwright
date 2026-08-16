import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreVertical, Search, UserRoundX } from 'lucide-react';
import { api, type Paginated } from '@/lib/api';
import { qk } from '@/lib/query';
import { subject, usePolicy } from '@/lib/policy';
import { formatRelative } from '@/lib/format';
import type { UserDetail } from '@/lib/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DataList } from '@/components/ui/DataList';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Pagination } from '@/components/ui/Pagination';
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

  const isFiltered = Boolean(search.q || search.role || search.status);

  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow="Admin workspace"
        title="Users"
        description="One identity table. Role is a column, and suspension destroys sessions immediately."
      />

      <div className="flex flex-col gap-3 pb-5 md:flex-row md:items-center">
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

      <DataList
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
          {
            id: 'actions',
            header: 'Actions',
            align: 'end',
            cell: (entry) => <RowMenu user={entry} onSuspend={() => setSuspending(entry)} />,
          },
        ]}
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
                <RowMenu user={entry} onSuspend={() => setSuspending(entry)} />
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

      {users.data ? (
        <Pagination
          label="Users pagination"
          page={users.data.meta.page}
          totalPages={users.data.meta.totalPages}
          total={users.data.meta.total}
          limit={users.data.meta.limit}
          onPageChange={(page) => void navigate({ search: (previous) => ({ ...previous, page }) })}
        />
      ) : null}

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
          <p className="text-fg-secondary">
            This is reversible — an administrator can reinstate the account later. The action is
            written to the audit log with your name against it.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RowMenu({ user, onSuspend }: { user: UserDetail; onSuspend: () => void }) {
  const policy = usePolicy();
  const target = userSubject(user);

  const canSuspend = policy.can('user:suspend', target) && user.status !== 'SUSPENDED';
  const canUpdate = policy.can('user:update', target);

  // Nothing permitted means no menu at all — an empty menu is worse than none.
  if (!canSuspend && !canUpdate) return null;

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
        {canUpdate ? <DropdownMenuItem>Edit account</DropdownMenuItem> : null}
        {canSuspend ? (
          <DropdownMenuItem
            destructive
            icon={<UserRoundX className="size-4" />}
            onSelect={onSuspend}
          >
            Suspend account
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
