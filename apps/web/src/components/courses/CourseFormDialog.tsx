import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from 'react';
import { useForm, useFieldArray, type Path } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { z } from 'zod';
/**
 * The schema VALUES (they run in this resolver and build the wire bodies) come
 * straight from `@skillwright/shared/schema`, per lib/types.ts's rule that a barrel
 * of `export type`s must not become a runtime module. The DTO TYPES come from
 * `@/lib/types`.
 */
import {
  courseCodeSchema,
  durationUnitSchema,
  slugSchema,
  UPLOAD_LIMITS,
  type CreateCourseInput,
  type UpdateCourseInput,
} from '@skillwright/shared/schema';
import type { Paginated } from '@skillwright/shared/schema';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/format';
import { ApiError } from '@/lib/problem';
import { qk } from '@/lib/query';
import type { CourseDetail, CourseListItem, DepartmentSummary, UserDetail } from '@/lib/types';
import { useSession } from '@/lib/session';
import { describeFileProblem, isUploadFailure, uploadFile, type UploadedFile } from '@/lib/uploads';
import { acceptedTypesSentence } from '@/components/uploads/fileCopy';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { FormField, useFieldControlProps } from '@/components/ui/FormField';
import { controlBase, Input } from '@/components/ui/Input';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { toast } from '@/components/ui/Toast';

const SYLLABUS_LIMITS = UPLOAD_LIMITS.SYLLABUS;
const ACCEPTED_TYPES = acceptedTypesSentence(SYLLABUS_LIMITS.mimeTypes);
const ACCEPT_ATTRIBUTE = SYLLABUS_LIMITS.mimeTypes.join(',');

/** Mirrors `durationUnitSchema` with the words a timetable uses. */
const UNIT_LABEL: Record<(typeof durationUnitSchema.options)[number], string> = {
  HOUR: 'hours',
  DAY: 'days',
  WEEK: 'weeks',
  MONTH: 'months',
};

/**
 * An ISO instant as a `datetime-local` value — LOCAL time, which is what the picker
 * displays and edits. Round-tripping through `new Date(local)` back to ISO keeps the
 * wall-clock reading stable across save/load instead of drifting by the UTC offset.
 */
function toDateTimeLocal(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  const pad = (part: number): string => String(part).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function toIso(value: string): string {
  return new Date(value).toISOString();
}

/**
 * The FORM's shape — every control a string (or the one File), so an untouched box
 * is `''`. Neither wire shape: `toCreate` / `toUpdate` below are the only places the
 * two meet.
 *
 * `code` and `slug` exist on the CREATE path only; on edit they are shown read-only
 * (`updateCourseSchema` accepts neither — packages/shared/src/schema/course.ts),
 * but keeping them in ONE value type is what lets `reset` and `dirtyFields` behave
 * identically on both paths, the same argument ResourceFormDialog makes for its file.
 *
 * `offerings` is the Phase 9 intake list: a course is created WITH at least one run
 * (`createCourseSchema` takes `.min(1)` — dates and seats have nowhere else to live).
 * On EDIT the array is carried but not rendered: `updateCourseSchema` no longer
 * accepts any of an intake's fields, and retuning a run is PATCH
 * /courses/:id/offerings/:id through the course page's Intakes section.
 */
const offeringRowShape = {
  capacity: z
    .string()
    .trim()
    .refine((value) => /^\d+$/.test(value) && Number(value) >= 1, {
      message: 'Capacity must be a whole number of at least 1.',
    }),
  /**
   * The second bound (Phase 7). Blank means UNBOUND — a lecture-only intake — which
   * is a legitimate answer, not an omission: create omits the field. The schema's
   * ceiling of 10 000 is the server's to refuse; this refine only does what its
   * sibling `capacity` does.
   */
  workshopCapacity: z.string().trim().refine(isPlacesOrBlank, {
    message: 'Workshop places must be a whole number of at least 1.',
  }),
  startDate: z.string(),
  endDate: z.string(),
};

const formShape = z.object({
  code: z.string(),
  slug: z.string(),
  name: z
    .string()
    .trim()
    .min(3, 'Give the course a name of at least 3 characters')
    .max(160, 'Keep the name under 160 characters'),
  description: z.string().trim().max(5000, 'Keep the description under 5000 characters'),
  departmentId: z.string().min(1, 'Choose a department.'),
  teacherId: z.string(),
  durationValue: z
    .string()
    .trim()
    .refine((value) => /^\d+$/.test(value) && Number(value) >= 1, {
      message: 'Enter a whole number of at least 1.',
    }),
  durationUnit: durationUnitSchema,
  offerings: z.array(z.object(offeringRowShape)),
  /** The ladder rung. `''` is "none" — never sent on create, `null` on a clearing PATCH. */
  prerequisiteCourseId: z.string(),
  syllabus: z.instanceof(File).nullable(),
});

/** Digits only, and at least 1 — or nothing at all, which is the unbound answer. */
function isPlacesOrBlank(value: string): boolean {
  return value === '' || (/^\d+$/.test(value) && Number(value) >= 1);
}

type CourseFormValues = z.infer<typeof formShape>;

/** Per-row dirtiness for one intake row, as react-hook-form reports it. */
type DirtyOfferingRow = {
  readonly [P in keyof CourseFormValues['offerings'][number]]?: boolean;
};

/**
 * What react-hook-form reports as touched-and-changed. The `offerings` entry mirrors
 * RHF's per-row dirtiness (an array, one entry per row), which `toUpdate` never
 * reads — intake fields are not on the template PATCH.
 */
type DirtyCourseFields = {
  readonly [K in keyof CourseFormValues]?: K extends 'offerings'
    ? readonly (DirtyOfferingRow | undefined)[]
    : boolean;
};

/**
 * Create-only rules, applied by guarding rather than by building a second schema:
 * `code` must match the shared pattern, `slug` may be empty (the server derives it
 * from the name), and each intake's end date must come after its start. Each rule
 * APPENDS its own issue at a PER-ROW path — none of them may skip the ones after
 * it, or a form could carry one visible problem while hiding another on a field the
 * user already filled.
 */
function buildFormSchema(isEditing: boolean) {
  return formShape.superRefine((values, ctx) => {
    if (!isEditing) {
      const trimmedCode = values.code.trim();
      if (trimmedCode === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['code'],
          message: 'Enter a course code.',
        });
      } else {
        // The shared schema's own message ("Use a code like WELD-101.") travels with it.
        const code = courseCodeSchema.safeParse(trimmedCode);
        if (!code.success) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['code'],
            message: code.error.issues[0]?.message ?? 'Enter a course code.',
          });
        }
      }

      if (values.slug.trim() !== '') {
        const slug = slugSchema.safeParse(values.slug.trim());
        if (!slug.success) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['slug'],
            message: 'Lowercase words separated by single hyphens, e.g. welding-fundamentals.',
          });
        }
      }

      if (values.offerings.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['offerings'],
          message: 'Add at least one intake — dates and seats live on it.',
        });
      }
    }

    for (const [index, row] of values.offerings.entries()) {
      if (
        row.startDate !== '' &&
        row.endDate !== '' &&
        new Date(row.endDate).getTime() <= new Date(row.startDate).getTime()
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['offerings', index, 'endDate'],
          message: 'The end date must come after the start date.',
        });
      }
    }

    if (values.syllabus !== null) {
      // Size/type BEFORE any round trip — the same check-and-message the resource
      // dialog runs, against the SYLLABUS purpose's own limits.
      const problem = describeFileProblem(values.syllabus, 'SYLLABUS');
      if (problem) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['syllabus'], message: problem });
      }
    }
  });
}

/**
 * Server field paths mapped onto the control that owns them. Dot-joined paths
 * include `(root)`-style issues that name no control; those belong to the toast.
 * Intake paths (`offerings.0.capacity`) are NOT here: they already ARE react-hook-
 * form paths, and `onError` sets them verbatim.
 */
const FIELD_FOR_PATH: Readonly<Record<string, keyof CourseFormValues>> = {
  code: 'code',
  slug: 'slug',
  name: 'name',
  description: 'description',
  departmentId: 'departmentId',
  teacherId: 'teacherId',
  prerequisiteCourseId: 'prerequisiteCourseId',
  syllabusUploadId: 'syllabus',
  'duration.value': 'durationValue',
  'duration.unit': 'durationUnit',
};

/**
 * Radix `SelectItem` refuses an empty-string value, so the "None" choice travels
 * under a sentinel and is translated back to `''` — the form's unbound answer —
 * in `onValueChange`.
 */
const NO_PREREQUISITE = '__none__';

/** The served detail flattened into the controls this form owns. */
function toFormValues(detail: CourseDetail | undefined): CourseFormValues {
  return {
    code: detail?.code ?? '',
    slug: detail?.slug ?? '',
    name: detail?.name ?? '',
    description: detail?.description ?? '',
    departmentId: detail?.department.id ?? '',
    teacherId: detail?.teacher.id ?? '',
    durationValue: detail ? String(detail.duration.value) : '',
    durationUnit: detail?.duration.unit ?? 'WEEK',
    // Create starts with ONE empty intake row; edit seeds the served intakes so the
    // value shape matches even though the controls are not rendered on this path.
    offerings:
      detail === undefined
        ? [{ capacity: '', workshopCapacity: '', startDate: '', endDate: '' }]
        : detail.offerings.map((offering) => ({
            capacity: String(offering.capacity),
            workshopCapacity:
              offering.workshopCapacity !== null ? String(offering.workshopCapacity) : '',
            startDate: toDateTimeLocal(offering.startDate),
            endDate: toDateTimeLocal(offering.endDate),
          })),
    prerequisiteCourseId: detail?.prerequisiteCourseId ?? '',
    // A chosen file is always a NEW syllabus; the attached one cannot be read back
    // into a File object, and `syllabusUploadId` on the row says whether one exists.
    syllabus: null,
  };
}

/** Everything POST /courses carries except a syllabus upload id. */
function toCreate(
  values: CourseFormValues,
  isAdmin: boolean,
): Omit<CreateCourseInput, 'syllabusUploadId'> {
  return {
    code: values.code.trim().toUpperCase(),
    name: values.name.trim(),
    ...(values.slug.trim() === '' ? {} : { slug: values.slug.trim() }),
    ...(values.description === '' ? {} : { description: values.description.trim() }),
    departmentId: values.departmentId,
    // `teacherId` is an admin-only field (course.ts); a teacher always gets
    // themself, and an admin leaving it empty gets themself too (courses.service).
    ...(isAdmin && values.teacherId !== '' ? { teacherId: values.teacherId } : {}),
    duration: { value: Number(values.durationValue), unit: values.durationUnit },
    // One intake minimum — the schema's `.min(1)`; the form's own refine enforces it.
    offerings: values.offerings.map((row) => ({
      capacity: Number(row.capacity),
      // Omitted, not null — `createCourseOfferingInputSchema` has no bound at all
      // until given one.
      ...(row.workshopCapacity === '' ? {} : { workshopCapacity: Number(row.workshopCapacity) }),
      ...(row.startDate === '' ? {} : { startDate: toIso(row.startDate) }),
      ...(row.endDate === '' ? {} : { endDate: toIso(row.endDate) }),
    })),
    /*
     * NO `prerequisiteCourseId` here, deliberately: `createCourseSchema` does not
     * accept the field (packages/shared/src/schema/course.ts), so a control on this
     * path could only send a key the wire strips. The rung is set on the edit form,
     * where `updateCourseSchema` takes it — the same split as code/slug, pointed
     * the other way round.
     */
  };
}

/**
 * The PATCH body: only what actually changed. `description` is `.nullable()` there,
 * so an emptied box becomes `null` ("clear this") — the same translation
 * Settings.tsx makes, so saving a name can never blank a description. There is no
 * `code` and no `slug`: the schema accepts neither, and the form does not offer them
 * on this path.
 *
 * NO intake fields either, deliberately: since Phase 9 the template carries neither
 * seats nor dates. Retuning one happens through the course page's Intakes section
 * (PATCH /courses/:courseId/offerings/:offeringId), which is where the per-intake
 * facts are already on screen.
 */
function toUpdate(
  values: CourseFormValues,
  dirty: DirtyCourseFields,
  isAdmin: boolean,
): Omit<UpdateCourseInput, 'syllabusUploadId'> {
  return {
    ...(dirty.name ? { name: values.name.trim() } : {}),
    ...(dirty.description
      ? { description: values.description === '' ? null : values.description.trim() }
      : {}),
    ...(dirty.departmentId ? { departmentId: values.departmentId } : {}),
    ...(isAdmin && dirty.teacherId && values.teacherId !== ''
      ? { teacherId: values.teacherId }
      : {}),
    ...(dirty.durationValue || dirty.durationUnit
      ? {
          duration: {
            value: Number(values.durationValue),
            unit: values.durationUnit,
          },
        }
      : {}),
    // Same nullable contract as before: choosing "None" PATCHes explicit
    // null to clear the rung. The API refuses self-references and cycles with a
    // 422 on this path; `FIELD_FOR_PATH` lands that back on this control.
    ...(dirty.prerequisiteCourseId
      ? {
          prerequisiteCourseId:
            values.prerequisiteCourseId === '' ? null : values.prerequisiteCourseId,
        }
      : {}),
  };
}

/** Which half of a submit is running, for the live region and nothing else. */
type SubmitPhase = 'idle' | 'uploading' | 'saving';

type SubmitPlan =
  | { kind: 'create'; body: Omit<CreateCourseInput, 'syllabusUploadId'>; file: File | null }
  | {
      kind: 'update';
      id: string;
      body: Omit<UpdateCourseInput, 'syllabusUploadId'>;
      file: File | null;
    };

export interface CourseFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing an existing row; absent when creating. */
  course?: Pick<CourseDetail, 'id'> & Partial<Pick<CourseDetail, 'name' | 'code' | 'slug'>>;
}

export function CourseFormDialog({
  open,
  onOpenChange,
  course,
}: CourseFormDialogProps): ReactElement {
  const client = useQueryClient();
  const { user } = useSession();
  const isEditing = course !== undefined;

  /**
   * The list rows are summaries; the form needs the detail (description, dates,
   * syllabus id). Fetching HERE means every caller — admin table, teacher dashboard —
   * can hand over whatever row it has and let the dialog do the one GET itself.
   */
  const detail = useQuery({
    queryKey: qk.course(course?.id ?? ''),
    queryFn: () => api.get<CourseDetail>(`/courses/${String(course?.id)}`),
    enabled: open && isEditing,
  });

  /** Departments for the select. `department:list` allows every role. */
  const departments = useQuery({
    queryKey: ['departments', { limit: 200 }],
    queryFn: () => api.get<Paginated<DepartmentSummary>>('/departments', { query: { limit: 200 } }),
    enabled: open,
  });

  /**
   * Teachers for the select — an ADMIN concern only: `user:list` denies TEACHER and
   * STUDENT outright, and only an admin ever assigns a course's teacher anyway.
   */
  const isAdmin = user?.role === 'ADMIN';
  const teachers = useQuery({
    queryKey: qk.users({ role: 'TEACHER', limit: 200 }),
    queryFn: () =>
      // `GET /users` serves `paginated(userDetailSchema)` (users.routes.ts:75).
      api.get<Paginated<UserDetail>>('/users', {
        query: { role: 'TEACHER', limit: 200 },
      }),
    enabled: open && isAdmin,
  });

  /**
   * Candidate rungs for the prerequisite select — EDIT only, because the field
   * exists on `updateCourseSchema` alone. Every course the viewer can see is a
   * candidate; the one being edited is filtered out at render, and anything else
   * the API refuses (unknown id, a cycle) comes back as a 422 on
   * `prerequisiteCourseId` and lands on the control through `FIELD_FOR_PATH`.
   */
  const courses = useQuery({
    queryKey: qk.courses({ limit: 200 }),
    queryFn: () => api.get<Paginated<CourseListItem>>('/courses', { query: { limit: 200 } }),
    enabled: open && isEditing,
  });

  const formId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<SubmitPhase>('idle');
  /** The upload that already reached the store, so a failed save is not paid twice. */
  const uploadedRef = useRef<{ file: File; uploaded: UploadedFile } | null>(null);

  const loadedDetail = detail.data;
  const schema = useMemo(() => buildFormSchema(isEditing), [isEditing]);
  const form = useForm<CourseFormValues>({
    resolver: zodResolver(schema),
    defaultValues: toFormValues(undefined),
  });
  // The intake rows. `fields` carries the stable per-row keys remounts are keyed on;
  // append/remove are the only two mutations a create needs.
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'offerings' });
  const { clearErrors, reset, setError, setValue } = form;

  /**
   * Seed once per opening AND once per arrival of the detail. Keyed on "which dialog
   * session + which fetched row", a background refetch of the same contents is a
   * no-op, while the moment the detail lands the controls fill.
   */
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    const seed = open ? `${course?.id ?? 'new'}:${loadedDetail?.updatedAt ?? ''}` : null;
    if (seededFor.current === seed) return;
    if (open && isEditing && !loadedDetail) return; // still fetching — nothing to seed from
    seededFor.current = seed;
    if (!open) return;
    reset(toFormValues(loadedDetail));
    setPhase('idle');
    uploadedRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [open, course?.id, isEditing, loadedDetail, reset]);

  const save = useMutation({
    mutationFn: async (plan: SubmitPlan): Promise<CourseDetail> => {
      let syllabusUploadId: string | undefined;
      if (plan.file) {
        /*
         * Remembered across retries keyed on the File, exactly as ResourceFormDialog
         * does: a PATCH failing after a successful commit must not orphan another
         * upload when the user retries unchanged.
         */
        if (uploadedRef.current?.file !== plan.file) {
          setPhase('uploading');
          uploadedRef.current = {
            file: plan.file,
            uploaded: await uploadFile(plan.file, 'SYLLABUS'),
          };
        }
        syllabusUploadId = uploadedRef.current.uploaded.uploadId;
      }

      setPhase('saving');
      if (plan.kind === 'update') {
        return api.patch<CourseDetail>(`/courses/${plan.id}`, {
          ...plan.body,
          ...(syllabusUploadId !== undefined ? { syllabusUploadId } : {}),
        });
      }
      return api.post<CourseDetail>('/courses', {
        ...plan.body,
        ...(syllabusUploadId !== undefined ? { syllabusUploadId } : {}),
      });
    },
    onSuccess: async (saved) => {
      toast.success(isEditing ? 'Course updated' : 'Course added', {
        description: saved.publishedAt
          ? 'It is visible to everyone who can see the catalogue.'
          : 'It starts unpublished — publish it when it is ready.',
      });
      onOpenChange(false);
      await client.invalidateQueries({ queryKey: ['courses'] });
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        for (const [path, message] of Object.entries(error.byField)) {
          // Intake paths (`offerings.0.capacity`) already ARE react-hook-form paths —
          // set verbatim. Everything else goes through the flat map above.
          if (path.startsWith('offerings.')) {
            setError(path as Path<CourseFormValues>, { message });
            continue;
          }
          const field = FIELD_FOR_PATH[path];
          if (field) setError(field, { message });
        }
      }
      if (isUploadFailure(error)) {
        toast(error.message, { tone: 'danger' });
        return;
      }
      toast.fromError(
        error,
        isEditing ? 'Could not save those changes' : 'Could not add the course',
      );
    },
    onSettled: () => setPhase('idle'),
  });

  // Read DURING RENDER on purpose — `formState` is a proxy (see ResourceFormDialog).
  const { dirtyFields, errors, isDirty } = form.formState;

  const locked = save.isPending || (isEditing && open && detail.isPending);

  const statusMessage =
    phase === 'uploading'
      ? `Uploading ${form.watch('syllabus')?.name ?? 'the syllabus'}. A large file can take a while — leave this open.`
      : phase === 'saving'
        ? isEditing
          ? 'Saving your changes.'
          : 'Saving the course.'
        : '';

  return (
    <Dialog open={open} onOpenChange={(next) => !locked && onOpenChange(next)}>
      <DialogContent
        dismissible={!locked}
        title={isEditing ? 'Edit course' : 'Add a course'}
        description={
          isEditing
            ? 'The details of the course. Its code and web address cannot change, and its intakes are managed on the course page.'
            : 'New courses start unpublished — publish from the courses list when ready.'
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
              {isEditing ? 'Save changes' : 'Add course'}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          className="flex flex-col gap-4"
          noValidate
          onSubmit={form.handleSubmit(
            (values) => {
              if (course) {
                const body = toUpdate(values, dirtyFields, isAdmin);
                const changed = Object.keys(body).length > 0 || values.syllabus !== null;
                // `updateCourseSchema` refuses an empty body; save is already disabled
                // until something is dirty — this is the second lock.
                if (!changed) return;
                save.mutate({ kind: 'update', id: course.id, body, file: values.syllabus });
                return;
              }
              save.mutate({
                kind: 'create',
                body: toCreate(values, isAdmin),
                file: values.syllabus,
              });
            },
            (invalid) => {
              // A blocked submit must focus the control whose error is on screen so a
              // screen reader announces it (same arrangement as ResourceFormDialog).
              if (invalid.syllabus && fileInputRef.current) fileInputRef.current.focus();
            },
          )}
        >
          {/*
            Code and slug are CREATE-ONLY: `updateCourseSchema` accepts neither, so the
            edit form shows them as facts rather than offering inputs that could only
            ever produce a 422.
          */}
          {isEditing ? (
            <div className="flex flex-col gap-0.5 rounded-md border border-line-subtle bg-sunken px-3 py-2.5">
              <span className="text-xs font-medium text-fg-secondary">Identifier</span>
              <span className="text-sm text-fg">
                {(loadedDetail ?? course).code ?? ''}
                {(loadedDetail ?? course).code ? ' · ' : ''}
                {loadedDetail?.slug}
              </span>
              <span className="text-xs text-fg-tertiary">
                The code and web address identify the course and cannot change after creation.
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                label="Code"
                required
                hint="Uppercase letters, a hyphen, then digits."
                error={errors.code?.message}
              >
                <Input
                  autoComplete="off"
                  placeholder="WELD-101"
                  spellCheck={false}
                  disabled={locked}
                  {...form.register('code')}
                />
              </FormField>
              <FormField
                label="Web address"
                hint={`Optional — derived from the name. Lowercase words separated by single hyphens.`}
                error={errors.slug?.message}
              >
                <Input
                  autoComplete="off"
                  placeholder="welding-fundamentals"
                  spellCheck={false}
                  disabled={locked}
                  {...form.register('slug')}
                />
              </FormField>
            </div>
          )}

          <FormField label="Name" required error={errors.name?.message}>
            <Input
              autoComplete="off"
              placeholder="Welding Fundamentals"
              disabled={locked}
              {...form.register('name')}
            />
          </FormField>

          <FormField
            label="Description"
            hint="Optional. What the course covers, and for whom."
            error={errors.description?.message}
          >
            <Textarea autoResize rows={3} disabled={locked} {...form.register('description')} />
          </FormField>

          <FormField label="Department" required error={errors.departmentId?.message}>
            <Select
              value={form.watch('departmentId') || undefined}
              disabled={locked}
              onValueChange={(next) =>
                setValue('departmentId', next, { shouldValidate: true, shouldDirty: true })
              }
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

          {isAdmin ? (
            <FormField
              label="Teacher"
              hint={
                isEditing
                  ? 'Optional — leave unchanged unless handing the course over.'
                  : 'Optional — defaults to you.'
              }
              error={errors.teacherId?.message}
            >
              <Select
                value={form.watch('teacherId') || undefined}
                disabled={locked}
                onValueChange={(next) =>
                  setValue('teacherId', next, { shouldValidate: true, shouldDirty: true })
                }
              >
                <SelectTrigger placeholder={isEditing ? 'Leave unchanged' : 'You'} />
                <SelectContent>
                  {(teachers.data?.data ?? []).map((teacher) => (
                    <SelectItem key={teacher.id} value={teacher.id}>
                      {teacher.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          ) : null}

          {/*
            EDIT-ONLY, and not as an oversight: `createCourseSchema` accepts no
            `prerequisiteCourseId`, so a create-time control could only produce
            requests whose answer silently ignores it. The API refuses a self-rung
            and a cyclic one with a 422 on this same path — the self option is
            filtered out here because it is knowable, while cycles are not (they
            depend on every other course's rung), so those stay the server's call.
          */}
          {isEditing ? (
            <FormField
              label="Prerequisite"
              hint="Optional — students need an approved seat in that course before they can enrol in this one."
              error={errors.prerequisiteCourseId?.message}
            >
              <Select
                value={form.watch('prerequisiteCourseId') || NO_PREREQUISITE}
                disabled={locked}
                onValueChange={(next) =>
                  setValue(
                    'prerequisiteCourseId',
                    next === NO_PREREQUISITE ? '' : next,
                    // Dirtying here is what lets "changed nothing else" saves still
                    // clear or set the rung; validation runs for the same reason.
                    { shouldValidate: true, shouldDirty: true },
                  )
                }
              >
                <SelectTrigger placeholder="None" />
                <SelectContent>
                  <SelectItem value={NO_PREREQUISITE}>None</SelectItem>
                  {(courses.data?.data ?? [])
                    .filter((option) => option.id !== course?.id)
                    .map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.name} ({option.code})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </FormField>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField label="Duration" required error={errors.durationValue?.message}>
              <div className="flex gap-2">
                <Input
                  inputMode="numeric"
                  placeholder="6"
                  disabled={locked}
                  {...form.register('durationValue')}
                />
                <Select
                  value={form.watch('durationUnit')}
                  disabled={locked}
                  onValueChange={(next) => {
                    const parsed = durationUnitSchema.safeParse(next);
                    if (!parsed.success) return;
                    setValue('durationUnit', parsed.data, {
                      shouldValidate: true,
                      shouldDirty: true,
                    });
                  }}
                >
                  <SelectTrigger aria-label="Duration unit" className="w-28 shrink-0" />
                  <SelectContent>
                    {durationUnitSchema.options.map((unit) => (
                      <SelectItem key={unit} value={unit}>
                        {UNIT_LABEL[unit]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </FormField>
          </div>

          {/*
            CREATE ONLY, and not as an oversight: since Phase 9 the template carries
            neither seats nor dates. A course is created WITH its first intake(s)
            (`createCourseSchema` takes `.min(1)`); retuning one later means PATCH
            /courses/:courseId/offerings/:offeringId, offered inline on the course
            page's Intakes section — where each row's seats are already on screen.
          */}
          {!isEditing ? (
            <section className="flex flex-col gap-3 rounded-md border border-line-subtle p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">Intakes</span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  leadingIcon={<Plus aria-hidden="true" className="size-4" />}
                  disabled={locked}
                  onClick={() =>
                    append({ capacity: '', workshopCapacity: '', startDate: '', endDate: '' })
                  }
                >
                  Add another intake
                </Button>
              </div>

              {fields.map((field, index) => (
                <fieldset
                  key={field.id}
                  className="relative flex flex-col gap-3 rounded-md bg-sunken p-3"
                >
                  <legend className="sr-only">Intake {index + 1}</legend>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <FormField
                      label={`Places (intake ${index + 1})`}
                      required
                      error={errors.offerings?.[index]?.capacity?.message}
                    >
                      <Input
                        inputMode="numeric"
                        placeholder="12"
                        disabled={locked}
                        {...form.register(`offerings.${index}.capacity` as const)}
                      />
                    </FormField>
                    <FormField
                      label={`Workshop places (intake ${index + 1})`}
                      hint="Optional — leave empty for lecture-only runs."
                      error={errors.offerings?.[index]?.workshopCapacity?.message}
                    >
                      <Input
                        inputMode="numeric"
                        placeholder="None"
                        disabled={locked}
                        {...form.register(`offerings.${index}.workshopCapacity` as const)}
                      />
                    </FormField>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <FormField
                      label={`Starts (intake ${index + 1})`}
                      hint="Optional."
                      error={errors.offerings?.[index]?.startDate?.message}
                    >
                      <Input
                        type="datetime-local"
                        disabled={locked}
                        {...form.register(`offerings.${index}.startDate` as const)}
                      />
                    </FormField>
                    <FormField
                      label={`Ends (intake ${index + 1})`}
                      hint="Optional — after the start."
                      error={errors.offerings?.[index]?.endDate?.message}
                    >
                      <Input
                        type="datetime-local"
                        disabled={locked}
                        {...form.register(`offerings.${index}.endDate` as const)}
                      />
                    </FormField>
                  </div>
                  {fields.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="self-end"
                      disabled={locked}
                      onClick={() => remove(index)}
                    >
                      Remove this intake
                    </Button>
                  ) : null}
                </fieldset>
              ))}

              {(() => {
                // The `.min(1)` issue lands ON `offerings` itself; a FieldArray's
                // error may surface as root or as the object's own message.
                const arrayError = errors.offerings;
                const message =
                  typeof arrayError?.message === 'string'
                    ? arrayError.message
                    : arrayError?.root?.message;
                return typeof message === 'string' && message !== '' ? (
                  <p role="status" className="text-xs text-danger-fg">
                    {message}
                  </p>
                ) : null;
              })()}
            </section>
          ) : (
            <p className="rounded-md border border-line-subtle bg-sunken px-3 py-2.5 text-xs text-fg-secondary">
              Intakes — dates, places and workshop bounds — are managed on the course page, in the
              Intakes section.
            </p>
          )}

          <FormField
            label="Syllabus"
            hint={`Optional. Accepted: ${ACCEPTED_TYPES}. Up to ${formatBytes(SYLLABUS_LIMITS.maxBytes)}.`}
            error={errors.syllabus?.message}
          >
            <SyllabusFileInput
              inputRef={fileInputRef}
              disabled={locked}
              onFileChange={(file) => {
                clearErrors('syllabus');
                setValue('syllabus', file, { shouldValidate: true, shouldDirty: true });
              }}
            />
          </FormField>

          {isEditing && loadedDetail?.syllabusUploadId != null ? (
            <p className="text-xs text-fg-tertiary">
              A syllabus is attached. Choosing a file replaces it.
            </p>
          ) : null}

          {/*
            Mounted whether or not it has anything to say — a live region that appears
            together with its first message is frequently missed entirely.
          */}
          <p
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="text-xs text-fg-secondary"
          >
            {statusMessage}
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface SyllabusFileInputProps {
  inputRef: RefObject<HTMLInputElement | null>;
  disabled: boolean;
  onFileChange: (file: File | null) => void;
}

/**
 * A native file input wired into its FormField — same shape as the resource
 * dialog's picker, against the SYLLABUS limits. Starts from `controlBase` so the
 * focus treatment is the one declaration every other control uses.
 */
function SyllabusFileInput({
  inputRef,
  disabled,
  onFileChange,
}: SyllabusFileInputProps): ReactElement {
  const wired = useFieldControlProps({});
  return (
    <input
      ref={inputRef}
      type="file"
      accept={ACCEPT_ATTRIBUTE}
      disabled={disabled}
      onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
      className={cn(
        controlBase,
        'min-h-[var(--control-height-md)] border-[var(--control-border)] px-3 py-2 text-base md:text-sm',
        'file:me-3 file:rounded-md file:border-0 file:bg-surface file:px-3 file:py-1.5',
        'file:text-sm file:font-medium file:text-fg',
        'disabled:file:text-fg-disabled',
      )}
      {...wired}
    />
  );
}
