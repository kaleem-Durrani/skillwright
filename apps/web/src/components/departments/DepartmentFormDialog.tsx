import { useEffect, useId, useRef, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import type { CreateDepartmentInput, UpdateDepartmentInput } from '@skillwright/shared/schema';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/problem';
import { qk } from '@/lib/query';
import type { DepartmentDetail, DepartmentSummary } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { FormField } from '@/components/ui/FormField';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { toast } from '@/components/ui/Toast';

/**
 * The FORM's shape — strings only. Not either wire shape; `toCreate` / `toUpdate`
 * are the only places the two meet (the argument ResourceFormDialog makes at
 * length). There is no slug field on create: `createDepartmentSchema` accepts one,
 * but the server derives it from the name and no screen has ever needed to override
 * that except a migration preserving old URLs.
 */
const formShape = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Give the department a name of at least 2 characters')
    .max(120, 'Keep the name under 120 characters'),
  description: z.string().trim().max(2000, 'Keep the description under 2000 characters'),
});

type DepartmentFormValues = z.infer<typeof formShape>;

/** What react-hook-form reports as touched-and-changed. */
type DirtyDepartmentFields = { readonly [K in keyof DepartmentFormValues]?: boolean };

const FIELD_FOR_PATH: Readonly<Record<string, keyof DepartmentFormValues>> = {
  name: 'name',
  description: 'description',
};

function toFormValues(department: DepartmentDetail | undefined): DepartmentFormValues {
  return {
    name: department?.name ?? '',
    description: department?.description ?? '',
  };
}

function toCreate(values: DepartmentFormValues): CreateDepartmentInput {
  return {
    name: values.name.trim(),
    ...(values.description === '' ? {} : { description: values.description.trim() }),
  };
}

/**
 * The PATCH body: only what actually changed. `description` is `.nullable()` on the
 * schema, so an emptied box becomes `null` ("clear this"); an untouched box is
 * omitted entirely, so saving the name can never blank a description.
 */
function toUpdate(
  values: DepartmentFormValues,
  dirty: DirtyDepartmentFields,
): UpdateDepartmentInput {
  return {
    ...(dirty.name ? { name: values.name.trim() } : {}),
    ...(dirty.description
      ? { description: values.description === '' ? null : values.description.trim() }
      : {}),
  };
}

export interface DepartmentFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing an existing row; absent when creating. */
  department?: Pick<DepartmentSummary, 'id' | 'name'>;
}

export function DepartmentFormDialog({
  open,
  onOpenChange,
  department,
}: DepartmentFormDialogProps): ReactElement {
  const client = useQueryClient();
  const isEditing = department !== undefined;

  const detail = useQuery({
    queryKey: qk.department(department?.id ?? ''),
    // The summary row carries no description; the edit form needs it.
    queryFn: () => api.get<DepartmentDetail>(`/departments/${String(department?.id)}`),
    enabled: open && isEditing,
  });

  const formId = useId();
  const seededFor = useRef<string | null>(null);
  const loadedDetail = detail.data;

  const form = useForm<DepartmentFormValues>({
    // A plain object schema with no create/edit difference — one instance is enough.
    resolver: zodResolver(formShape),
    defaultValues: toFormValues(undefined),
  });
  const { reset, setError } = form;

  /**
   * Seed once per opening AND once per arrival of the fetched detail, keyed so a
   * background refetch with unchanged contents resets nothing mid-edit.
   */
  useEffect(() => {
    const seed = open ? `${department?.id ?? 'new'}:${loadedDetail?.updatedAt ?? ''}` : null;
    if (seededFor.current === seed) return;
    if (open && isEditing && !loadedDetail) return;
    seededFor.current = seed;
    if (!open) return;
    reset(toFormValues(loadedDetail));
  }, [open, department?.id, isEditing, loadedDetail, reset]);

  const save = useMutation({
    mutationFn: async (input: {
      body: CreateDepartmentInput | UpdateDepartmentInput;
    }): Promise<void> => {
      if (department) {
        await api.patch<DepartmentDetail>(`/departments/${department.id}`, input.body);
        return;
      }
      await api.post<DepartmentDetail>('/departments', input.body);
    },
    onSuccess: async () => {
      toast.success(isEditing ? 'Department updated' : 'Department added');
      onOpenChange(false);
      await client.invalidateQueries({ queryKey: ['departments'] });
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        for (const [path, message] of Object.entries(error.byField)) {
          const field = FIELD_FOR_PATH[path];
          if (field) setError(field, { message });
        }
        /*
         * A duplicate name collides on the unique slug it derives, which Prisma
         * reports as P2002 → 409 CONFLICT naming no field. The generic CONFLICT copy
         * ("conflicts with something that already exists") is technically true and
         * completely unhelpful here; the collision is always the name.
         */
        if (error.code === 'CONFLICT' && !isEditing) {
          setError('name', { message: 'A department with that name already exists.' });
          return;
        }
      }
      toast.fromError(
        error,
        isEditing ? 'Could not save those changes' : 'Could not add that department',
      );
    },
  });

  const { dirtyFields, errors, isDirty } = form.formState;
  const locked = save.isPending || (isEditing && open && detail.isPending);

  return (
    <Dialog open={open} onOpenChange={(next) => !locked && onOpenChange(next)}>
      <DialogContent
        dismissible={!locked}
        title={isEditing ? 'Edit department' : 'Add a department'}
        description={
          isEditing
            ? 'The name and description of the department.'
            : 'Courses and members are attached to it once it exists.'
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
              disabled={isEditing && !isDirty}
            >
              {isEditing ? 'Save changes' : 'Add department'}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          className="flex flex-col gap-4"
          noValidate
          onSubmit={form.handleSubmit((values) => {
            if (department) {
              const body = toUpdate(values, dirtyFields);
              // `updateDepartmentSchema` refuses an empty body; save is already
              // disabled until something is dirty — this is the second lock.
              if (Object.keys(body).length === 0) return;
              save.mutate({ body });
              return;
            }
            save.mutate({ body: toCreate(values) });
          })}
        >
          <FormField label="Name" required error={errors.name?.message}>
            <Input
              autoComplete="off"
              placeholder="Welding and Fabrication"
              disabled={locked}
              {...form.register('name')}
            />
          </FormField>

          <FormField
            label="Description"
            hint="Optional. What the department teaches."
            error={errors.description?.message}
          >
            <Textarea autoResize rows={3} disabled={locked} {...form.register('description')} />
          </FormField>
        </form>
      </DialogContent>
    </Dialog>
  );
}
