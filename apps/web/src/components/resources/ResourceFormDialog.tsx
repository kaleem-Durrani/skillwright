import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
/**
 * `resourceTypeSchema` and `UPLOAD_LIMITS` are schema VALUES, so they come straight
 * from the shared specifier rather than through `@/lib/types` — that file is an
 * `export type` barrel and re-exporting a value through it would turn it into a
 * runtime module (lib/types.ts, the "Import the schema VALUES ... at the point of
 * use" paragraph).
 *
 * `CreateResourceInput` / `UpdateResourceInput` are the two WIRE bodies this dialog
 * builds. They are not among the shapes `@/lib/types` re-exports — it carries the
 * DTOs a screen renders, not the inputs a form posts — so they come from the same
 * specifier, which is still the one declaration of each.
 */
import {
  resourceTypeSchema,
  UPLOAD_LIMITS,
  type CreateResourceInput,
  type UpdateResourceInput,
} from '@skillwright/shared/schema';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/format';
import { ApiError } from '@/lib/problem';
import { qk } from '@/lib/query';
import type { ResourceDto, ResourceTypeValue } from '@/lib/types';
import { describeFileProblem, isUploadFailure, uploadFile, type UploadedFile } from '@/lib/uploads';
import { acceptedTypesSentence, MIME_LABEL } from '@/components/uploads/fileCopy';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { FormField, useFieldControlProps } from '@/components/ui/FormField';
import { controlBase, Input } from '@/components/ui/Input';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { toast } from '@/components/ui/Toast';

/**
 * The one set of limits this form describes. Read from `UPLOAD_LIMITS` rather than
 * restated, so raising the RESOURCE ceiling in `schema/upload.ts` changes the
 * sentence under the picker in the same commit.
 */
const RESOURCE_LIMITS = UPLOAD_LIMITS.RESOURCE;

const ACCEPTED_TYPES = acceptedTypesSentence(RESOURCE_LIMITS.mimeTypes);

/**
 * `accept` is a CHOOSER FILTER, not a check. Every browser offers an "All files"
 * escape from it, and a file picked that way still reaches `onChange`. The real
 * client-side answer is `describeFileProblem`, which the resolver below runs on every
 * selection; the enforcement is the server and the object store (LESSONS-LEARNED #32).
 */
const ACCEPT_ATTRIBUTE = RESOURCE_LIMITS.mimeTypes.join(',');

const TYPE_LABEL: Record<ResourceTypeValue, string> = {
  DOCUMENT: 'Document',
  VIDEO: 'Video',
  LINK: 'Link',
};

const TYPE_HINT: Record<ResourceTypeValue, string> = {
  DOCUMENT: 'Notes, slides, a spreadsheet — a file you upload.',
  VIDEO: 'A video file you upload.',
  LINK: 'A web address. Nothing is uploaded.',
};

/**
 * Mirrors `createResourceSchema.externalUrl` — `z.string().url().max(2048)` in
 * schema/resource.ts — so the client refuses exactly the strings the API refuses. It
 * is restated rather than imported because `createResourceSchema` is a `ZodEffects`
 * (it carries `exactlyOneSource`), and a `ZodEffects` has no `.shape` to reach the
 * field through.
 */
const externalUrlSchema = z.string().url().max(2048);

/**
 * The FORM's shape, which is deliberately not either wire shape.
 *
 * Every text control is a string, so an untouched or emptied box is `''` — never
 * `null`, never `undefined`. `file` is the one non-string, and it lives in
 * react-hook-form rather than in its own `useState` so that the file's validation
 * message travels the same path as every other field's: the resolver produces it,
 * `FormField` associates it with the control, and `setError('file', …)` is how a
 * server field error lands on it.
 *
 * `toCreateBase` / `toUpdate` below are the only places the form shape and the wire
 * shapes meet.
 */
const formShape = z.object({
  title: z
    .string()
    .trim()
    .min(2, 'Give this resource a title of at least 2 characters')
    .max(200, 'Keep the title under 200 characters'),
  description: z.string().trim().max(5000, 'Keep the description under 5000 characters'),
  type: resourceTypeSchema,
  isPublic: z.boolean(),
  externalUrl: z
    .string()
    .trim()
    .refine((value) => value === '' || externalUrlSchema.safeParse(value).success, {
      message: 'Enter a full web address, including https://',
    }),
  file: z.instanceof(File).nullable(),
});

type ResourceFormValues = z.infer<typeof formShape>;

/** What react-hook-form reports as touched-and-changed, for this flat form. */
type DirtyResourceFields = { readonly [K in keyof ResourceFormValues]?: boolean };

/**
 * The source rules only apply when CREATING.
 *
 * `updateResourceSchema` has no `uploadId` and this dialog offers no URL box on an
 * edit, so on that path there is no source to validate: whichever source the row was
 * created with is the source it keeps. Guarding the refinement rather than building a
 * second schema keeps ONE value type for the form, which is what lets `reset` and
 * `dirtyFields` behave identically on both paths.
 */
function buildFormSchema(isEditing: boolean) {
  return formShape.superRefine((values, ctx) => {
    if (isEditing) return;

    if (values.type === 'LINK') {
      if (values.externalUrl === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['externalUrl'],
          message: 'A link resource needs a web address.',
        });
      }
      return;
    }

    if (values.file === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['file'],
        message: 'Choose a file to upload.',
      });
      return;
    }

    // The size and type check the user gets BEFORE a round trip. It runs here rather
    // than in the change handler so one code path produces the message whether the
    // file was just picked (`setValue(… { shouldValidate: true })`) or the form was
    // submitted with a stale one.
    const problem = describeFileProblem(values.file, 'RESOURCE');
    if (problem) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['file'], message: problem });
    }
  });
}

/**
 * Server field paths mapped onto the control that owns them.
 *
 * The paths are dot-joined zod paths and include `(root)` for whole-body refinements,
 * so only the ones naming a control may be handed to `setError`; the rest belong in
 * the toast. `uploadId` is in the list because `createResourceSchema`'s
 * `exactlyOneSource` refinement reports on that path, and the only control behind it
 * on this form is the file picker.
 */
const FIELD_FOR_PATH: Readonly<Record<string, keyof ResourceFormValues>> = {
  title: 'title',
  description: 'description',
  type: 'type',
  isPublic: 'isPublic',
  externalUrl: 'externalUrl',
  uploadId: 'file',
};

/** The served row, flattened into the controls this form owns. */
function toFormValues(resource: ResourceDto | undefined): ResourceFormValues {
  if (!resource) {
    return {
      title: '',
      description: '',
      type: 'DOCUMENT',
      isPublic: false,
      externalUrl: '',
      file: null,
    };
  }
  return {
    title: resource.title,
    description: resource.description ?? '',
    type: resource.type,
    isPublic: resource.isPublic,
    externalUrl: resource.externalUrl ?? '',
    // Never seeded, and there is no control that could change it: an edit alters
    // metadata only. See the read-only panel in the edit branch below.
    file: null,
  };
}

/** Everything a POST /resources body carries except the source (`uploadId`). */
type CreateBase = Omit<CreateResourceInput, 'uploadId'>;

function toCreateBase(values: ResourceFormValues, courseId: string): CreateBase {
  return {
    courseId,
    title: values.title,
    // `description` is `.optional()` on the create schema, so an empty box means the
    // key is ABSENT rather than a stored empty string.
    ...(values.description === '' ? {} : { description: values.description }),
    type: values.type,
    isPublic: values.isPublic,
  };
}

/**
 * The PATCH body: only what the user actually changed.
 *
 * `updateResourceSchema` refuses `{}` outright, which is why the submit button stays
 * disabled until something is dirty and why `handleSubmit` checks again.
 * `description` is `.nullable()` there, so `''` becomes `null` ("clear this") — the
 * same translation `Settings.tsx`'s `toUpdate` makes for `phoneNumber` and `bio`, and
 * for the same reason: a field the user never touched is omitted, so saving a title
 * can never blank a description.
 *
 * There is no `uploadId` and no `externalUrl` here. The first does not exist on
 * `updateResourceSchema` at all; the second the API guards separately
 * (`assertSourceStaysCoherent` in resources.service.ts), and this dialog does not
 * offer the control.
 */
function toUpdate(values: ResourceFormValues, dirty: DirtyResourceFields): UpdateResourceInput {
  return {
    ...(dirty.title ? { title: values.title } : {}),
    ...(dirty.description
      ? { description: values.description === '' ? null : values.description }
      : {}),
    ...(dirty.type ? { type: values.type } : {}),
    ...(dirty.isPublic ? { isPublic: values.isPublic } : {}),
  };
}

/**
 * What the row's stored file can be described as, given only what the wire serves.
 *
 * `resourceSchema` carries `contentType` and `sizeBytes` and NO filename: the
 * `originalName` column exists on `Upload` but the resource DTO never maps it
 * (`toResourceDto` in resources.service.ts), and the only endpoint that returns it is
 * `GET /resources/:id/download` — which mints a signed URL as a side effect and is
 * gated on `resource:download`, so calling it to label a read-only line would be both
 * wasteful and wrong. Adding `originalName` to `resourceSchema` and its mapper is a
 * one-commit fix; until someone spends it, this says what is actually known rather
 * than inventing a name.
 */
function describeStoredFile(resource: ResourceDto): string {
  const type = resource.contentType
    ? (MIME_LABEL[resource.contentType] ?? resource.contentType)
    : null;
  const size = resource.sizeBytes === null ? null : formatBytes(resource.sizeBytes);
  const parts = [type, size].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(' · ') : 'An uploaded file';
}

/** Which half of a create is running, for the live region and nothing else. */
type SubmitPhase = 'idle' | 'uploading' | 'saving';

/**
 * The work one submit does, decided while `dirtyFields` is still subscribed and handed
 * to the mutation whole.
 *
 * WHY a plan object rather than reading the form inside `mutationFn`: `formState` is a
 * proxy, and a key nobody reads DURING RENDER is neither tracked nor re-rendered on.
 * Sampling `dirtyFields` from inside a callback is how a PATCH ends up carrying fields
 * the user never touched.
 */
type SubmitPlan =
  | { kind: 'link'; body: CreateResourceInput }
  | { kind: 'upload'; file: File; base: CreateBase }
  | { kind: 'update'; id: string; body: UpdateResourceInput };

export interface ResourceFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseId: string;
  /** Present when editing an existing row; absent when creating. */
  resource?: ResourceDto;
}

export function ResourceFormDialog({
  open,
  onOpenChange,
  courseId,
  resource,
}: ResourceFormDialogProps): ReactElement {
  const client = useQueryClient();
  const isEditing = resource !== undefined;
  /*
   * The file behind a row is fixed at creation, so LINK is not a state an
   * upload-backed row can be moved into: the API answers that patch 422 on the `type`
   * path (`assertSourceStaysCoherent` in resources.service.ts). The option is disabled
   * rather than removed so the reason is readable instead of the choice silently
   * missing.
   */
  const isUploadBacked = resource?.uploadId != null;

  const formId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<SubmitPhase>('idle');
  /** The upload that already reached the store, so a failed POST is not paid for twice. */
  const uploadedRef = useRef<{ file: File; uploaded: UploadedFile } | null>(null);

  const schema = useMemo(() => buildFormSchema(isEditing), [isEditing]);
  const form = useForm<ResourceFormValues>({
    resolver: zodResolver(schema),
    defaultValues: toFormValues(resource),
  });
  const { clearErrors, reset, setError, setValue } = form;

  /**
   * Seed the controls once per opening, not once per render of the row.
   *
   * The ref is the whole point. `resource` is a query row, so a background refetch
   * hands this component a NEW object with the same contents; an effect keyed on the
   * object itself would then reset the form under someone mid-edit. Keyed on "which
   * thing is this dialog open for", a refetch is a no-op and a genuine switch from one
   * row to another still re-seeds.
   *
   * The native file input is cleared by hand: its value lives in the DOM, not in
   * react-hook-form, so `reset` cannot reach the filename the chooser is displaying.
   */
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    const seed = open ? (resource?.id ?? 'new') : null;
    if (seededFor.current === seed) return;
    seededFor.current = seed;
    if (!open) return;
    reset(toFormValues(resource));
    setPhase('idle');
    // A remembered upload belongs to the dialog session that produced it. Carrying one
    // into the next open would attach the previous file to a different resource.
    uploadedRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [open, resource, reset]);

  const save = useMutation({
    mutationFn: async (plan: SubmitPlan): Promise<ResourceDto> => {
      if (plan.kind === 'update') {
        setPhase('saving');
        // The route answers 200 with the updated `resourceSchema` row; the declared
        // type is the served one so it cannot quietly become a lie.
        return api.patch<ResourceDto>(`/resources/${plan.id}`, plan.body);
      }
      if (plan.kind === 'link') {
        setPhase('saving');
        return api.post<ResourceDto>('/resources', plan.body);
      }

      /*
       * presign -> PUT -> commit happens first, and only a COMMITTED upload id is
       * posted. If the PUT throws, `uploadFile` rethrows and this function never
       * reaches the POST. That trade is deliberate but not free: a resource row
       * pointing at bytes that never arrived is permanent and visible, whereas a
       * failed upload leaves a PENDING row that nothing sweeps yet — the job is named
       * in uploads.service.ts and does not exist (NEXT.md records it).
       *
       * There is no byte-level progress bar, and that is a decision rather than an
       * omission: `fetch` exposes no upload-progress event at all, and moving the PUT
       * onto XHR to get one is a change to `lib/uploads.ts` and its contract, not to
       * this dialog. A bar that animates on a timer instead of on bytes is worse than
       * no bar, so the live region below names the step that is running and nothing
       * more.
       */
      /*
       * Remembered across retries, keyed on the File object itself.
       *
       * Without this, a POST that fails AFTER a successful commit — a 409 on a
       * duplicate title, a session that expired during a long PUT — orphans a
       * COMMITTED upload and its bytes, and pressing the button again orphans another
       * set. The user sees one failure and the bucket grows by one file each time.
       * Nothing sweeps them.
       *
       * Keyed on the File and not on a boolean, so choosing a DIFFERENT file after a
       * failure uploads the new one rather than silently attaching the old.
       */
      if (uploadedRef.current?.file !== plan.file) {
        setPhase('uploading');
        uploadedRef.current = {
          file: plan.file,
          uploaded: await uploadFile(plan.file, 'RESOURCE'),
        };
      }
      setPhase('saving');
      return api.post<ResourceDto>('/resources', {
        ...plan.base,
        uploadId: uploadedRef.current.uploaded.uploadId,
      });
    },
    onSuccess: async (saved) => {
      toast.success(isEditing ? 'Resource updated' : 'Resource added', {
        description: saved.isPublic
          ? 'It is visible to anyone who can see this course.'
          : 'It is visible to approved students, the course teacher and administrators.',
      });
      onOpenChange(false);
      await Promise.all([
        client.invalidateQueries({ queryKey: qk.courseResources(courseId) }),
        // `courseDetailSchema.resourceCount` is served WITH the course and is not
        // counted on the client, so the course header stays stale unless this key is
        // swept too. It is named rather than left to the resource key's prefix, so the
        // sweep still happens if the two keys ever stop nesting.
        client.invalidateQueries({ queryKey: qk.course(courseId) }),
      ]);
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        for (const [path, message] of Object.entries(error.byField)) {
          const field = FIELD_FOR_PATH[path];
          if (field) setError(field, { message });
        }
      }
      const fallback = isEditing ? 'Could not save those changes' : 'Could not add that resource';

      /*
       * An upload failure carries a sentence written for this user — "that link has
       * expired", "the file could not be sent" — and `toast.fromError` would have
       * replaced every one of them with the generic fallback above, because it only
       * trusts `ApiError.userMessage` and is right not to trust an arbitrary
       * `Error.message`. So the one error type whose message IS user copy is shown
       * directly, and everything else keeps the safe path.
       */
      if (isUploadFailure(error)) {
        toast(error.message, { tone: 'danger' });
        return;
      }

      // Toasted even when a field error was mapped: a `(root)` issue, a 403, or a PUT
      // that never reached our API names no control and would otherwise fail silently.
      // Same arrangement as Settings.tsx's profile save.
      toast.fromError(error, fallback);
    },
    onSettled: () => setPhase('idle'),
  });

  // Read DURING RENDER on purpose: `formState` is a proxy and subscribes only to the
  // keys read while rendering. `dirtyFields` decides what the PATCH carries.
  const { dirtyFields, errors, isDirty } = form.formState;

  const type = form.watch('type');
  const isPublic = form.watch('isPublic');
  const selectedFile = form.watch('file');
  const needsFile = !isEditing && type !== 'LINK';
  const needsUrl = !isEditing && type === 'LINK';

  /**
   * Locked for the WHOLE submit, not only for the PUT.
   *
   * The state worth preventing is a committed upload with no row pointing at it, and
   * that window does not close when the bytes land — it closes when the POST resolves.
   * Dismissal is refused here, at the controlled `open` prop, rather than by hiding
   * the close button alone: this is the one place that also catches Escape and a click
   * on the overlay, neither of which `dismissible` reaches.
   */
  const locked = save.isPending;

  const statusMessage =
    phase === 'uploading'
      ? `Uploading ${selectedFile?.name ?? 'your file'}. A large file can take a while — leave this open.`
      : phase === 'saving'
        ? isEditing
          ? 'Saving your changes.'
          : 'Saving the resource.'
        : '';

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
        title={isEditing ? 'Edit resource' : 'Add a resource'}
        description={
          isEditing
            ? 'Changes the title, description, type and who can see it. Whatever is behind it stays as it is.'
            : 'It appears on this course’s Resources tab as soon as it is saved.'
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
              // is associated by id. That association is also what makes Enter in a
              // text input submit the form rather than doing nothing.
              type="submit"
              form={formId}
              block
              className="sm:w-auto"
              loading={save.isPending}
              disabled={isEditing && !isDirty}
            >
              {isEditing ? 'Save changes' : 'Add resource'}
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
              if (resource) {
                const body = toUpdate(values, dirtyFields);
                // `updateResourceSchema` refuses an empty body. Save is already disabled
                // until something is dirty; this is the second lock.
                if (Object.keys(body).length === 0) return;
                save.mutate({ kind: 'update', id: resource.id, body });
                return;
              }

              const base = toCreateBase(values, courseId);
              if (values.type === 'LINK') {
                save.mutate({ kind: 'link', body: { ...base, externalUrl: values.externalUrl } });
                return;
              }
              // Non-null by construction: the resolver refuses a create of this type with
              // no file, so `handleSubmit` never reaches here with `file === null`. The
              // check exists because the compiler cannot read the refinement, and a
              // non-null assertion is not allowed in this repository.
              if (values.file === null) return;
              save.mutate({ kind: 'upload', file: values.file, base });
            },
            /*
             * A blocked submit must CHANGE something, or it is silent.
             *
             * The file field is validated the moment a file is chosen, so its message
             * is already on screen by the time the button is pressed: nothing in the
             * DOM changes, no live region updates, and a screen-reader user gets no
             * feedback that the submit was refused or why. react-hook-form's own
             * `shouldFocusError` cannot help — it focuses the first REGISTERED field,
             * and the file input is held through `setValue` rather than `register`
             * because a native file input's value lives in the DOM and cannot be
             * controlled.
             *
             * So focus is moved by hand to the control that is blocking. Moving focus
             * onto a control whose `aria-describedby` names the error is what makes
             * the error be read.
             */
            (invalid) => {
              if (invalid.file && fileInputRef.current) fileInputRef.current.focus();
            },
          )}
        >
          <FormField label="Title" required error={errors.title?.message}>
            <Input
              autoComplete="off"
              placeholder="Week 3 lecture slides"
              disabled={locked}
              {...form.register('title')}
            />
          </FormField>

          <FormField
            label="Description"
            hint="Optional. What it is, and when to read it."
            error={errors.description?.message}
          >
            <Textarea autoResize rows={3} disabled={locked} {...form.register('description')} />
          </FormField>

          <FormField
            label="Type"
            required
            error={errors.type?.message}
            /*
             * The reason LINK is unavailable lives HERE, not on the disabled option.
             * Radix Select skips disabled items in arrow-key, Home/End and typeahead
             * navigation, so a hint attached to one is unreachable by keyboard and
             * unread by a screen reader — which defeats the entire point of disabling
             * the option rather than removing it. On the field, it is in
             * `aria-describedby` and is read when the control takes focus.
             */
            {...(isUploadBacked
              ? {
                  hint: 'This resource is backed by an uploaded file, so it cannot become a link. The file behind a resource cannot be swapped.',
                }
              : {})}
          >
            <Select
              value={type}
              disabled={locked}
              onValueChange={(next) => {
                // `resourceTypeSchema` narrows the string Radix hands back. A cast would
                // compile just as well and would become a lie the moment the enum gains
                // a member.
                const parsed = resourceTypeSchema.safeParse(next);
                if (!parsed.success) return;
                setValue('type', parsed.data, { shouldValidate: true, shouldDirty: true });
                // The two source controls swap when the type changes, and `setValue`
                // with `shouldValidate` only revalidates the field it names — so an
                // error left on the control that just disappeared would sit there
                // invisibly and block nothing. Clear both; the resolver re-raises
                // whichever still applies on the next submit.
                clearErrors(['externalUrl', 'file']);
              }}
            >
              <SelectTrigger placeholder="Choose a type" />
              <SelectContent>
                {resourceTypeSchema.options.map((option) => {
                  const blocked = option === 'LINK' && isUploadBacked;
                  return (
                    <SelectItem
                      key={option}
                      value={option}
                      disabled={blocked}
                      hint={
                        blocked
                          ? 'Not available — this resource is backed by an uploaded file.'
                          : TYPE_HINT[option]
                      }
                    >
                      {TYPE_LABEL[option]}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </FormField>

          {needsUrl ? (
            <FormField
              label="Web address"
              required
              hint="The full address, including https://"
              error={errors.externalUrl?.message}
            >
              <Input
                type="url"
                inputMode="url"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="https://example.org/reading-list"
                disabled={locked}
                {...form.register('externalUrl')}
              />
            </FormField>
          ) : null}

          {needsFile ? (
            <FormField
              label="File"
              required
              /*
               * The limits are the field's HINT, which means they are part of
               * `aria-describedby` and are read out when the control takes focus —
               * before the chooser opens, and long before a 422 could tell anyone. A
               * separate paragraph above the input would render higher up the page and
               * be announced nowhere.
               */
              hint={`Accepted: ${ACCEPTED_TYPES}. Up to ${formatBytes(RESOURCE_LIMITS.maxBytes)}.`}
              error={errors.file?.message}
            >
              <ResourceFileInput
                inputRef={fileInputRef}
                disabled={locked}
                onFileChange={(file) =>
                  // `shouldValidate` is what runs `describeFileProblem` the instant a
                  // file is chosen, so "that is too big" appears inline on the field
                  // rather than as a toast after a wasted upload.
                  setValue('file', file, { shouldValidate: true, shouldDirty: true })
                }
              />
            </FormField>
          ) : null}

          {isEditing && isUploadBacked ? (
            <div className="flex flex-col gap-1 rounded-md border border-line-subtle bg-sunken px-3 py-2.5">
              <span className="text-xs font-medium text-fg-secondary">Attached file</span>
              <span className="text-sm text-fg">{describeStoredFile(resource)}</span>
              <span className="text-xs text-fg-tertiary">
                The file behind a resource cannot be swapped. Add a new resource and delete this one
                instead.
              </span>
            </div>
          ) : null}

          {isEditing && !isUploadBacked && resource.externalUrl ? (
            <div className="flex flex-col gap-1 rounded-md border border-line-subtle bg-sunken px-3 py-2.5">
              <span className="text-xs font-medium text-fg-secondary">Links to</span>
              <span className="text-sm break-all text-fg">{resource.externalUrl}</span>
              <span className="text-xs text-fg-tertiary">
                Changing the address is not part of an edit. Add a new resource and delete this one
                instead.
              </span>
            </div>
          ) : null}

          {/*
            `isPublic` is `.default(false)` on the create schema, so the box starts
            unticked and the wording explains the tick rather than the default. The copy
            is the two policy branches in plain words: the public branch of
            `resource:read` is `and(isPublic, isPublished)`, so a public resource in an
            unpublished course is still nobody's business (LESSONS-LEARNED #33), and
            `resource:download` denies anonymous outright — which is why "listed" and
            "opened" are two separate sentences here.
          */}
          <Checkbox
            checked={isPublic}
            disabled={locked}
            onCheckedChange={(checked) =>
              setValue('isPublic', checked === true, { shouldValidate: true, shouldDirty: true })
            }
            label="Make this resource public"
            hint="Public: once the course is published, anyone who can see it — including visitors who are not signed in — will see this listed. Opening it still requires signing in. Leave it off and only approved students, the course teacher and administrators can see it at all."
          />

          {/*
            Mounted whether or not it has anything to say. A live region that appears at
            the same moment as its first message is frequently missed, because there was
            no region there for the screen reader to be watching.
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

interface ResourceFileInputProps {
  inputRef: RefObject<HTMLInputElement | null>;
  disabled: boolean;
  onFileChange: (file: File | null) => void;
}

/**
 * A native file input wired into the FormField that wraps it.
 *
 * WHY a component rather than a bare `<input>` in the form above:
 * `useFieldControlProps` is a hook, and it has to run INSIDE the provider `FormField`
 * renders. That hook is the only thing that knows the generated control id and the
 * `aria-describedby` pointing at both the hint and the error — the three rules
 * FormField exists so that nobody hand-writes. `Input` and `Textarea` do exactly this;
 * neither can be reused here, because `type="file"` needs its own `file:` styling and
 * must never be handed a `value`.
 *
 * The class list starts from `controlBase`, imported from the Input it belongs to
 * rather than copied, so the focus treatment is the same declaration every other
 * control uses and cannot drift from it. Nothing here invents an `outline-` utility:
 * in Tailwind v4 `outline-none` and `outline-2` on one element resolve to no outline
 * at all (LESSONS-LEARNED #36), and `controlBase` sidesteps that entirely by
 * drawing focus with a ring.
 */
function ResourceFileInput({
  inputRef,
  disabled,
  onFileChange,
}: ResourceFileInputProps): ReactElement {
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
