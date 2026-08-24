import { useRef, useState, type ReactElement, type RefObject } from 'react';
import { useMutation } from '@tanstack/react-query';
import { UPLOAD_LIMITS } from '@skillwright/shared/schema';
import type { UserDetail } from '@/lib/types';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/format';
import { describeFileProblem, isUploadFailure, uploadFile } from '@/lib/uploads';
import { acceptedTypesSentence } from '@/components/uploads/fileCopy';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { FormField, useFieldControlProps } from '@/components/ui/FormField';
import { controlBase } from '@/components/ui/Input';
import { toast } from '@/components/ui/Toast';

/**
 * The one set of limits this picker describes, read rather than restated — the same
 * discipline the resource dialog applies to RESOURCE: raising the AVATAR ceiling in
 * `schema/upload.ts` changes this sentence in the same commit.
 */
const AVATAR_LIMITS = UPLOAD_LIMITS.AVATAR;

const ACCEPTED_TYPES = acceptedTypesSentence(AVATAR_LIMITS.mimeTypes);

/**
 * A chooser filter, not a check — every browser offers an "All files" escape from
 * it, and the file picked that way still reaches `onChange`, where
 * `describeFileProblem` is the real client-side answer.
 */
const ACCEPT_ATTRIBUTE = AVATAR_LIMITS.mimeTypes.join(',');

export interface AvatarPickerProps {
  /** The served `/users/me` record, whose `avatarUrl` is what this shows. */
  profile: UserDetail;
  /**
   * Writes the updated record where this screen reads it. The `/me` cache key is
   * OWNED BY THE PAGE that renders this picker (Settings.tsx's `profileKey`), so the
   * picker never names it — it hands back the server's answer and the page decides
   * which caches move. There is deliberately no second cache path for `/me`.
   */
  onSaved: (updated: UserDetail) => void | Promise<void>;
  disabled?: boolean;
}

/**
 * The avatar picker for Settings' profile tab.
 *
 * WHAT THE API ALLOWS, AND SO WHAT THIS OFFERS: `updateSelf` accepts an AVATAR-purpose
 * COMMITTED upload (users.service.ts, `updateSelf`) — it can attach a new picture and
 * nothing else. There is no removal, and so there is no remove control here: a button
 * the API answers 422 is a lie with a click handler.
 *
 * THE DICEBEAR CASE NEEDS NO CODE. `avatarUrl` is served whether the face behind it is
 * an upload or the generated fallback, and `Avatar` renders either — a URL paints the
 * image, `null` falls back to the monogram. "No upload yet" is therefore not a branch
 * in this component; the picker simply shows whatever face the server currently serves.
 */
export function AvatarPicker({
  profile,
  onSaved,
  disabled = false,
}: AvatarPickerProps): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  /** The reason the chosen file is unacceptable, shown on the field like any error. */
  const [problem, setProblem] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async (chosen: File): Promise<UserDetail> => {
      // presign -> PUT -> commit happens first, and only a COMMITTED upload id is
      // attached — `updateSelf` asserts the upload is the caller's own, AVATAR-purpose
      // and committed, so anything else is a field-level 422. `uploadFile` re-runs the
      // size and MIME checks itself, but the picker has already refused those above:
      // reaching the network with a file the limits refuse would waste a presign.
      const uploaded = await uploadFile(chosen, 'AVATAR');
      return api.patch<UserDetail>('/users/me', { avatarUploadId: uploaded.uploadId });
    },
    onSuccess: async (updated) => {
      toast.success('Profile photo updated');
      clearChoice();
      // The page moves the caches: `/me` for this screen, the session for the chrome,
      // whose avatar comes from the session envelope and not from this record.
      await onSaved(updated);
    },
    onError: (error) => {
      /*
       * Same arrangement as ResourceFormDialog: an upload failure carries a sentence
       * written for this user — "the file could not be sent" — and `toast.fromError`
       * would replace it with the generic fallback, because it only trusts
       * `ApiError.userMessage` and is right not to trust an arbitrary `Error.message`.
       * The one error type whose message IS user copy is shown directly.
       */
      if (isUploadFailure(error)) {
        toast(error.message, { tone: 'danger' });
        return;
      }
      toast.fromError(error, 'Could not update your profile photo');
    },
  });

  /** Empties the control and the choice, so the same file can be picked again. */
  function clearChoice(): void {
    setFile(null);
    setProblem(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  function handleFileChange(next: File | null): void {
    if (next === null) {
      clearChoice();
      return;
    }

    // BEFORE any round trip — the same check the resolver runs in the resource
    // dialog, so an unusable file is a message on the field rather than a 422 the
    // user has to decode after a presign wrote a PENDING row.
    const found = describeFileProblem(next, 'AVATAR');
    if (found !== null) {
      setFile(null);
      setProblem(found);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    setProblem(null);
    setFile(next);
  }

  const locked = save.isPending;

  return (
    <Card className="flex flex-col gap-4">
      <CardTitle>Profile photo</CardTitle>

      <div className="flex items-center gap-4">
        {/* Whatever the server currently serves: an uploaded picture or the generated face. */}
        <Avatar name={profile.name} src={profile.avatarUrl} size="xl" />
        <p className="min-w-0 text-sm text-fg-secondary">
          Shown beside your name in messages, comments and course rosters.
        </p>
      </div>

      <FormField
        label="Choose a picture"
        hint={`Accepted: ${ACCEPTED_TYPES}. Up to ${formatBytes(AVATAR_LIMITS.maxBytes)}.`}
        error={problem}
      >
        {/*
          The native file input, styled exactly as the resource dialog's — `controlBase`
          is imported from the Input the design system shares rather than copied, so the
          focus treatment cannot drift from every other control on the screen.
        */}
        <AvatarFileInput
          inputRef={inputRef}
          disabled={disabled || locked}
          onChange={handleFileChange}
        />
      </FormField>

      <Button
        block
        className="sm:w-auto sm:self-start"
        loading={locked}
        disabled={disabled || file === null}
        onClick={() => file && save.mutate(file)}
      >
        Save photo
      </Button>

      {/*
        Mounted whether or not it has anything to say — a live region that appears at
        the same moment as its first message is frequently missed, because there was no
        region there for the screen reader to be watching.
      */}
      <p role="status" aria-live="polite" aria-atomic="true" className="text-xs text-fg-secondary">
        {locked ? 'Uploading your photo. It will only take a moment.' : ''}
      </p>
    </Card>
  );
}

interface AvatarFileInputProps {
  inputRef: RefObject<HTMLInputElement | null>;
  disabled: boolean;
  onChange: (file: File | null) => void;
}

/**
 * A native file input wired into the FormField that wraps it — for the same reason
 * `ResourceFormDialog` keeps one: `useFieldControlProps` is a hook and has to run
 * INSIDE the provider `FormField` renders. That hook is the only thing that knows the
 * generated control id and the `aria-describedby` naming both hint and error. It is
 * not exported from the dialog because a file input must never be handed a `value`,
 * which a shared component would have to keep promising.
 */
function AvatarFileInput({ inputRef, disabled, onChange }: AvatarFileInputProps): ReactElement {
  const wired = useFieldControlProps({});
  return (
    <input
      ref={inputRef}
      type="file"
      accept={ACCEPT_ATTRIBUTE}
      disabled={disabled}
      onChange={(event) => onChange(event.target.files?.[0] ?? null)}
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
