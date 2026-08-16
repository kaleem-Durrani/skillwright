import { useNavigate } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import { api } from '@/lib/api';
import { qk } from '@/lib/query';
import { usePolicy } from '@/lib/policy';
import { useLogout, useSession } from '@/lib/session';
import { PageHeader } from '@/components/layout/PageHeader';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { FormField } from '@/components/ui/FormField';
import { Input } from '@/components/ui/Input';
import { Separator } from '@/components/ui/Separator';
import { StatusChip } from '@/components/ui/StatusChip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { Textarea } from '@/components/ui/Textarea';
import { toast } from '@/components/ui/Toast';
import { ROLE_LABEL } from '@/components/layout/nav';
import { Route } from '@/routes/_app/settings';

const profileSchema = z.object({
  name: z.string().min(2, 'Enter your full name').max(120),
  phoneNumber: z.string().max(32).optional(),
  bio: z.string().max(600, 'Keep it under 600 characters').optional(),
});

type ProfileValues = z.infer<typeof profileSchema>;

export function SettingsPage() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { user, isDemo } = useSession();
  const policy = usePolicy();

  if (!user) return null;

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Settings"
        description="Your profile, your credentials, and what we are allowed to email you about."
      />

      <Tabs
        value={tab ?? 'profile'}
        onValueChange={(value) =>
          void navigate({ search: { tab: value as 'profile' | 'security' | 'notifications' } })
        }
      >
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <ProfileTab canEdit={policy.can('user:update')} isDemo={isDemo} />
        </TabsContent>

        <TabsContent value="security">
          <SecurityTab />
        </TabsContent>

        <TabsContent value="notifications">
          <NotificationsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProfileTab({ canEdit, isDemo }: { canEdit: boolean; isDemo: boolean }) {
  const { user } = useSession();
  const client = useQueryClient();

  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: user?.name ?? '', phoneNumber: '', bio: '' },
  });

  const save = useMutation({
    mutationFn: (values: ProfileValues) => api.patch<void>('/users/me', values),
    onSuccess: async () => {
      toast.success('Profile saved');
      await client.invalidateQueries({ queryKey: qk.session });
    },
    onError: (error) => toast.fromError(error, 'Could not save your profile'),
  });

  if (!user) return null;

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex items-center gap-4">
        <Avatar name={user.name} src={user.avatarUrl} size="xl" />
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate font-display text-lg font-semibold">{user.name}</span>
          <span className="truncate text-sm text-fg-tertiary">{user.email}</span>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Badge tone="brand" variant="soft" size="sm">
              {ROLE_LABEL[user.role]}
            </Badge>
            <StatusChip status={user.status} size="sm" />
          </div>
        </div>
      </Card>

      <Card className="flex flex-col gap-4">
        <CardTitle>Personal details</CardTitle>

        {isDemo ? (
          <p className="rounded-md border border-warning-line bg-warning-soft px-3 py-2 text-xs text-warning-fg">
            Demo accounts can change these details, but they reset when the demo session ends.
          </p>
        ) : null}

        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={form.handleSubmit((values) => save.mutate(values))}
        >
          <FormField label="Full name" required error={form.formState.errors.name?.message}>
            <Input autoComplete="name" disabled={!canEdit} {...form.register('name')} />
          </FormField>

          <FormField
            label="Phone number"
            hint="Used only for course-related contact."
            error={form.formState.errors.phoneNumber?.message}
          >
            <Input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              disabled={!canEdit}
              {...form.register('phoneNumber')}
            />
          </FormField>

          <FormField label="Bio" error={form.formState.errors.bio?.message}>
            <Textarea autoResize disabled={!canEdit} rows={3} {...form.register('bio')} />
          </FormField>

          <Button
            type="submit"
            block
            className="sm:w-auto sm:self-start"
            loading={save.isPending}
            disabled={!canEdit}
          >
            Save changes
          </Button>
        </form>
      </Card>
    </div>
  );
}

function SecurityTab() {
  const { user } = useSession();
  const policy = usePolicy();
  const logout = useLogout();
  const navigate = useNavigate();

  /**
   * Matches `mfaEnrollResponseSchema` in @skillwright/shared. Note `otpauthUri`
   * (not `Url`) and that recovery codes are NOT returned here — they come back
   * from `POST /auth/mfa/activate` once a code has actually been proved.
   *
   * TODO(mfa-ui): the response is discarded. Finishing this screen means
   * rendering `qrDataUrl`, offering `secret` for manual entry, then posting the
   * typed code to /auth/mfa/activate and displaying the recovery codes once.
   */
  const enroll = useMutation({
    mutationFn: () =>
      api.post<{ secret: string; otpauthUri: string; qrDataUrl: string }>('/auth/mfa/enroll'),
    onSuccess: () => toast.info('Scan the code in your authenticator app, then confirm one code.'),
    onError: (error) => toast.fromError(error, 'Could not start enrolment'),
  });

  if (!user) return null;

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <span
            className={
              user.totpEnabled
                ? 'grid size-10 shrink-0 place-items-center rounded-md bg-success-soft text-success-fg'
                : 'grid size-10 shrink-0 place-items-center rounded-md bg-neutral-soft text-neutral-fg'
            }
          >
            {user.totpEnabled ? (
              <ShieldCheck aria-hidden="true" className="size-5" />
            ) : (
              <ShieldOff aria-hidden="true" className="size-5" />
            )}
          </span>
          <div className="flex flex-col gap-1">
            <CardTitle className="text-base">Two-factor authentication</CardTitle>
            <p className="text-sm text-fg-secondary">
              {user.totpEnabled
                ? 'Enabled. You will be asked for a 6-digit code at every sign-in.'
                : 'Off. Turning it on means a stolen password alone is not enough.'}
            </p>
          </div>
        </div>

        {user.totpEnabled ? (
          policy.can('mfa:disable') ? (
            <Button variant="danger" block className="sm:w-auto sm:self-start">
              Turn off two-factor
            </Button>
          ) : (
            <p className="text-xs text-fg-tertiary">
              Demo sessions cannot change two-factor settings.
            </p>
          )
        ) : policy.can('mfa:enroll') ? (
          <Button
            block
            className="sm:w-auto sm:self-start"
            loading={enroll.isPending}
            onClick={() => enroll.mutate()}
          >
            Set up two-factor
          </Button>
        ) : null}
      </Card>

      <Card className="flex flex-col gap-4">
        <CardTitle>Password</CardTitle>
        <p className="text-sm text-fg-secondary">
          Changing your password signs out every other session immediately.
        </p>
        <Button variant="secondary" block className="sm:w-auto sm:self-start">
          Change password
        </Button>
      </Card>

      <Separator />

      <Card className="flex flex-col gap-4">
        <CardTitle>Sessions</CardTitle>
        <p className="text-sm text-fg-secondary">
          Sign out everywhere if you have used a shared workshop machine.
        </p>
        <Button
          variant="danger"
          block
          className="sm:w-auto sm:self-start"
          loading={logout.isPending}
          onClick={() =>
            logout.mutate(undefined, { onSettled: () => void navigate({ to: '/login' }) })
          }
        >
          Sign out
        </Button>
      </Card>
    </div>
  );
}

function NotificationsTab() {
  return (
    <Card className="flex flex-col gap-4">
      <CardTitle>Email notifications</CardTitle>
      <p className="text-sm text-fg-secondary">
        In-app notifications are always on. These control what also reaches your inbox.
      </p>
      <div className="flex flex-col divide-y divide-line-subtle">
        <Checkbox
          defaultChecked
          label="Enrolment decisions"
          hint="When a request of yours is approved or rejected."
        />
        <Checkbox
          defaultChecked
          label="New resources"
          hint="When a teacher publishes something on a course you are enrolled in."
        />
        <Checkbox label="Announcements" hint="News and events posted by the institution." />
        <Checkbox label="Direct messages" hint="When someone messages you." />
      </div>
      <Button block className="sm:w-auto sm:self-start">
        Save preferences
      </Button>
    </Card>
  );
}
