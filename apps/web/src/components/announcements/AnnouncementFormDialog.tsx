import { useEffect, useId, useRef, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
/**
 * `announcementTypeSchema` is a schema VALUE, so it comes straight from the shared
 * specifier rather than through `@/lib/types` — that file is an `export type` barrel
 * and re-exporting a value through it would turn it into a runtime module (see the
 * note at the top of `lib/types.ts`).
 *
 * `CreateAnnouncementInput` / `UpdateAnnouncementInput` are the two WIRE bodies this
 * dialog builds. They are not among the shapes `@/lib/types` re-exports — it carries
 * the DTOs a screen renders, not the inputs a form posts — so they come from the same
 * specifier, which is still the one declaration of each. Same arrangement as
 * `ResourceFormDialog.tsx`.
 */
import {
  announcementTypeSchema,
  type CreateAnnouncementInput,
  type UpdateAnnouncementInput,
} from '@skillwright/shared/schema';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/problem';
import { qk } from '@/lib/query';
import type { AnnouncementDetail, AnnouncementTypeValue } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { FormField } from '@/components/ui/FormField';
import { Input } from '@/components/ui/Input';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { toast } from '@/components/ui/Toast';

const TYPE_LABEL: Record<AnnouncementTypeValue, string> = {
  NEWS: 'News',
  EVENT: 'Event',
  ANNOUNCEMENT: 'Announcement',
};

const TYPE_HINT: Record<AnnouncementTypeValue, string> = {
  NEWS: 'A general update.',
  EVENT: 'Carries a date and time — required below.',
  ANNOUNCEMENT: 'A general update.',
};

/**
 * The FORM's shape, deliberately not either wire shape — same reasoning as
 * `ResourceFormDialog.tsx`'s `formShape`.
 *
 * `eventDate` is the `datetime-local` control's own string format
 * (`YYYY-MM-DDTHH:mm`, no offset), never the ISO-with-offset the wire schema wants.
 * `toIsoDateTime` / `toDatetimeLocal` below are the only places the two meet.
 * `''` means "no date", for the same reason every text control on `ResourceFormDialog`
 * uses `''` rather than `null`.
 */
const formShape = z
  .object({
    title: z
      .string()
      .trim()
      .min(3, 'Give this announcement a title of at least 3 characters')
      .max(200, 'Keep the title under 200 characters'),
    content: z
      .string()
      .trim()
      .min(1, 'Write something before saving')
      .max(50_000, 'Keep the content under 50,000 characters'),
    type: announcementTypeSchema,
    eventDate: z.string(),
    /** Create-only; ignored on an edit, which has no `publish` field on its wire body. */
    publishNow: z.boolean(),
  })
  // Mirrors `eventNeedsDate` in schema/announcement.ts: an EVENT without a date is a
  // NEWS post wearing a badge, and the client should refuse it before the round trip
  // refuses it too.
  .superRefine((values, ctx) => {
    if (values.type === 'EVENT' && values.eventDate === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['eventDate'],
        message: 'An event needs a date.',
      });
    }
  });

type AnnouncementFormValues = z.infer<typeof formShape>;

/** What react-hook-form reports as touched-and-changed, for this flat form. */
type DirtyAnnouncementFields = { readonly [K in keyof AnnouncementFormValues]?: boolean };

/**
 * `Date` round-trips through the VIEWER's own clock, which is what a `datetime-local`
 * control shows: `getFullYear`/`getHours`/etc. read the local wall time, and
 * `new Date(localString)` below parses one back the same way. The stored value is an
 * absolute instant either way — only the box's presentation changes.
 */
function toDatetimeLocal(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Mirrors `createAnnouncementSchema.eventDate` — `z.string().datetime({ offset: true })`. */
function toIsoDateTime(localValue: string): string {
  return new Date(localValue).toISOString();
}

/** The served row, flattened into the controls this form owns. */
function toFormValues(announcement: AnnouncementDetail | undefined): AnnouncementFormValues {
  if (!announcement) {
    return { title: '', content: '', type: 'ANNOUNCEMENT', eventDate: '', publishNow: false };
  }
  return {
    title: announcement.title,
    content: announcement.content,
    type: announcement.type,
    eventDate: toDatetimeLocal(announcement.eventDate),
    // Publishing an existing row is a separate action (`POST /:id/publish`) that this
    // dialog does not perform — `updateAnnouncementSchema` has no `publish` field.
    publishNow: false,
  };
}

function toCreateBody(values: AnnouncementFormValues): CreateAnnouncementInput {
  return {
    title: values.title,
    content: values.content,
    type: values.type,
    ...(values.eventDate === '' ? {} : { eventDate: toIsoDateTime(values.eventDate) }),
    publish: values.publishNow,
  };
}

/**
 * The PATCH body: only what the user actually changed, on the same reasoning as
 * `ResourceFormDialog.tsx`'s `toUpdate` — `updateAnnouncementSchema` refuses `{}`
 * outright, which is why Save stays disabled until something is dirty.
 *
 * `dirty.eventDate` with an empty value means the box was CLEARED, which is a
 * deliberate `null` (drop the date) rather than an omitted key (leave it alone) —
 * `updateAnnouncementSchema.eventDate` is `.nullable()` for exactly this.
 */
function toUpdateBody(
  values: AnnouncementFormValues,
  dirty: DirtyAnnouncementFields,
): UpdateAnnouncementInput {
  return {
    ...(dirty.title ? { title: values.title } : {}),
    ...(dirty.content ? { content: values.content } : {}),
    ...(dirty.type ? { type: values.type } : {}),
    ...(dirty.eventDate
      ? { eventDate: values.eventDate === '' ? null : toIsoDateTime(values.eventDate) }
      : {}),
  };
}

/**
 * Server field paths mapped onto the control that owns them. Same shape as
 * `ResourceFormDialog.tsx`'s `FIELD_FOR_PATH`.
 */
const FIELD_FOR_PATH: Readonly<Record<string, keyof AnnouncementFormValues>> = {
  title: 'title',
  content: 'content',
  type: 'type',
  eventDate: 'eventDate',
};

export interface AnnouncementFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing an existing row; absent when creating. */
  announcement?: AnnouncementDetail;
}

export function AnnouncementFormDialog({
  open,
  onOpenChange,
  announcement,
}: AnnouncementFormDialogProps): ReactElement {
  const client = useQueryClient();
  const isEditing = announcement !== undefined;
  const formId = useId();

  const form = useForm<AnnouncementFormValues>({
    resolver: zodResolver(formShape),
    defaultValues: toFormValues(announcement),
  });
  const { clearErrors, reset, setError, setValue } = form;

  /**
   * Seed the controls once per opening, not once per render of the row — same
   * reasoning and same ref-guarded shape as `ResourceFormDialog.tsx`'s seeding
   * effect: a background refetch of `announcement` must not reset a form mid-edit.
   *
   * No remount-by-`key` trick is needed here, unlike `CourseDetail.tsx`'s resource
   * dialog: each page that opens this one points it at exactly ONE fixed target for
   * its whole lifetime — always 'new' on `Announcements.tsx`, always this row's id
   * on `AnnouncementDetail.tsx` — so there is no second row this same mounted
   * instance could ever be re-seeded for.
   */
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    const seed = open ? (announcement?.id ?? 'new') : null;
    if (seededFor.current === seed) return;
    seededFor.current = seed;
    if (!open) return;
    reset(toFormValues(announcement));
  }, [open, announcement, reset]);

  const save = useMutation({
    mutationFn: (values: AnnouncementFormValues): Promise<AnnouncementDetail> => {
      if (announcement) {
        const body = toUpdateBody(values, form.formState.dirtyFields);
        return api.patch<AnnouncementDetail>(`/announcements/${announcement.id}`, body);
      }
      return api.post<AnnouncementDetail>('/announcements', toCreateBody(values));
    },
    onSuccess: async (saved) => {
      toast.success(isEditing ? 'Announcement updated' : 'Announcement saved', {
        description:
          !isEditing && saved.publishedAt
            ? 'It is published and visible to everyone who can see it.'
            : !isEditing
              ? 'It is saved as a draft. Publish it from the announcement page when it is ready.'
              : undefined,
      });
      onOpenChange(false);
      await Promise.all([
        // Prefix match reaches every filtered page of the list, on the same idiom
        // `AdminUsers.tsx` uses for `['users']`.
        client.invalidateQueries({ queryKey: ['announcements'] }),
        ...(announcement
          ? [client.invalidateQueries({ queryKey: qk.announcement(announcement.id) })]
          : []),
      ]);
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        for (const [path, message] of Object.entries(error.byField)) {
          const field = FIELD_FOR_PATH[path];
          if (field) setError(field, { message });
        }
      }
      toast.fromError(
        error,
        isEditing ? 'Could not save those changes' : 'Could not save that announcement',
      );
    },
  });

  const { dirtyFields, errors, isDirty } = form.formState;
  const type = form.watch('type');
  const needsEventDate = type === 'EVENT';

  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent
        dismissible={!save.isPending}
        title={isEditing ? 'Edit announcement' : 'New announcement'}
        description={
          isEditing
            ? 'Changes the title, body, type and event date. Publishing is a separate action.'
            : 'Saves as a draft unless you choose to publish it immediately below.'
        }
        footer={
          <>
            <Button
              variant="ghost"
              block
              className="sm:w-auto"
              disabled={save.isPending}
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
              {isEditing ? 'Save changes' : 'Save announcement'}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          className="flex flex-col gap-4"
          noValidate
          onSubmit={form.handleSubmit((values) => {
            if (announcement) {
              const body = toUpdateBody(values, dirtyFields);
              // `updateAnnouncementSchema` refuses an empty body; Save is already
              // disabled until something is dirty, this is the second lock.
              if (Object.keys(body).length === 0) return;
            }
            save.mutate(values);
          })}
        >
          <FormField label="Title" required error={errors.title?.message}>
            <Input
              autoComplete="off"
              placeholder="Midterm schedule change"
              disabled={save.isPending}
              {...form.register('title')}
            />
          </FormField>

          <FormField label="Body" required error={errors.content?.message}>
            <Textarea autoResize rows={6} disabled={save.isPending} {...form.register('content')} />
          </FormField>

          <FormField label="Type" required error={errors.type?.message}>
            <Select
              value={type}
              disabled={save.isPending}
              onValueChange={(next) => {
                // `announcementTypeSchema` narrows the string Radix hands back. A cast
                // would compile just as well and would become a lie the moment the
                // enum gains a member.
                const parsed = announcementTypeSchema.safeParse(next);
                if (!parsed.success) return;
                setValue('type', parsed.data, { shouldValidate: true, shouldDirty: true });
                // Switching away from EVENT leaves a stale error on a field that just
                // disappeared; the resolver re-raises it if the type switches back.
                clearErrors('eventDate');
              }}
            >
              <SelectTrigger placeholder="Choose a type" />
              <SelectContent>
                {announcementTypeSchema.options.map((option) => (
                  <SelectItem key={option} value={option} hint={TYPE_HINT[option]}>
                    {TYPE_LABEL[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          {needsEventDate ? (
            <FormField label="Event date" required error={errors.eventDate?.message}>
              <Input
                type="datetime-local"
                disabled={save.isPending}
                {...form.register('eventDate')}
              />
            </FormField>
          ) : null}

          {!isEditing ? (
            <Checkbox
              checked={form.watch('publishNow')}
              disabled={save.isPending}
              onCheckedChange={(checked) =>
                setValue('publishNow', checked === true, { shouldDirty: true })
              }
              label="Publish immediately"
              hint="Otherwise this saves as a draft. Only you and administrators can see a draft; publish it from the announcement page when it is ready."
            />
          ) : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}
