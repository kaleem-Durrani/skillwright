import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import { phoneSchema, type UpdateUserInput, type UserDetail } from '@skillwright/shared/schema';
import { api } from '@/lib/api';
import { qk } from '@/lib/query';
import { subject, usePolicy } from '@/lib/policy';
import { ApiError } from '@/lib/problem';
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

/**
 * `GET /users/me` is the only endpoint that serves `phoneNumber` and `bio`
 * (userDetailSchema, user.ts:52-66). `qk` has no entry for it, so the key borrows
 * the `users` namespace it belongs to: it still starts with 'users', which keeps it
 * inside the one invalidation prefix the rest of the app already sweeps.
 */
const profileKey = qk.users({ scope: 'me' });

/**
 * The FORM's shape, which is deliberately NOT the wire shape.
 *
 * Every control here is a text input, so an untouched or emptied field is `''` —
 * never `null`, never `undefined`. The wire shape is `UpdateUserInput`
 * (user.ts:70-81) and `toUpdate` below is the only place the two meet.
 *
 * `phoneNumber` is checked against the SHARED `phoneSchema` (common.ts:60-63)
 * rather than a regex copied out of it, so the client refuses exactly what the API
 * refuses — with `''` allowed, because on this side an empty box is how a person
 * says "I have no phone number".
 */
const profileFormSchema = z.object({
  name: z.string().trim().min(2, 'Enter your full name').max(120),
  phoneNumber: z
    .string()
    .trim()
    .refine((value) => value === '' || phoneSchema.safeParse(value).success, {
      message: 'Enter a valid phone number.',
    }),
  bio: z.string().trim().max(600, 'Keep it under 600 characters'),
});

type ProfileValues = z.infer<typeof profileFormSchema>;

/** What react-hook-form reports as touched-and-changed, for a flat string form. */
type DirtyProfileFields = { readonly [K in keyof ProfileValues]?: boolean };

const PROFILE_FIELDS = ['name', 'phoneNumber', 'bio'] as const;

/**
 * Server field errors arrive as dot-joined zod paths (errors.plugin.ts:13-18) and
 * include `(root)` for whole-body refinements. Only the three that name a control
 * may be handed to `setError`; the rest belong in the toast.
 */
function isProfileField(path: string): path is keyof ProfileValues {
  return (PROFILE_FIELDS as readonly string[]).includes(path);
}

/** The served record, flattened into the three controls this form owns. */
function toFormValues(profile: UserDetail): ProfileValues {
  return {
    name: profile.name,
    phoneNumber: profile.phoneNumber ?? '',
    bio: profile.bio ?? '',
  };
}

/**
 * The PATCH body: only what the user actually changed, and never an empty string.
 *
 * THIS IS THE 422. `updateUserSchema.phoneNumber` is `phoneSchema.nullable()`
 * (user.ts:73) and phoneSchema refuses `''` (common.ts:60-63), so a form that
 * PATCHed its seeded `{ phoneNumber: '', bio: '' }` was answered 422 by the
 * validator BEFORE the policy preHandler ever ran — every "Save changes", for
 * every role, including one that only edited the name. users.routes.ts:99-110
 * documents that failure from the server side and declines to loosen the shared
 * schema for it, because `''` would then be a stored empty phone number for every
 * other client. So `''` becomes `null` ("clear this field"), and a field the user
 * never touched is OMITTED — saving a name can never blank a phone number.
 *
 * The result is never `{}`: `updateUserSchema` refines that away (user.ts:78-80),
 * which is why Save stays disabled until something is dirty.
 */
function toUpdate(values: ProfileValues, dirty: DirtyProfileFields): UpdateUserInput {
  return {
    ...(dirty.name ? { name: values.name } : {}),
    ...(dirty.phoneNumber
      ? { phoneNumber: values.phoneNumber === '' ? null : values.phoneNumber }
      : {}),
    ...(dirty.bio ? { bio: values.bio === '' ? null : values.bio } : {}),
  };
}

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
          {/*
            `user:update` is `isSelf` for STUDENT and TEACHER (policy.ts:306-311), and
            `isSelf` reads `Subject.userId` and DENIES when it is absent rather than
            defaulting to the actor (combinators.ts:46-49). The subject-free call that
            used to be here therefore came back false for every student and teacher on
            their OWN settings page, disabling every field and the Save button; only an
            admin, whose cell is a bare `allow`, could edit anything.

            The subject exists — `user` is non-null past the guard above — and it is the
            same one the server builds for PATCH /users/me (`selfSubject`,
            users.routes.ts:34-36), so the two answers cannot disagree.
          */}
          <ProfileTab
            canEdit={policy.can('user:update', subject({ userId: user.id }))}
            isDemo={isDemo}
          />
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

  /**
   * No `enabled:` gate on this query, on purpose.
   *
   * `user:read` is `isSelf` for STUDENT and TEACHER (policy.ts:297-305), and a
   * subject-free `can()` runs it against EMPTY_SUBJECT, where `isSelf` is false
   * (combinators.ts:46-49). Gating on that would disable the query for everyone but
   * an admin, and a disabled query never leaves `status: 'pending'` — the form would
   * sit empty forever. The route is scoped to the caller by construction
   * (users.routes.ts:89-96), so the query just runs.
   */
  const profile = useQuery({
    queryKey: profileKey,
    queryFn: () => api.get<UserDetail>('/users/me'),
    staleTime: 60_000,
  });

  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: { name: user?.name ?? '', phoneNumber: '', bio: '' },
  });
  const { reset } = form;

  /**
   * Seed the controls from the record the server actually holds.
   *
   * `SessionUser` (session.ts:55-64) carries neither `phoneNumber` nor `bio` — it is
   * the session view model, not the profile — which is why this form used to open
   * with two blanks and then PATCH them straight back over saved values.
   * `keepDirtyValues` means a refetch landing mid-edit refreshes the fields the user
   * is not typing in and leaves the ones they are.
   */
  useEffect(() => {
    if (!profile.data) return;
    reset(toFormValues(profile.data), { keepDirtyValues: true });
  }, [profile.data, reset]);

  const save = useMutation({
    // The route answers 200 with the updated `userDetailSchema` row
    // (users.routes.ts:111-118). Typing it `void` threw that away and let the
    // declared type drift from the served one; the response re-seeds both the cache
    // and the form, so what is on screen after a save is what the server stored.
    mutationFn: (body: UpdateUserInput) => api.patch<UserDetail>('/users/me', body),
    onSuccess: async (updated) => {
      client.setQueryData(profileKey, updated);
      // A reset with no `keepDirtyValues` clears the dirty flags, which is what
      // disables Save again until the next real edit.
      reset(toFormValues(updated));
      toast.success('Profile saved');
      // The chrome renders `user.name` from the session, not from this record.
      await client.invalidateQueries({ queryKey: qk.session });
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        for (const [path, message] of Object.entries(error.byField)) {
          if (isProfileField(path)) form.setError(path, { message });
        }
      }
      toast.fromError(error, 'Could not save your profile');
    },
  });

  if (!user) return null;

  const fieldsDisabled = !canEdit || profile.isPending;
  // Read DURING RENDER on purpose: `formState` is a proxy, and a key nobody reads
  // while rendering is neither tracked nor re-rendered on. `dirtyFields` decides
  // what the PATCH carries, so it has to be subscribed, not sampled in a callback.
  const { dirtyFields, isDirty } = form.formState;

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

        {profile.isError ? (
          <p className="rounded-md border border-danger-line bg-danger-soft px-3 py-2 text-xs text-danger-fg">
            We could not load your saved details. Anything you type here will still be saved.
          </p>
        ) : null}

        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={form.handleSubmit((values) => {
            const body = toUpdate(values, dirtyFields);
            // `updateUserSchema` refuses an empty body (user.ts:78-80). Save is
            // already disabled until something is dirty; this is the second lock.
            if (Object.keys(body).length === 0) return;
            save.mutate(body);
          })}
        >
          <FormField label="Full name" required error={form.formState.errors.name?.message}>
            <Input autoComplete="name" disabled={fieldsDisabled} {...form.register('name')} />
          </FormField>

          <FormField
            label="Phone number"
            hint="Used only for course-related contact. Clear it to remove the number we hold."
            error={form.formState.errors.phoneNumber?.message}
          >
            <Input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              disabled={fieldsDisabled}
              {...form.register('phoneNumber')}
            />
          </FormField>

          <FormField label="Bio" error={form.formState.errors.bio?.message}>
            <Textarea autoResize disabled={fieldsDisabled} rows={3} {...form.register('bio')} />
          </FormField>

          <Button
            type="submit"
            block
            className="sm:w-auto sm:self-start"
            loading={save.isPending}
            disabled={fieldsDisabled || !isDirty}
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
