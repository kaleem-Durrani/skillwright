import { useEffect, useId, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
/**
 * The schema VALUES come straight from `@skillwright/shared/schema`, per
 * lib/types.ts's rule that a barrel of `export type`s must not become a runtime
 * module. `createUserSchema` is the single source of every rule below — including
 * the role-conditionals — so the client refuses exactly what `POST /users` refuses.
 */
import { createUserSchema, roleSchema, type CreateUserInput } from '@skillwright/shared/schema';
import type { Paginated } from '@skillwright/shared/schema';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/problem';
import type { DepartmentSummary, UserDetail } from '@/lib/types';
import { ROLE_LABEL } from '@/components/layout/nav';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { FormField } from '@/components/ui/FormField';
import { Input } from '@/components/ui/Input';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/Select';
import { toast } from '@/components/ui/Toast';

/**
 * The FORM's shape — strings only, so an untouched box is `''`. Not a restatement
 * of `createUserSchema`: none of its rules are copied here. Instead `superRefine`
 * builds the exact body `toCreate` would send and runs the SHARED schema over it,
 * so every constraint — email shape, name length, the role-conditionals (a
 * department outside ADMIN, a qualification for teachers) — is enforced client-side
 * with the schema's own sentences. Restating them locally would be a second place
 * for provisioning rules to drift.
 */
const formShape = z.object({
  email: z.string(),
  name: z.string(),
  role: roleSchema,
  departmentId: z.string(),
  qualification: z.string(),
  specialization: z.string(),
  staffNo: z.string(),
  enrollmentNo: z.string(),
});

type UserFormValues = z.infer<typeof formShape>;

const EMPTY_FORM_VALUES: UserFormValues = {
  email: '',
  name: '',
  // STUDENT is the least-privileged role; provisioning something weaker than
  // intended takes a deliberate change, not an accidental default.
  role: 'STUDENT',
  departmentId: '',
  qualification: '',
  specialization: '',
  staffNo: '',
  enrollmentNo: '',
};

/** The candidate POST body: role-appropriate fields only, and never an empty string. */
function toCreate(values: UserFormValues): CreateUserInput {
  const isTeacher = values.role === 'TEACHER';
  return {
    email: values.email.trim(),
    name: values.name.trim(),
    role: values.role,
    /*
     * An ADMIN has neither profile satellite nor department (users.service.create
     * refuses a departmentId for one), so the select is not even offered — but the
     * guard keeps a stale selection on a switched role out of the body too.
     */
    ...(values.role !== 'ADMIN' && values.departmentId !== ''
      ? { departmentId: values.departmentId }
      : {}),
    ...(isTeacher && values.qualification.trim() !== ''
      ? { qualification: values.qualification.trim() }
      : {}),
    ...(isTeacher && values.specialization.trim() !== ''
      ? { specialization: values.specialization.trim() }
      : {}),
    ...(isTeacher && values.staffNo.trim() !== '' ? { staffNo: values.staffNo.trim() } : {}),
    // Left blank, a student's enrolment number is generated server-side.
    ...(values.role === 'STUDENT' && values.enrollmentNo.trim() !== ''
      ? { enrollmentNo: values.enrollmentNo.trim() }
      : {}),
  };
}

/** Every validation verdict comes from the shared schema, re-emitted at its own path. */
const formSchema = formShape.superRefine((values, ctx) => {
  const parsed = createUserSchema.safeParse(toCreate(values));
  if (parsed.success) return;
  for (const issue of parsed.error.issues) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: issue.path, message: issue.message });
  }
});

/**
 * Server field paths onto the control that owns them. `createUserSchema` names its
 * fields exactly as this form does, so the map is an identity one — kept explicit so
 * a renamed schema field surfaces here instead of vanishing into the toast.
 */
const FIELD_FOR_PATH: Readonly<Record<string, keyof UserFormValues>> = {
  email: 'email',
  name: 'name',
  role: 'role',
  departmentId: 'departmentId',
  qualification: 'qualification',
  specialization: 'specialization',
  staffNo: 'staffNo',
  enrollmentNo: 'enrollmentNo',
};

export interface UserCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * "Add a user" — admin provisioning against `POST /users`.
 *
 * WHAT THIS DIALOG DOES NOT OFFER, on purpose: a password field. The endpoint
 * creates the account with NO credential (`createUserSchema` accepts none); the
 * person sets their own through the existing forgot-password flow. Inventing a
 * password input here would mean a second credential path the backend refuses to
 * serve.
 */
export function UserCreateDialog({ open, onOpenChange }: UserCreateDialogProps): ReactElement {
  const client = useQueryClient();

  /** Departments for the select. `department:list` allows every role. */
  const departments = useQuery({
    queryKey: ['departments', { limit: 200 }],
    queryFn: () => api.get<Paginated<DepartmentSummary>>('/departments', { query: { limit: 200 } }),
    enabled: open,
  });

  const formId = useId();
  const form = useForm<UserFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: EMPTY_FORM_VALUES,
  });
  const { reset, setError, setValue } = form;

  // A fresh form per opening, so a cancelled attempt leaves nothing behind.
  useEffect(() => {
    if (!open) return;
    reset(EMPTY_FORM_VALUES);
  }, [open, reset]);

  // Read during render so the role-conditional fields track the select directly.
  const role = form.watch('role');

  const save = useMutation({
    mutationFn: (body: CreateUserInput) => api.post<UserDetail>('/users', body),
    onSuccess: async (created) => {
      /*
       * The honest summary of what was created. The account exists and can receive
       * mail; it cannot sign in until its owner proves the mailbox via
       * forgot-password (Mailpit in development), which also flips the row ACTIVE.
       */
      toast.success(`${created.name} added`, {
        description:
          'The account has no password yet — it is set through Forgot password on the sign-in screen.',
      });
      onOpenChange(false);
      await client.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        for (const [path, message] of Object.entries(error.byField)) {
          const field = FIELD_FOR_PATH[path];
          if (field) setError(field, { message });
        }
        if (Object.keys(error.byField).length === 0 && error.code === 'CONFLICT') {
          /*
           * POST /users has two unique constraints in play: email — pre-checked by
           * the service, so its conflict arrives as a deliberate branch naming it —
           * and StudentProfile.enrollmentNo, which is a raw P2002 naming no field
           * (errors.plugin.ts:74-78). The sentence tells them apart.
           */
          if (/email/i.test(error.message)) {
            setError('email', { message: error.message });
          } else {
            setError('enrollmentNo', { message: 'That enrolment number is already in use.' });
          }
          return;
        }
      }
      toast.fromError(error, 'Could not add that account');
    },
  });

  const { errors } = form.formState;
  const locked = save.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => !locked && onOpenChange(next)}>
      <DialogContent
        dismissible={!locked}
        title="Add a user"
        description="Creates the account only — no password. The person sets their own via Forgot password."
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
            >
              Add user
            </Button>
          </>
        }
      >
        <form
          id={formId}
          className="flex flex-col gap-4"
          noValidate
          onSubmit={form.handleSubmit((values) => save.mutate(toCreate(values)))}
        >
          <FormField label="Name" required error={errors.name?.message}>
            <Input
              autoComplete="off"
              placeholder="Dana Okafor"
              disabled={locked}
              {...form.register('name')}
            />
          </FormField>

          <FormField
            label="Email"
            required
            hint="Their sign-in address. A set-password link is sent here when they ask for one."
            error={errors.email?.message}
          >
            <Input
              type="email"
              autoComplete="off"
              placeholder="dana@example.edu"
              disabled={locked}
              {...form.register('email')}
            />
          </FormField>

          <FormField label="Role" required error={errors.role?.message}>
            <Select
              value={role}
              disabled={locked}
              onValueChange={(next) => {
                const parsed = roleSchema.safeParse(next);
                if (!parsed.success) return;
                setValue('role', parsed.data, { shouldValidate: true });
              }}
            >
              <SelectTrigger aria-label="Role" />
              <SelectContent>
                {roleSchema.options.map((value) => (
                  <SelectItem key={value} value={value}>
                    {ROLE_LABEL[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          {/*
            Department and profile fields exist only for the roles whose wire body
            carries them — the same pairing `users.service.create` writes. An ADMIN
            has neither satellite nor department, so an administrator gets a sentence
            saying so rather than controls that could only ever produce a 422.
          */}
          {role !== 'ADMIN' ? (
            <FormField label="Department" required error={errors.departmentId?.message}>
              <Select
                value={form.watch('departmentId') || undefined}
                disabled={locked}
                onValueChange={(next) => setValue('departmentId', next, { shouldValidate: true })}
              >
                <SelectTrigger placeholder="Choose a department" />
                <SelectContent>
                  {(departments.data?.data ?? []).map((department) => (
                    <SelectItem key={department.id} value={department.id}>
                      {department.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          ) : (
            <p className="text-xs text-fg-tertiary">
              Administrators sit outside the department structure.
            </p>
          )}

          {role === 'TEACHER' ? (
            <>
              <FormField label="Qualification" required error={errors.qualification?.message}>
                <Input
                  autoComplete="off"
                  placeholder="City & Guilds Level 3 Welding"
                  disabled={locked}
                  {...form.register('qualification')}
                />
              </FormField>
              <FormField
                label="Specialization"
                hint="Optional — their trade or subject area."
                error={errors.specialization?.message}
              >
                <Input autoComplete="off" disabled={locked} {...form.register('specialization')} />
              </FormField>
              <FormField label="Staff number" hint="Optional." error={errors.staffNo?.message}>
                <Input autoComplete="off" disabled={locked} {...form.register('staffNo')} />
              </FormField>
            </>
          ) : null}

          {role === 'STUDENT' ? (
            <FormField
              label="Enrolment number"
              hint="Optional — one is generated if left blank."
              error={errors.enrollmentNo?.message}
            >
              <Input autoComplete="off" disabled={locked} {...form.register('enrollmentNo')} />
            </FormField>
          ) : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}
