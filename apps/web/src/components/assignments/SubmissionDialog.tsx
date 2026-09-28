import { useEffect, useId, useRef, useState, type ReactElement, type RefObject } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { UPLOAD_LIMITS } from '@skillwright/shared/schema';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/format';
import { ApiError } from '@/lib/problem';
import { describeFileProblem, isUploadFailure, uploadFile, type UploadedFile } from '@/lib/uploads';
import { acceptedTypesSentence, MIME_LABEL } from '@/components/uploads/fileCopy';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { FormField, useFieldControlProps } from '@/components/ui/FormField';
import { controlBase } from '@/components/ui/Input';
import { toast } from '@/components/ui/Toast';

/**
 * The limits a hand-in is described by, read from `UPLOAD_LIMITS` rather than
 * restated, so raising the RESOURCE ceiling in `schema/upload.ts` changes the sentence
 * under the picker in the same commit.
 *
 * WHY the RESOURCE purpose and not a new one: `UploadPurpose` is `AVATAR | RESOURCE |
 * SYLLABUS`, and it decides the object-store key PREFIX that
 * `assertUploadClaimable` reads back as evidence of what an upload was made for
 * (uploads.service.ts). Adding a `SUBMISSION` purpose is a change to the uploads
 * module, which is not this phase's, and a submission is the same kind of artefact a
 * course resource is — a document the student made. The deviation is recorded in the
 * phase report rather than smuggled in here.
 */
const SUBMISSION_LIMITS = UPLOAD_LIMITS.RESOURCE;
const ACCEPT_ATTRIBUTE = SUBMISSION_LIMITS.mimeTypes.join(',');
const ACCEPTED_TYPES = acceptedTypesSentence(SUBMISSION_LIMITS.mimeTypes);

/**
 * The FORM's shape, which is deliberately not the wire shape.
 *
 * The score lives in the GRADER's dialog, not here — a hand-in carries no mark, and a
 * form that had a score control on it would be one refactor away from letting a student
 * set their own.
 */
const formShape = z.object({
  file: z.instanceof(File).nullable(),
});

type FormValues = z.infer<typeof formShape>;

type SubmitPhase = 'idle' | 'uploading' | 'saving';

export interface SubmissionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignmentId: string;
  /** 1 for a first hand-in; the next attempt for a resubmission. */
  attempt: number;
  /** True once the deadline has passed. Says so; never blocks. */
  overdue: boolean;
  /** What the teacher last said, when the work came back for another go. */
  returnedFeedback?: string | null;
}

export function SubmissionDialog({
  open,
  onOpenChange,
  assignmentId,
  attempt,
  overdue,
  returnedFeedback,
}: SubmissionDialogProps): ReactElement {
  const client = useQueryClient();
  const formId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<SubmitPhase>('idle');
  /**
   * The PUT's byte progress as a whole percentage, measured by `uploadFile` off
   * `xhr.upload.onprogress` — never simulated, and rendered only while the upload is
   * the step running. A large PDF on a phone is the case this exists for: a spinner
   * tells the student nothing for two minutes, and a bar they can watch is the
   * difference between waiting and starting again.
   */
  const [progress, setProgress] = useState(0);
  /**
   * The upload that already reached the store, so a failed POST is not paid for twice.
   * Keyed on the File object, exactly as `ResourceFormDialog` does it — see that
   * component's comment for the whole argument, which is unchanged here.
   */
  const uploadedRef = useRef<{ file: File; uploaded: UploadedFile } | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formShape),
    defaultValues: { file: null },
  });
  const { reset, setError, setValue } = form;

  const handIn = useMutation({
    mutationFn: async (file: File) => {
      if (uploadedRef.current?.file !== file) {
        setPhase('uploading');
        setProgress(0);
        uploadedRef.current = {
          file,
          uploaded: await uploadFile(file, 'RESOURCE', { onProgress: setProgress }),
        };
      }
      setPhase('saving');
      return api.post<{ id: string }>(`/assignments/${assignmentId}/submissions`, {
        uploadId: uploadedRef.current.uploaded.uploadId,
      });
    },
    onSuccess: async () => {
      toast.success(attempt === 1 ? 'Work handed in' : 'Handed in again', {
        description: 'Your teacher will mark it and you will see the mark here.',
      });
      onOpenChange(false);
      // The `assignments` PREFIX, and deliberately not three named keys: a hand-in
      // changes the student's own list AND the teacher's class list for that task, and
      // neither knows about the other. The prefix is the one relationship that does.
      await client.invalidateQueries({ queryKey: ['assignments'] });
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        for (const [path, message] of Object.entries(error.byField)) {
          if (path === 'uploadId') setError('file', { message });
        }
      }
      /*
       * An upload failure carries a sentence written for this student — "that link has
       * expired", "the file could not be sent" — and `toast.fromError` would replace
       * every one of them with the generic fallback, because it only trusts
       * `ApiError.userMessage` and is right not to trust an arbitrary `Error.message`.
       * The one error type whose message IS user copy is shown directly.
       */
      if (isUploadFailure(error)) {
        toast(error.message, { tone: 'danger' });
        return;
      }
      toast.fromError(error, 'Could not hand that in');
    },
    onSettled: () => setPhase('idle'),
  });

  const { errors } = form.formState;
  const selectedFile = form.watch('file');

  /**
   * Seed the controls once per OPENING, keyed on which task this dialog is for.
   *
   * A ref rather than a `[wasOpen, setWasOpen]` pair in render: the assignment is a
   * query row, so a background refetch hands this component a NEW object with the same
   * contents, and an effect keyed on the object itself would reset the form under
   * someone mid-upload. Keyed on "which task is this open for", a refetch is a no-op
   * and a genuine switch still re-seeds.
   */
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    const seed = open ? assignmentId : null;
    if (seededFor.current === seed) return;
    seededFor.current = seed;
    if (!open) return;
    reset({ file: null });
    setPhase('idle');
    setProgress(0);
    uploadedRef.current = null;
    // The native file input is cleared by hand: its value lives in the DOM, not in
    // react-hook-form, so `reset` cannot reach the filename the chooser is showing.
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [open, assignmentId, reset]);

  const locked = handIn.isPending;

  const statusMessage =
    phase === 'uploading'
      ? `Uploading ${selectedFile?.name ?? 'your file'} — ${progress}%. A large file can take a while — leave this open.`
      : phase === 'saving'
        ? 'Recording your hand-in.'
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
        title={attempt === 1 ? 'Hand in your work' : `Hand in again (attempt ${attempt})`}
        description={`Recorded against your seat on this intake. Your teacher sees the file exactly as you sent it.`}
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
              // `type="submit"` and NO `onClick`. Both at once would fire the mutation
              // twice — once from the click and once from the form's own submit — and a
              // double presign is a double PENDING upload row for one hand-in. The form
              // is the only entry point, exactly as `ResourceFormDialog` is.
              type="submit"
              form={formId}
              block
              className="sm:w-auto"
              loading={handIn.isPending}
            >
              {attempt === 1 ? 'Hand in' : 'Hand in again'}
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
              if (values.file !== null) handIn.mutate(values.file);
            },
            // A blocked submit must CHANGE something, or it is silent. The file is
            // validated on selection, so its message is already on screen; focus is
            // moved by hand to the control that is blocking, so the error is read.
            (invalid) => {
              if (invalid.file && fileInputRef.current) fileInputRef.current.focus();
            },
          )}
        >
          {/*
            The deadline is stated, never enforced here. `MyAssignmentDto.overdue` is a
            FACT about the clock and the API is what decides whether a late hand-in is
            accepted, so a control that disabled itself here would be the client
            inventing a policy the server does not have — and a student who is told
            "closed" by a phone is told it for good.
          */}
          {overdue ? (
            <p className="rounded-md border border-line-subtle bg-sunken px-3 py-2.5 text-xs text-fg-secondary">
              The deadline for this task has passed. You can still hand in — whether it counts is
              your teacher&rsquo;s decision, not this screen&rsquo;s.
            </p>
          ) : null}

          {returnedFeedback ? (
            <div className="flex flex-col gap-1 rounded-md border border-line-subtle bg-sunken px-3 py-2.5">
              <span className="text-xs font-medium text-fg-secondary">What your teacher said</span>
              <p className="text-sm text-fg">{returnedFeedback}</p>
            </div>
          ) : null}

          <FormField
            label="Your work"
            required
            /*
             * The limits are the field's HINT, which means they are part of
             * `aria-describedby` and are read out when the control takes focus — before
             * the chooser opens, and long before a 422 could tell anyone.
             */
            hint={`Accepted: ${ACCEPTED_TYPES}. Up to ${formatBytes(SUBMISSION_LIMITS.maxBytes)}.`}
            error={errors.file?.message}
          >
            <SubmissionFileInput
              inputRef={fileInputRef}
              disabled={locked}
              onFileChange={(file, problem) => {
                if (problem !== null) {
                  setError('file', { message: problem });
                  return;
                }
                setValue('file', file, { shouldValidate: true, shouldDirty: true });
              }}
            />
          </FormField>

          {/* Progress is REAL BYTES, rendered only while the upload is the step running. */}
          {phase === 'uploading' ? (
            <div
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Uploading ${selectedFile?.name ?? 'your file'}`}
              className="h-1.5 w-full overflow-hidden rounded-full bg-sunken"
            >
              <div
                className="h-full rounded-full bg-brand"
                style={{ inlineSize: `${progress}%` }}
              />
            </div>
          ) : null}

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

/**
 * What the file the student already sent is called, given only what the wire serves.
 *
 * `SubmissionDto.upload` carries `originalName` directly — unlike a resource, whose DTO
 * flattens only the type and the size — because a student looking at "what did I
 * upload?" and a teacher looking at "what did they upload?" are the same question and
 * an answer without a name is not one.
 */
export function describeUpload(upload: {
  originalName: string;
  contentType: string;
  sizeBytes: number;
}): string {
  const type = MIME_LABEL[upload.contentType] ?? upload.contentType;
  return `${upload.originalName} · ${type} · ${formatBytes(upload.sizeBytes)}`;
}

interface SubmissionFileInputProps {
  inputRef: RefObject<HTMLInputElement | null>;
  disabled: boolean;
  /** `problem` is `describeFileProblem`'s sentence, or null when the file is fine. */
  onFileChange: (file: File | null, problem: string | null) => void;
}

/**
 * A native file input wired into the FormField that wraps it.
 *
 * WHY a component rather than a bare `<input>` in the form above: `useFieldControlProps`
 * is a hook and has to run INSIDE the provider `FormField` renders, and it is the only
 * thing that knows the generated control id and the `aria-describedby` pointing at both
 * the hint and the error. The class list starts from `controlBase`, imported from the
 * Input it belongs to rather than copied, so the focus treatment is the same
 * declaration every other control uses and cannot drift from it. Nothing here
 * hand-assembles an `outline-` utility: in Tailwind v4 `outline-none` and `outline-2`
 * on one element resolve to no outline at all (LESSONS-LEARNED #36).
 */
function SubmissionFileInput({
  inputRef,
  disabled,
  onFileChange,
}: SubmissionFileInputProps): ReactElement {
  const wired = useFieldControlProps({});
  return (
    <input
      ref={inputRef}
      type="file"
      accept={ACCEPT_ATTRIBUTE}
      disabled={disabled}
      onChange={(event) => {
        const file = event.target.files?.[0] ?? null;
        // `describeFileProblem` runs on SELECTION rather than on submit, so "that is
        // too big" appears inline before a round trip that would have to read the file.
        // The server and the object store are still the enforcement (LESSONS #32).
        onFileChange(file, file === null ? null : describeFileProblem(file, 'RESOURCE'));
      }}
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
