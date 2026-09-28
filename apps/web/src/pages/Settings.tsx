import { useEffect, useState } from 'react';
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
import { AvatarPicker } from '@/components/settings/AvatarPicker';
import { OtpInput } from '@/components/auth/OtpInput';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
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
  /*
   * Phase 4b's profile columns. Their constraints are mirrored here rather than
   * imported because `updateUserSchema` declares them inline (user.ts:87-93) and —
   * being `.partial().refine()`d, a ZodEffects — offers no `.shape` to reach them
   * through; only `phoneSchema` above is exported to reuse. An empty box means "not
   * provided"; what may and may not be CLEARED is decided where nullability is law,
   * in `toUpdate`.
   */
  qualification: z
    .string()
    .trim()
    .refine((value) => value === '' || (value.length >= 2 && value.length <= 200), {
      message: 'Enter between 2 and 200 characters.',
    }),
  specialization: z.string().trim().max(200, 'Keep it under 200 characters'),
  staffNo: z.string().trim().max(40, 'Keep it under 40 characters'),
  enrollmentNo: z.string().trim().max(40, 'Keep it under 40 characters'),
});

type ProfileValues = z.infer<typeof profileFormSchema>;

/** What react-hook-form reports as touched-and-changed, for a flat string form. */
type DirtyProfileFields = { readonly [K in keyof ProfileValues]?: boolean };

const PROFILE_FIELDS = [
  'name',
  'phoneNumber',
  'bio',
  'qualification',
  'specialization',
  'staffNo',
  'enrollmentNo',
] as const;

/**
 * Server field errors arrive as dot-joined zod paths (errors.plugin.ts:13-18) and
 * include `(root)` for whole-body refinements. Only the ones naming a control may
 * be handed to `setError`; the rest belong in the toast.
 */
function isProfileField(path: string): path is keyof ProfileValues {
  return (PROFILE_FIELDS as readonly string[]).includes(path);
}

/** The served record, flattened into the controls this form owns. */
function toFormValues(profile: UserDetail): ProfileValues {
  return {
    name: profile.name,
    phoneNumber: profile.phoneNumber ?? '',
    bio: profile.bio ?? '',
    // The role-appropriate satellite carries these; an account without one (a
    // legacy row predating provisioning) shows blanks, which `ProfileTab` says
    // out loud rather than leaving unexplained.
    qualification: profile.teacherProfile?.qualification ?? '',
    specialization: profile.teacherProfile?.specialization ?? '',
    staffNo: profile.teacherProfile?.staffNo ?? '',
    enrollmentNo: profile.studentProfile?.enrollmentNo ?? '',
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
    /*
     * The profile columns (Phase 4b). `specialization` and `staffNo` are nullable on
     * the schema, so an emptied box becomes `null` — the phone-number translation.
     * `qualification` and `enrollmentNo` are NOT NULL with no null representation
     * (user.ts:87-93), so '' cannot be SENT; a changed-and-non-empty value goes as
     * is, and a changed-and-emptied one is refused by the submit handler below
     * rather than silently kept here.
     */
    ...(dirty.qualification && values.qualification.trim() !== ''
      ? { qualification: values.qualification.trim() }
      : {}),
    ...(dirty.specialization
      ? { specialization: values.specialization === '' ? null : values.specialization.trim() }
      : {}),
    ...(dirty.staffNo ? { staffNo: values.staffNo === '' ? null : values.staffNo.trim() } : {}),
    ...(dirty.enrollmentNo && values.enrollmentNo.trim() !== ''
      ? { enrollmentNo: values.enrollmentNo.trim() }
      : {}),
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
      <PageHeader title="Settings" description="Your profile and your credentials." />

      <Tabs
        value={tab ?? 'profile'}
        onValueChange={(value) =>
          void navigate({ search: { tab: value as 'profile' | 'security' } })
        }
      >
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
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
    // Blanks until /me lands and `reset` seeds from it — including the profile
    // columns, so a resolver pass never meets an `undefined`.
    defaultValues: {
      name: user?.name ?? '',
      phoneNumber: '',
      bio: '',
      qualification: '',
      specialization: '',
      staffNo: '',
      enrollmentNo: '',
    },
  });
  const { reset, setError } = form;

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
          if (isProfileField(path)) setError(path, { message });
        }
        /*
         * A duplicate enrolment number is a P2002 → 409 naming no field
         * (errors.plugin.ts:74-78), and PATCH /me has exactly one unique column in
         * play. The other student-reachable 409 — no profile row to update
         * (users.service.applyProfileUpdate) — names itself in the detail, and no
         * form field can fix it, so it stays with the toast.
         */
        if (
          error.code === 'CONFLICT' &&
          user?.role === 'STUDENT' &&
          /unique|already/i.test(error.message)
        ) {
          setError('enrollmentNo', { message: 'That enrolment number is already in use.' });
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

      {/*
        Rendered only once `/me` is loaded, because what it shows IS that record's
        avatar. Its cache writes go through `onSaved` rather than the picker naming
        `profileKey` itself — one owner for the `/me` key, and no second cache path.
      */}
      {profile.data ? (
        <AvatarPicker
          profile={profile.data}
          disabled={!canEdit}
          onSaved={async (updated) => {
            client.setQueryData(profileKey, updated);
            // The chrome renders the avatar from the session envelope, not from this
            // record — the same sweep the profile save below performs, for the same reason.
            await client.invalidateQueries({ queryKey: qk.session });
          }}
        />
      ) : null}

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
            /*
             * `qualification` and `enrollmentNo` are NOT NULL on their tables and
             * their PATCH fields accept neither '' nor null (user.ts:87-93), so
             * clearing one cannot be expressed on the wire. Refuse it here rather
             * than let `toUpdate` silently keep the old value.
             */
            let blocked = false;
            if (dirtyFields.qualification && values.qualification === '') {
              setError('qualification', {
                message: 'Enter your qualification — it cannot be cleared.',
              });
              blocked = true;
            }
            if (dirtyFields.enrollmentNo && values.enrollmentNo === '') {
              setError('enrollmentNo', {
                message: 'Enter your enrolment number — it cannot be cleared.',
              });
              blocked = true;
            }
            if (blocked) return;

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

          {/*
            Phase 4b's editable profile columns. WHICH of them exist is decided by
            the VIEWER's role — the same pairing the server enforces with a
            field-level 422 (PROFILE_FIELD_ROLES, users.service.ts) — so a teacher is
            never offered an enrolment number and a student never sees a
            qualification box. An ADMIN has neither satellite and gets neither.
            They ride the SAME form and the SAME save: one PATCH carrying whatever
            the person actually changed.
          */}
          {user.role === 'TEACHER' ? (
            <>
              <Separator />
              <CardTitle className="text-base">Teaching details</CardTitle>

              {profile.data && profile.data.teacherProfile === null ? (
                <p className="rounded-md border border-warning-line bg-warning-soft px-3 py-2 text-xs text-warning-fg">
                  Your account has no teaching record yet, so these details are blank and cannot be
                  saved until an administrator creates one.
                </p>
              ) : null}

              <FormField
                label="Qualification"
                required
                hint="Your teaching qualification, e.g. City & Guilds Level 3 Welding."
                error={form.formState.errors.qualification?.message}
              >
                <Input disabled={fieldsDisabled} {...form.register('qualification')} />
              </FormField>

              <FormField
                label="Specialization"
                hint="Optional — your trade or subject area."
                error={form.formState.errors.specialization?.message}
              >
                <Input disabled={fieldsDisabled} {...form.register('specialization')} />
              </FormField>

              <FormField
                label="Staff number"
                hint="Optional."
                error={form.formState.errors.staffNo?.message}
              >
                <Input disabled={fieldsDisabled} {...form.register('staffNo')} />
              </FormField>
            </>
          ) : null}

          {user.role === 'STUDENT' ? (
            <>
              <Separator />
              <CardTitle className="text-base">Student details</CardTitle>

              {profile.data && profile.data.studentProfile === null ? (
                <p className="rounded-md border border-warning-line bg-warning-soft px-3 py-2 text-xs text-warning-fg">
                  Your account has no student record yet, so these details are blank and cannot be
                  saved until an administrator creates one.
                </p>
              ) : null}

              <FormField
                label="Enrolment number"
                required
                hint="Identifies you on course registers. It cannot be cleared once set."
                error={form.formState.errors.enrollmentNo?.message}
              >
                <Input disabled={fieldsDisabled} {...form.register('enrollmentNo')} />
              </FormField>
            </>
          ) : null}

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
  const { user, isDemo } = useSession();
  const policy = usePolicy();
  const client = useQueryClient();
  const logout = useLogout();
  // No `navigate` here any more. The Sign out button below used to hand a
  // per-call `onSettled` to `logout.mutate()`, and that handler rode the
  // mutation's observer — which this screen unsubscribes from the moment the
  // session goes null and it renders nothing (Settings.tsx:169). `useLogout`
  // navigates itself now, from the mutation's own `onSettled`.

  /*
   * The enrolment flow, end to end (Phase 5 of the UI roadmap deleted TODO(mfa-ui)):
   *
   *   idle --"Set up two-factor"--> enrolment --6-digit code--> enabled
   *
   * `enrolment` holds the POST /auth/mfa/enroll response — the QR the user scans and
   * the base32 secret they may type instead — until a proved code promotes the
   * account. `activate` then returns the recovery codes, which NO endpoint can read
   * back, so they are held in component state and rendered exactly once; a remount of
   * this tab loses them on purpose, because the server has no way to re-serve them.
   * Both mutations end by invalidating the session query: `totpEnabled` flips on the
   * server row, and every reader of the session (this tab, the header) must re-ask.
   */
  const [enrolment, setEnrolment] = useState<{
    secret: string;
    otpauthUri: string;
    qrDataUrl: string;
  } | null>(null);
  const [code, setCode] = useState('');
  /** The activate endpoint's own sentence for a refused code, shown under the boxes. */
  const [codeProblem, setCodeProblem] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<readonly string[] | null>(null);

  /*
   * Turning two-factor OFF is DELETE /auth/mfa with `{ password, code }` — both halves,
   * because a stolen session alone must not be able to strip the second factor. The
   * password is held in state only for the request and never persisted anywhere.
   */
  const [disabling, setDisabling] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordProblem, setPasswordProblem] = useState<string | null>(null);

  const enroll = useMutation({
    mutationFn: () =>
      api.post<{ secret: string; otpauthUri: string; qrDataUrl: string }>('/auth/mfa/enroll'),
    onSuccess: (data) => {
      setEnrolment(data);
      setCode('');
      setCodeProblem(null);
    },
    onError: (error) => toast.fromError(error, 'Could not start enrolment'),
  });

  const activate = useMutation({
    mutationFn: (confirmation: string) =>
      api.post<{ recoveryCodes: string[] }>('/auth/mfa/activate', { code: confirmation }),
    onSuccess: async (data) => {
      setEnrolment(null);
      setCode('');
      setCodeProblem(null);
      setRecoveryCodes(data.recoveryCodes);
      await client.invalidateQueries({ queryKey: qk.session });
    },
    onError: (error) => {
      // A refused code is an expected step of the flow, not a crash: clear the boxes,
      // name the problem under them, let the person look at their app and retype. Any
      // OTHER failure (rate limit, demo provenance, store down) goes to the toast.
      setCode('');
      if (error instanceof ApiError) {
        const fieldError = error.fieldErrors.find((field) => field.path === 'code');
        if (fieldError) {
          setCodeProblem(fieldError.message);
          return;
        }
      }
      toast.fromError(error, 'Could not enable two-factor');
    },
  });

  const disable = useMutation({
    mutationFn: () => api.del<void>('/auth/mfa', { password, code }),
    onSuccess: async () => {
      setDisabling(false);
      setPassword('');
      setCode('');
      setPasswordProblem(null);
      await client.invalidateQueries({ queryKey: qk.session });
      toast.success('Two-factor turned off', {
        description: 'You can set it up again at any time.',
      });
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        const fieldError = error.fieldErrors.find((field) => field.path === 'password');
        if (fieldError) {
          setPasswordProblem(fieldError.message);
          return;
        }
      }
      toast.fromError(error, 'Could not turn off two-factor');
    },
  });

  if (!user) return null;

  const canChangeMfa = !isDemo && policy.can('mfa:enroll');

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

        {/*
          ENROLMENT PANEL — QR first, secret second, confirmation last. The QR sits on a
          fixed light surface on purpose: authenticator apps scan black-on-white most
          reliably, and a themed dark surface would be the one place in the app that is
          harder to use with the lights off.
        */}
        {enrolment !== null && !user.totpEnabled ? (
          <div className="flex flex-col gap-4 border-t border-line pt-4">
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              <img
                src={enrolment.qrDataUrl}
                alt=""
                className="size-44 shrink-0 rounded-[var(--control-radius)] bg-white p-2"
              />
              <div className="flex min-w-0 flex-col gap-2">
                <p className="text-sm text-fg-secondary">
                  Scan this with your authenticator app — or enter the key by hand.
                </p>
                {/* select-all so manual entry is a double-tap away on a phone. */}
                <code className="w-full break-all rounded-md bg-sunken px-3 py-2 font-mono text-xs text-fg sm:text-sm">
                  {enrolment.secret}
                </code>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <p id="mfa-confirm-hint" className="text-sm text-fg-secondary">
                Then confirm one 6-digit code from the app to switch it on.
              </p>
              <OtpInput
                label="Confirmation code"
                value={code}
                onChange={(next) => {
                  setCode(next);
                  setCodeProblem(null);
                }}
                onComplete={(value) => activate.mutate(value)}
                disabled={activate.isPending}
                invalid={codeProblem !== null}
                describedBy={codeProblem !== null ? 'mfa-confirm-error' : 'mfa-confirm-hint'}
              />
              {activate.isPending ? (
                <p className="text-xs text-fg-tertiary">Checking that code…</p>
              ) : null}
              {codeProblem !== null ? (
                <p
                  id="mfa-confirm-error"
                  role="alert"
                  className="text-sm font-medium text-danger-fg"
                >
                  {codeProblem}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {/*
          RECOVERY CODES — shown ONCE, from activate's response. Rendered as a list of
          discrete codes rather than one wrapped string, because the whole point is
          copying ONE of them onto paper later.
        */}
        {recoveryCodes !== null ? (
          <div
            role="status"
            className="flex flex-col gap-2 rounded-md border border-warning-line bg-warning-soft px-3 py-3"
          >
            <p className="text-sm font-medium text-warning-fg">
              Save these recovery codes now — they are shown only once.
            </p>
            <p className="text-xs text-warning-fg">
              Each one signs you in without your app. Store them somewhere safe; there is no way to
              read them again.
            </p>
            <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {recoveryCodes.map((recoveryCode) => (
                <li key={recoveryCode}>
                  <code className="font-mono text-sm text-fg">{recoveryCode}</code>
                </li>
              ))}
            </ul>
            <div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setRecoveryCodes(null);
                }}
              >
                I have saved them
              </Button>
            </div>
          </div>
        ) : null}

        {user.totpEnabled ? (
          disabling ? (
            <form
              className="flex flex-col gap-3 border-t border-line pt-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (!disable.isPending) disable.mutate();
              }}
            >
              <p className="text-sm text-fg-secondary">
                Confirm your password and one code from your app to turn two-factor off.
              </p>
              <FormField label="Password" required error={passwordProblem ?? undefined}>
                <Input
                  type="password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setPasswordProblem(null);
                  }}
                  autoComplete="current-password"
                  disabled={disable.isPending}
                />
              </FormField>
              <OtpInput
                label="Authentication code"
                value={code}
                onChange={setCode}
                disabled={disable.isPending}
              />
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="submit"
                  variant="danger"
                  disabled={password.length === 0 || code.length < 6}
                  loading={disable.isPending}
                >
                  Turn off two-factor
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setDisabling(false);
                    setPassword('');
                    setCode('');
                    setPasswordProblem(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : canChangeMfa ? (
            <Button
              variant="danger"
              block
              className="sm:w-auto sm:self-start"
              onClick={() => setDisabling(true)}
            >
              Turn off two-factor
            </Button>
          ) : (
            <p className="text-xs text-fg-tertiary">
              Demo sessions cannot change two-factor settings.
            </p>
          )
        ) : canChangeMfa ? (
          <Button
            block
            className="sm:w-auto sm:self-start"
            loading={enroll.isPending}
            onClick={() => enroll.mutate()}
          >
            Set up two-factor
          </Button>
        ) : (
          <p className="text-xs text-fg-tertiary">
            Demo sessions cannot change two-factor settings.
          </p>
        )}
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
          // No per-call `onSettled` — see the note on the account menu's Sign out
          // in AppShell.tsx. `useLogout` navigates itself, from the mutation's own
          // `onSettled`, because a per-call handler rides the observer and this
          // screen renders nothing once the session is gone (Settings.tsx:169).
          onClick={() => logout.mutate(undefined)}
        >
          Sign out
        </Button>
      </Card>
    </div>
  );
}
