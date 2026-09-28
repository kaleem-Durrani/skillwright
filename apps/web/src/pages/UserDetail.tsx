import { useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Pencil } from 'lucide-react';
import { api } from '@/lib/api';
import { qk } from '@/lib/query';
import { subject, usePolicy } from '@/lib/policy';
import { formatDate, formatRelative } from '@/lib/format';
import { ApiError, ERROR_COPY } from '@/lib/problem';
import type { UserDetail as UserDetailDto } from '@/lib/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { ROLE_LABEL } from '@/components/layout/nav';
import { UserEditDialog } from '@/components/users/UserEditDialog';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusChip } from '@/components/ui/StatusChip';
// `Route.id`, not a hand-typed path — route ids carry their layout prefix
// ('/_app/users/$id'), and guessing them is a compile error rather than a guess.
import { Route as userDetailRoute } from '@/routes/_app/users.$id';

/**
 * `GET /users/:id` — a full account record behind a gate that is `isSelf` for a
 * student and a teacher and `allow` for an admin (policy.ts, `user:read`).
 *
 * WHY THE EDIT BUTTON IS THE DIALOG AND NOT A ROUTE. `AdminUsers.tsx` argues that
 * the edit surface is deliberately a dialog, "rather than a route", because a
 * detail screen for a row that list already holds "would be a second place to draw
 * a person". That argument is about DRAWING a person for the sake of CHANGING one,
 * and it still holds here: this page reuses `UserEditDialog` unchanged, so there
 * is one form and one `updateUserSchema` in the app. What this page adds is the
 * thing the dialog cannot: a read-only record with a permanent address, reachable
 * from a link in a table, from a roster, from search, and from a person's own
 * address bar.
 */
export function UserDetailPage() {
  const { id } = useParams({ from: userDetailRoute.id });
  const policy = usePolicy();
  const [editing, setEditing] = useState(false);

  /*
   * The subject is the TARGET, not the caller, and it is built from the URL rather
   * than from the row — `users.routes.ts`'s `targetSubject` passes
   * `{ userId: idOf(request) }` and nothing else, because every `user:*` rule reads
   * `Subject.userId` and no other field. The id is in the URL before the response
   * exists, so this gate needs no fetched data: a student who types somebody
   * else's id is denied here without a request being configured, and an admin is
   * allowed without one.
   *
   * The key is `userId`, never the row's own `id`. `isSelf` denies on an absent
   * `userId` rather than defaulting to the actor, so a spread of the DTO would
   * leave the field undefined, the rule false, and the button hidden for the one
   * person it exists for — AdminUsers.tsx records having shipped exactly that.
   */
  const target = subject({ userId: id });
  const allowed = policy.can('user:read', target);
  /*
   * `user:list` is subject-free — every cell is a terminal allow/deny decided by
   * role alone — so the bare, no-subject call is a complete gate here, the same
   * argument `RowMenu` makes for `user:reinstate`. It answers one question only:
   * is there somewhere to go BACK to, which `/admin/users` is for an admin and is
   * not for a student reading their own record.
   */
  const canList = policy.can('user:list');

  const user = useQuery({
    queryKey: qk.user(id),
    queryFn: () => api.get<UserDetailDto>(`/users/${id}`),
    enabled: allowed,
  });

  /*
   * The refusal is rendered rather than left to a spinner, and the difference is
   * which one the viewer is looking at. `enabled: false` holds the query at
   * `status: 'pending'` in React Query v5 (LESSONS-LEARNED #15), so without this
   * branch a student who opened a colleague's link would watch a skeleton for as
   * long as they waited — which reads as a broken app rather than as a policy. The
   * copy is the `ERROR_COPY` entry for `FORBIDDEN` — the same table
   * `ApiError.userMessage` reads — keyed by `problem.code` and never by
   * `problem.detail`: the server's detail here names the rule
   * (`STUDENT:isSelf`), which is a diagnostic and not something to put in front
   * of somebody.
   */
  if (!allowed) {
    return (
      <EmptyState
        variant="error"
        icon={<Avatar name="?" src={null} size="lg" />}
        title="Not available to you"
        description={`${ERROR_COPY.FORBIDDEN} Someone else's account details are only visible to an administrator — and to the person themselves.`}
        action={
          canList ? (
            <Button asChild variant="secondary">
              <Link to="/admin/users" search={{ page: 1 }}>
                Back to accounts
              </Link>
            </Button>
          ) : (
            <Button asChild variant="secondary">
              <Link to="/settings">
                <ArrowLeft aria-hidden="true" className="size-4" />
                Back to settings
              </Link>
            </Button>
          )
        }
      />
    );
  }

  if (user.isPending || user.isError) {
    const denied = user.error instanceof ApiError && user.error.status === 403;
    return (
      <EmptyState
        variant="error"
        description={
          denied
            ? 'Someone else’s account details are only visible to an administrator — and to the person themselves.'
            : 'This account could not be loaded. Nothing you did caused this.'
        }
        actionLabel={denied ? undefined : 'Try again'}
        onAction={denied ? undefined : () => void user.refetch()}
      />
    );
  }

  const entry = user.data;
  const profile = entry.teacherProfile ?? entry.studentProfile;

  /*
   * The link back is a Link to a route that EXISTS only for an admin. A student
   * who is allowed here is looking at their own account, and `/admin/users` is
   * behind a route guard they would be bounced off — so the back control is only
   * rendered for somebody who can actually use it, rather than shown disabled,
   * which is the same rule the row menu follows ("nothing permitted means no menu
   * at all" — AdminUsers.tsx).
   */
  const canAdminister = policy.can('user:list');

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow={
          canAdminister ? (
            <Button asChild variant="ghost" size="sm" className="-ms-2">
              <Link to="/admin/users" search={{ page: 1 }}>
                <ArrowLeft aria-hidden="true" className="size-4" />
                Accounts
              </Link>
            </Button>
          ) : undefined
        }
        title={entry.name}
        description={entry.email}
        actions={
          policy.can('user:update', target) ? (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil aria-hidden="true" className="size-4" />
              Edit account
            </Button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_18rem]">
        <Card className="flex items-start gap-4">
          <Avatar name={entry.name} src={entry.avatarUrl} size="xl" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral">{ROLE_LABEL[entry.role]}</Badge>
              <StatusChip status={entry.status} />
            </div>
            {entry.bio ? <p className="text-sm text-fg-secondary">{entry.bio}</p> : null}
          </div>
        </Card>

        <Card variant="sunken" className="flex flex-col gap-3">
          <CardTitle className="text-base">Account</CardTitle>
          <dl className="flex flex-col gap-2.5 text-sm">
            <Row label="Email" value={entry.email} />
            <Row label="Phone" value={entry.phoneNumber ?? 'Not given'} />
            <Row label="Two-factor" value={entry.mfaEnabled ? 'Turned on' : 'Not turned on'} />
            <Row label="Last seen" value={formatRelative(entry.lastLoginAt)} />
            <Row label="Joined" value={formatDate(entry.createdAt)} />
          </dl>
        </Card>
      </div>

      {/*
        DEPARTMENT AND PROFILE, from whichever profile the role has.
        `User` carries no top-level `departmentId` (users.service.ts), so there is
        nothing to render for an ADMIN and saying "No department" for one would
        imply a gap in the record rather than in the model. The section is simply
        absent, which is the honest answer.
      */}
      {profile ? (
        <Card className="flex flex-col gap-3">
          <CardTitle className="text-base">
            {entry.teacherProfile ? 'Teaching profile' : 'Student profile'}
          </CardTitle>
          <dl className="grid grid-cols-1 gap-2.5 text-sm sm:grid-cols-2">
            <Row label="Department" value={profile.departmentName} />
            {entry.teacherProfile ? (
              <>
                <Row label="Qualification" value={entry.teacherProfile.qualification} />
                <Row label="Specialization" value={entry.teacherProfile.specialization ?? '—'} />
                <Row label="Staff number" value={entry.teacherProfile.staffNo ?? '—'} />
              </>
            ) : (
              <>
                <Row label="Enrolment number" value={entry.studentProfile?.enrollmentNo ?? '—'} />
                <Row label="Enrolled on" value={formatDate(entry.studentProfile?.enrolledOn)} />
              </>
            )}
          </dl>
        </Card>
      ) : null}

      {/*
        No audit trail, no session list, no enrolment history, and no
        "last modified" line. `userDetailSchema` (user.ts:52-66) carries fourteen
        fields and this page renders every one of them; the omission is deliberate
        rather than an oversight. An `AuditEvent` row is a before/after snapshot of
        whatever was written, so a "recent activity" card here would be a second
        surface for data `user:read` does not entitle anybody to — and
        `createdAt` is when the account was JOINED, not when a row was last
        edited, so labelling it "last change" would be a lie about a column whose
        name is not in dispute. `GET /users/:id` is the whole contract, and an
        admin's view is not allowed to become quietly wider than it.
      */}

      <UserEditDialog
        user={editing ? entry : null}
        onOpenChange={(open) => !open && setEditing(false)}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-2xs font-medium tracking-wide text-fg-tertiary uppercase">{label}</dt>
      <dd className="truncate text-fg">{value}</dd>
    </div>
  );
}
