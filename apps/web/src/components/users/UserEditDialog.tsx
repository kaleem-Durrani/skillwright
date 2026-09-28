import { useEffect, useId, useMemo, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
/**
 * The schema VALUE comes straight from `@skillwright/shared/schema` rather than
 * being imported as a type, because the WHOLE POINT of this dialog is that
 * `updateUserSchema` is the single source of the rules — this component runs that
 * exact object over a candidate body instead of restating any of its constraints.
 * The create dialog sets the pattern one file over (`createUserSchema` in
 * UserCreateDialog.tsx); a second hand-written copy of either schema is how the
 * two drift apart, and the copy is already tempting to write — Settings.tsx has
 * one for the self-service `/users/me` form, and its own comment admits it is a
 * mirror rather than an import, because `updateUserSchema` is `.partial().refine()`d
 * and exposes no `.shape`. Running the whole schema side-steps that: nullability,
 * the non-empty refinement, the per-field maxima and the role-field pairing are
 * all read off the one object the API binds to its route.
 */
import { updateUserSchema, type UpdateUserInput } from '@skillwright/shared/schema';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/problem';
import type { UserDetail } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { FormField } from '@/components/ui/FormField';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { toast } from '@/components/ui/Toast';

/**
 * The FORM's shape — strings only, so an untouched box is `''`. Not a restatement
 * of `updateUserSchema`: every constraint is delegated to it by `formSchema`
 * below. `bio` is the only control that is not a single line, and it is a
 * textarea because the shared schema allows 2000 characters of it.
 */
const formShape = z.object({
  name: z.string(),
  phoneNumber: z.string(),
  bio: z.string(),
  qualification: z.string(),
  specialization: z.string(),
  staffNo: z.string(),
  enrollmentNo: z.string(),
});

type UserEditValues = z.infer<typeof formShape>;

/** Every field the shared schema knows, and every control this form renders. */
const EDITABLE_FIELDS = [
  'name',
  'phoneNumber',
  'bio',
  'qualification',
  'specialization',
  'staffNo',
  'enrollmentNo',
] as const satisfies readonly (keyof UpdateUserInput & keyof UserEditValues)[];

type EditableField = (typeof EDITABLE_FIELDS)[number];

/**
 * The served record, flattened into the controls — the same projection Settings'
 * self-service form makes, because a person's fields live on whichever profile
 * satellite their role has and an ADMIN has neither (users.service's
 * `PROFILE_FIELD_ROLES`). Written out here rather than imported from Settings
 * because Settings is a page, not a module, and importing a page from a component
 * to save six lines trades a duplication for a cycle.
 */
function toFormValues(user: UserDetail): UserEditValues {
  return {
    name: user.name,
    phoneNumber: user.phoneNumber ?? '',
    bio: user.bio ?? '',
    qualification: user.teacherProfile?.qualification ?? '',
    specialization: user.teacherProfile?.specialization ?? '',
    staffNo: user.teacherProfile?.staffNo ?? '',
    enrollmentNo: user.studentProfile?.enrollmentNo ?? '',
  };
}

/**
 * WHETHER A FIELD MAY BE CLEARED, read off the shared schema rather than declared
 * here.
 *
 * `''` is a control's empty state, and not every field can read one the same way.
 * A field whose schema member accepts `null` (phoneNumber, bio, specialization,
 * staffNo) can be CLEARED, so `''` becomes an explicit `null` — and that is the
 * only way a nullable column ever leaves a value it had. A field that refuses
 * `null` (qualification, enrollmentNo) sits on a NOT NULL column, so blanking it
 * cannot mean "clear" and must mean "no change": the field is omitted, exactly as
 * an untouched one is.
 *
 * The alternative is a hand-written list of which fields are nullable — a second
 * copy of a fact the schema already states, which is the drift this whole file
 * exists to prevent. `{ [field]: null }` against the real object answers it, and
 * the refine at the end of `updateUserSchema` is satisfied because there is
 * exactly one key in the candidate.
 */
function isClearable(field: EditableField): boolean {
  return updateUserSchema.safeParse({ [field]: null }).success;
}

/**
 * The candidate PATCH body: only what the user actually changed, never an empty
 * string, and never a field this dialog does not own.
 *
 * The empty-string half is not tidiness, it is the 422 users.routes.ts's own
 * comment records. `updateUserSchema.phoneNumber` is `phoneSchema.nullable()` and
 * `phoneSchema` refuses `''`, so a form that PATCHed its untouched seeded
 * `{ phoneNumber: '' }` is refused by the VALIDATOR, before the policy
 * preHandler runs — every save, for every role, including one that only fixed a
 * name. The shared schema was not loosened to absorb that, because `''` would then
 * be a stored empty phone number for every other client, so the client sends
 * `null` or nothing at all.
 *
 * The role half is the same discipline the create dialog uses, and it is not
 * optional: `rejectMismatchedProfileFields` in the users service answers a
 * teacher field on a student with a field-level 422 naming the field, and this
 * form never offers one.
 *
 * `avatarUploadId` is absent by construction, and that is a real restriction
 * rather than an omission. It is the ONE field `PATCH /users/me` accepts and
 * `PATCH /users/:id` refuses outright — the service validates upload ownership
 * against the CALLER, and on the admin path the caller is not the person whose
 * face it would be. Widening that to make a picker appear is exactly the move
 * lesson 15 exists to prevent, so an avatar stays the account owner's own edit
 * from their own Settings screen.
 */
function toUpdate(values: UserEditValues, original: UserEditValues): UpdateUserInput {
  const body: Record<string, unknown> = {};

  for (const field of EDITABLE_FIELDS) {
    const next = values[field].trim();
    if (next === original[field].trim()) continue;
    if (next === '') {
      // A cleared field travels as an explicit `null` only where the column can
      // hold one. Where it cannot — qualification, enrolmentNo — blanking the box
      // is not a request to clear anything, because there is nothing on the other
      // side of it; the field is left out, exactly as an untouched one is. Sending
      // `''` instead would be caught by the shared schema for qualification, and
      // would be ACCEPTED for enrolmentNo, whose schema member is `.max(40)` with
      // no minimum — writing an empty string into a NOT NULL unique column.
      if (isClearable(field)) body[field] = null;
      continue;
    }
    body[field] = next;
  }

  /*
   * A cast, and the loop above is what makes it a sound one: `EDITABLE_FIELDS` is
   * declared `satisfies readonly (keyof UpdateUserInput & keyof UserEditValues)[]`,
   * so a key cannot be written here that the wire type does not name, and each
   * value is either a trimmed string or a `null` the shared schema's own member
   * accepts. `Object.fromEntries` erases the per-key types and the shared schema
   * re-establishes them on the next line — which is the point of running that
   * schema at all.
   */
  return Object.fromEntries(Object.entries(body)) as UpdateUserInput;
}

function fieldIn(path: string): path is EditableField {
  return (EDITABLE_FIELDS as readonly string[]).includes(path);
}

/**
 * Which controls the form shows for a given target, in one place so the JSX and
 * the error-routing above cannot disagree. The three profile columns belong to the
 * roles `PROFILE_FIELD_ROLES` in the users service pairs them with, and an
 * administrator has neither satellite — so the same set decides what is offered
 * and where a server field error may be put.
 */
function rendersFor(role: UserDetail['role'] | undefined): ReadonlySet<EditableField> {
  const base: EditableField[] = ['name', 'phoneNumber', 'bio'];
  if (role === 'TEACHER') return new Set([...base, 'qualification', 'specialization', 'staffNo']);
  if (role === 'STUDENT') return new Set([...base, 'enrollmentNo']);
  return new Set(base);
}

/**
 * The one place a candidate body is judged, and the rule is delegated whole.
 *
 * `updateUserSchema` runs over the exact object `toUpdate` would send, so a
 * refusal carries the schema's own sentence — the phone number's, the 2000-
 * character cap on a bio, the 40-character cap on an enrolment number — and the
 * client refuses precisely what `PATCH /users/:id` refuses. A local copy of those
 * rules is the failure this is written to prevent, and the copy is already in the
 * tree: Settings.tsx's self-service form mirrors them field by field because
 * `updateUserSchema` is `.partial().refine()`d and exposes no `.shape` to import
 * members from. Running the whole object needs no `.shape` at all, which is how
 * one of the two copies is avoidable.
 *
 * `original` is a parameter rather than a closure for one reason: it must be the
 * record the dialog was OPENED with, and the record behind an open dialog is
 * React state. A module-level schema could not know it, and defaulting it to the
 * submitted values would report every field unchanged and refuse every save.
 */
function checkCandidate(
  values: UserEditValues,
  original: UserEditValues,
  ctx: z.RefinementCtx,
): void {
  const parsed = updateUserSchema.safeParse(toUpdate(values, original));
  if (parsed.success) return;
  for (const issue of parsed.error.issues) {
    // `updateUserSchema`'s trailing `.refine` reports "Provide at least one field
    // to update." at the ROOT, where there is no control to attach it to. It is
    // unreachable from this dialog — Save is disabled while nothing is dirty, and
    // the button is the surface a person can actually see — so inventing a
    // form-level error box for one unreachable message would give the dialog two
    // error surfaces where every other dialog in the app has one per field.
    if (issue.path.length === 0) continue;
    const field = issue.path[0];
    if (typeof field !== 'string' || !fieldIn(field)) continue;
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: issue.message });
  }
}

export interface UserEditDialogProps {
  /** The account being edited. `null` closes the dialog. */
  user: UserDetail | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * "Edit account" — an admin correcting someone else's record, against
 * `PATCH /users/:id`.
 *
 * WHY THE FIELD SET IS SMALLER THAN A CREATE FORM'S, AND SMALLER THAN
 * `/users/me`'s TOO. Three things are absent that a reader expects to find, and
 * none of them is an oversight:
 *
 *   - `email`. `updateUserSchema` carries no `email` at all, so NOTHING in this
 *     product can change a sign-in address — not this dialog, not the person's
 *     own Settings screen. It is said out loud in the dialog body, because an
 *     admin who has just been handed an "Edit" action will otherwise assume the
 *     mistyped address above it is fixable here, and that assumption costs a
 *     support ticket. The truthful answer is a replacement account, and that is
 *     what the copy says — a database edit is a DBA action, and telling an admin
 *     it is a button in the app would be a second small lie.
 *   - `role` and `status`. Both are admin verbs by design and have their own
 *     actions: suspension and reinstatement are buttons in the row menu, and the
 *     role has no endpoint at all. Putting a select here would either be inert or
 *     need a permission this dialog does not have.
 *   - `avatarUploadId`. Covered above, in `toUpdate`.
 *
 * WHY THE SUBJECT IS THE TARGET. `PATCH /users/:id` and `PATCH /users/me` are
 * two routes over the same action and the same body schema, differing in whose
 * row changes and — because the role is read off the TARGET on the admin path —
 * which fields are legitimate. The id in `save.mutate` comes from `user.id` and
 * is interpolated into the path, and the one string that could quietly become
 * the self route (`/users/me`) is never constructed anywhere in this file.
 */
export function UserEditDialog({ user, onOpenChange }: UserEditDialogProps): ReactElement {
  const client = useQueryClient();
  const open = user !== null;

  /*
   * A new form per target AND per opening, so an admin who edits one person,
   * cancels, and edits another never sees the first person's phone number in the
   * second person's form.
   *
   * The snapshot is keyed on the ID rather than on the object, which is the whole
   * subtlety. React Query refetches `['users']` on window focus by default, and
   * that refetch hands this dialog a NEW `user` object for the SAME person —
   * memoising on `[user]` would re-seed the form from the server on every focus
   * change and silently discard whatever the admin had typed. Keying on the id
   * makes the snapshot a property of WHICH PERSON, which is the only thing that
   * should replace it. The disable is on the missing `user` dependency, and the
   * id in the list is the only part of it that is allowed to matter.
   */
  const formId = useId();
  const targetId = user?.id ?? null;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the id, not the object; see above
  const original = useMemo(() => (user ? toFormValues(user) : null), [targetId]);
  const resolver = useMemo(
    () =>
      zodResolver(
        formShape.superRefine((values, ctx) => {
          if (original) checkCandidate(values, original, ctx);
        }),
      ),
    [original],
  );

  const form = useForm<UserEditValues>({
    resolver,
    defaultValues: EMPTY_FORM_VALUES,
  });
  const { reset, setError } = form;

  useEffect(() => {
    if (!original) return;
    reset(original);
  }, [original, reset]);

  const save = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateUserInput }) =>
      api.patch<UserDetail>(`/users/${id}`, body),
    onSuccess: async (updated) => {
      /*
       * The copy names what happened and, for a suspended account, what did NOT.
       * `PATCH /users/:id` has no status term in its body and the service writes
       * only the fields it was sent, so editing a suspended person is a genuinely
       * successful edit that leaves them unable to sign in. A generic "account
       * updated" would leave an admin believing they had quietly fixed it.
       */
      toast.success(`${updated.name} updated`, {
        description:
          updated.status === 'SUSPENDED'
            ? 'Saved. Sign-in is still off — use Reinstate account in the row menu to restore it.'
            : undefined,
      });
      onOpenChange(false);
      await client.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        for (const [path, message] of Object.entries(error.byField)) {
          /*
           * Only onto a control this form actually RENDERS. react-hook-form will
           * happily store an error for a field that was never mounted, where it
           * renders nowhere and the person sees a save that apparently failed with
           * nothing on screen to explain it. A field-level 422 for a field this
           * dialog does not offer means the ROLE the service read is not the role
           * the list rendered, which is an anomaly rather than a typo — so it goes
           * to the toast with the problem's own code, not into a hole.
           */
          if (fieldIn(path) && rendersFor(user?.role).has(path)) setError(path, { message });
        }
        if (Object.keys(error.byField).length === 0 && error.code === 'CONFLICT') {
          /*
           * `StudentProfile.enrollmentNo` is `@unique`, so a number someone else
           * already holds arrives as a raw P2002 that names no field. It is the
           * only unique column this body can write, and it only exists on a
           * student's form — assigning the conflict to `enrollmentNo` on a teacher
           * would put a sentence about enrolment numbers under a staff number.
           * The service's other 409 ("This account has no teacher profile to
           * update") falls through to the toast, which is the honest home for it.
           */
          if (fields.has('enrollmentNo')) {
            setError('enrollmentNo', { message: 'That enrolment number is already in use.' });
            return;
          }
        }
      }
      toast.fromError(error, 'Could not save those changes');
    },
  });

  const { errors } = form.formState;
  const values = form.watch();
  const locked = save.isPending;
  /*
   * Disable rather than let the shared schema's "Provide at least one field to
   * update." fire. Both would be correct; only one of them can be reached, and
   * the button is the surface a person can see.
   */
  const pending = original ? toUpdate(values, original) : null;
  const dirty = pending !== null && Object.keys(pending).length > 0;
  const fields = rendersFor(user?.role);

  return (
    <Dialog open={open} onOpenChange={(next) => !locked && onOpenChange(next)}>
      <DialogContent
        dismissible={!locked}
        title={`Edit ${user?.name ?? 'account'}`}
        description={
          'Corrects the record. Sign-in address, role and sign-in status are not editable here.'
        }
        footer={
          <>
            <Button
              variant="ghost"
              block
              className="sm:w-auto"
              disabled={locked}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form={formId}
              block
              className="sm:w-auto"
              loading={save.isPending}
              disabled={!dirty}
            >
              Save changes
            </Button>
          </>
        }
      >
        <form
          id={formId}
          className="flex flex-col gap-4"
          noValidate
          onSubmit={form.handleSubmit((submitted) => {
            if (!original || !user) return;
            save.mutate({ id: user.id, body: toUpdate(submitted, original) });
          })}
        >
          <FormField label="Name" required error={errors.name?.message}>
            <Input autoComplete="off" disabled={locked} {...form.register('name')} />
          </FormField>

          <FormField
            label="Phone number"
            hint="Leave blank to clear it."
            error={errors.phoneNumber?.message}
          >
            <Input
              type="tel"
              autoComplete="off"
              disabled={locked}
              {...form.register('phoneNumber')}
            />
          </FormField>

          <FormField
            label="Bio"
            hint="Shown on their profile. Leave blank to clear it."
            error={errors.bio?.message}
          >
            <Textarea rows={3} disabled={locked} {...form.register('bio')} />
          </FormField>

          {/*
            The role-conditionals are decided by the TARGET's role, which the
            dialog READS and never offers to change — the same pairing the create
            dialog switches on, except that here the select is gone because
            `updateUserSchema` has no `role` and no endpoint changes one. An ADMIN
            has neither profile satellite, so it gets the sentence rather than
            three controls that could only ever 422.

            Asked of `rendersFor` rather than of `user.role` again, so the set that
            decides what is RENDERED and the set that decides where a server field
            error may be PUT are the same value and cannot drift into a form that
            renders a control it will never accept an error on.
          */}
          {fields.has('qualification') ? (
            <>
              <FormField
                label="Qualification"
                required
                hint="Required on a teacher record, so it cannot be blanked."
                error={errors.qualification?.message}
              >
                <Input autoComplete="off" disabled={locked} {...form.register('qualification')} />
              </FormField>
              <FormField
                label="Specialization"
                hint="Optional — their trade or subject area. Leave blank to clear it."
                error={errors.specialization?.message}
              >
                <Input autoComplete="off" disabled={locked} {...form.register('specialization')} />
              </FormField>
              <FormField
                label="Staff number"
                hint="Optional. Leave blank to clear it."
                error={errors.staffNo?.message}
              >
                <Input autoComplete="off" disabled={locked} {...form.register('staffNo')} />
              </FormField>
            </>
          ) : null}

          {fields.has('enrollmentNo') ? (
            <FormField
              label="Enrolment number"
              required
              hint="Leave blank to keep the current number — it cannot be cleared."
              error={errors.enrollmentNo?.message}
            >
              <Input autoComplete="off" disabled={locked} {...form.register('enrollmentNo')} />
            </FormField>
          ) : null}

          {/*
            The gap an admin is most likely to hit, stated before they hit it. The
            address sits one column away on this very screen, and nothing in the
            product can change it — `updateUserSchema` has no `email` member and
            `createUserSchema` accepts one only at provisioning time.
          */}
          <p className="text-xs text-fg-tertiary">
            A sign-in address cannot be changed after the account is created. A mistyped address
            means provisioning a replacement account.
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const EMPTY_FORM_VALUES: UserEditValues = {
  name: '',
  phoneNumber: '',
  bio: '',
  qualification: '',
  specialization: '',
  staffNo: '',
  enrollmentNo: '',
};
