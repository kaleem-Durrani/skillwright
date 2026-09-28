import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import type { AssignmentDto } from '@skillwright/shared/schema';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/problem';
import { qk } from '@/lib/query';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { FormField } from '@/components/ui/FormField';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { toast } from '@/components/ui/Toast';

/**
 * The FORM's shape: every control a string, because a datetime control and an instant
 * do not mix, and an emptied box is `''` — never `null`, never `undefined`.
 *
 * `dueAt` is a LOCAL datetime string (`2026-03-14T17:00`) rather than an ISO instant,
 * because the teacher types a wall-clock time on the day the work is due and a UTC
 * instant in a `<input type="datetime-local">` is meaningless to them. `toCreate` below
 * is the one place the two meet, and it is where a browser that has not filled the
 * field in (Safari and Firefox both return `''`) is refused rather than sent as the
 * epoch.
 */
const formShape = z.object({
  title: z
    .string()
    .trim()
    .min(2, 'Give the task a title of at least 2 characters')
    .max(200, 'Keep the title under 200 characters'),
  brief: z
    .string()
    .trim()
    .min(1, 'Say what the task is — a student cannot act on a title alone.')
    .max(10_000, 'Keep the brief under 10,000 characters'),
  dueAt: z.string().min(1, 'Set a deadline.'),
  maxScore: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, 'A mark out of a number, e.g. 100 or 62.5'),
});

type FormValues = z.infer<typeof formShape>;

/** ISO instant → the `datetime-local` spelling, in the browser's own timezone. */
function toLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function toFormValues(assignment: AssignmentDto | undefined, defaultDueAt: string): FormValues {
  if (!assignment) {
    return {
      title: '',
      brief: '',
      dueAt: toLocalInput(defaultDueAt),
      maxScore: '100',
    };
  }
  return {
    title: assignment.title,
    brief: assignment.brief,
    dueAt: toLocalInput(assignment.dueAt),
    maxScore: String(assignment.maxScore),
  };
}

export interface AssignmentFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  offeringId: string;
  courseId: string;
  /** Present when editing; absent when creating. */
  assignment?: AssignmentDto;
  /**
   * The default deadline for a NEW task, as an ISO instant.
   *
   * Passed in rather than computed here so the parent decides it from the intake's own
   * dates — "a week before the intake ends" is a fact the offerings section already
   * has, and a hard-coded "+7 days" in a dialog would be a second, dumber answer to a
   * question the page can already answer.
   */
  defaultDueAt: string;
}

export function AssignmentFormDialog({
  open,
  onOpenChange,
  offeringId,
  courseId,
  assignment,
  defaultDueAt,
}: AssignmentFormDialogProps): ReactElement {
  const client = useQueryClient();
  const isEditing = assignment !== undefined;
  const formId = useId();
  const [dirty, setDirty] = useState(false);

  const schema = useMemo(() => formShape, []);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: toFormValues(assignment, defaultDueAt),
  });
  const { errors, isDirty: formIsDirty } = form.formState;
  const { reset, setError } = form;

  /**
   * Seeded once per opening, keyed on which task this dialog is for — the same ref
   * arrangement `SubmissionDialog` and `ResourceFormDialog` use, and for the same
   * reason: a query row is a new object on every refetch, and an effect keyed on the
   * object would reset the form under someone mid-edit.
   */
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    const seed = open ? (assignment?.id ?? 'new') : null;
    if (seededFor.current === seed) return;
    seededFor.current = seed;
    if (!open) return;
    reset(toFormValues(assignment, defaultDueAt));
    setDirty(false);
  }, [open, assignment, defaultDueAt, reset]);

  const save = useMutation({
    mutationFn: (values: FormValues) => {
      const body = {
        ...(isEditing ? {} : { offeringId }),
        title: values.title,
        brief: values.brief,
        // `new Date(local).toISOString()` is the one conversion, and it is deliberately
        // NOT done in a resolver: a resolver that threw on a timezone would put the
        // message in the wrong place, and this cannot fail — the resolver has already
        // refused an empty string.
        dueAt: new Date(values.dueAt).toISOString(),
        maxScore: Number(values.maxScore),
      };
      return isEditing
        ? api.patch<AssignmentDto>(`/assignments/${assignment.id}`, body)
        : api.post<AssignmentDto>(`/offerings/${offeringId}/assignments`, body);
    },
    onSuccess: async (saved) => {
      toast.success(isEditing ? 'Task updated' : 'Task set', {
        description: `Due ${new Date(saved.dueAt).toLocaleDateString()}, out of ${saved.maxScore}.`,
      });
      onOpenChange(false);
      await Promise.all([
        client.invalidateQueries({ queryKey: qk.offeringAssignments(offeringId) }),
        // The student's own list is a different key and a different shape, and a task
        // appearing or moving its deadline has to reach it — the student is already
        // looking at the course page.
        client.invalidateQueries({ queryKey: qk.myAssignments({ courseId }) }),
      ]);
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        for (const [path, message] of Object.entries(error.byField)) {
          if (path in formShape.shape) {
            setError(path as keyof FormValues, { message });
          }
        }
      }
      toast.fromError(
        error,
        isEditing ? 'Could not save those changes' : 'Could not set that task',
      );
    },
  });

  const register = form.register;
  const locked = save.isPending;
  const ready = formIsDirty || dirty;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (locked && !next) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        dismissible={!locked}
        title={isEditing ? 'Edit this task' : 'Set a task'}
        description={
          isEditing
            ? 'Changes the brief, the deadline and what it is out of. Hand-ins already recorded are kept.'
            : 'Every student holding a seat on this intake sees it, with the deadline and the brief.'
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
              // The button lives in the dialog's footer slot, outside the <form>, so it
              // is associated by id — which is also what makes Enter in a text input
              // submit the form rather than doing nothing.
              type="submit"
              form={formId}
              block
              className="sm:w-auto"
              loading={save.isPending}
              disabled={isEditing && !ready}
            >
              {isEditing ? 'Save changes' : 'Set task'}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          className="flex flex-col gap-4"
          noValidate
          onSubmit={form.handleSubmit((values) => save.mutate(values))}
        >
          <FormField label="Title" required error={errors.title?.message}>
            <Input
              autoComplete="off"
              placeholder="Weld the fillet"
              disabled={locked}
              {...register('title', { onChange: () => setDirty(true) })}
            />
          </FormField>

          <FormField
            label="The task"
            required
            hint="What the student has to produce, in the words you would say to them."
            error={errors.brief?.message}
          >
            <Textarea
              autoResize
              rows={5}
              disabled={locked}
              {...register('brief', { onChange: () => setDirty(true) })}
            />
          </FormField>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Due" required error={errors.dueAt?.message}>
              <Input
                type="datetime-local"
                disabled={locked}
                {...register('dueAt', { onChange: () => setDirty(true) })}
              />
            </FormField>

            <FormField
              label="Out of"
              required
              hint="Marks. Half marks are allowed."
              error={errors.maxScore?.message}
            >
              <Input
                inputMode="decimal"
                autoComplete="off"
                disabled={locked}
                {...register('maxScore', { onChange: () => setDirty(true) })}
              />
            </FormField>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
