import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/problem';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { FormField, useFieldControlProps } from '@/components/ui/FormField';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/Select';
import { toast } from '@/components/ui/Toast';
import type { QualificationDto, QualificationList } from '@/lib/types';

/**
 * Issuing a certificate, reached from a COMPLETED enrolment row.
 *
 * WHY THIS IS A DIALOG AND NOT A SCREEN, stated once so nobody re-argues it: the form
 * is ONE choice. There is no date to pick (the API dates it), no file to attach (the API
 * generates the PDF), no free text to write, and nothing to review before submitting —
 * the row it was opened from already says who finished what, and when. A route would add
 * a URL to bookmark, a back button to get wrong, and a loader to fail, in exchange for
 * navigating away from the register the teacher is working in.
 *
 * WHY THERE IS NO `Gate` AROUND THE FORM ITSELF. `certificate:issue` is decided by the
 * API against the SEAT, and the seat is this dialog's whole subject: the page that opens
 * it already holds the enrolment row. The button that opens it is `Gate`d (see
 * `EnrollmentCertificateActions`), and the dialog says what will happen before it asks
 * for the one input — so a viewer who may not issue never sees an affordance, and a
 * viewer who may always gets a truthful answer from the API either way.
 *
 * The one thing this dialog does NOT decide is whether the enrolment was completed.
 * That is a fact about the register, the API checks it, and a client that checked it
 * first would be a second place for the same rule to live — the shape lesson 28 is
 * about.
 */

const formShape = z.object({
  qualificationId: z.string().min(1, 'Choose the qualification being awarded.'),
});

type FormValues = z.infer<typeof formShape>;

export interface IssueCertificateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  enrollmentId: string;
  /** Named in the copy, because "issue a certificate" alone does not say of what. */
  studentName: string;
  courseName: string;
}

export function IssueCertificateDialog({
  open,
  onOpenChange,
  enrollmentId,
  studentName,
  courseName,
}: IssueCertificateDialogProps): ReactElement {
  const client = useQueryClient();
  const formId = useId();
  const form = useForm<FormValues>({
    resolver: zodResolver(formShape),
    defaultValues: { qualificationId: '' },
  });
  const { reset, setError } = form;
  /*
   * `useFieldControlProps` with NO local `id`, so the FormField below owns the
   * `id`/`aria-describedby`/`aria-invalid` triple. The trigger renders a BUTTON, not an
   * input, and Radix puts `role="combobox"` and `aria-expanded` on it itself — handing
   * the trigger the field's `id` as well would be two ids on one element.
   */
  const selectProps = useFieldControlProps({});

  /*
   * Fetched when the dialog OPENS, not on mount. The catalogue is small and never
   * changes mid-session, so this is one request per opening rather than one per page —
   * and a teacher who opens the dialog on a phone over a slow connection sees the list
   * arrive with the dialog rather than having waited for it before anything appeared.
   */
  const catalogue = useQuery({
    queryKey: ['qualifications'],
    queryFn: () => api.get<QualificationList>('/qualifications'),
    enabled: open,
  });

  const issue = useMutation({
    mutationFn: (values: FormValues) =>
      api.post<{ id: string }>('/certificates', {
        enrollmentId,
        qualificationId: values.qualificationId,
      }),
    onSuccess: async () => {
      toast.success('Certificate issued', {
        description: `${studentName} can download it from their Qualifications tab.`,
      });
      onOpenChange(false);
      // The `certificates` PREFIX rather than the holder's list key: the module exposes
      // one list that three different readers (the holder, the issuing teacher, an admin)
      // each hold under their own key, and the issue changes all of them. The catalogue
      // is not invalidated because issuing does not alter it.
      await client.invalidateQueries({ queryKey: ['certificates'] });
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        for (const [path, message] of Object.entries(error.byField)) {
          if (path === 'qualificationId') setError('qualificationId', { message });
        }
        // A 409 is the two refusals this route can make and both are worth naming: the
        // seat is not COMPLETED, or this seat already carries this standard. The SPA
        // renders `code` and never `detail` (LESSONS-LEARNED #25), so the shared
        // sentence is what the teacher reads, and the detail is the diagnostic a
        // developer gets from the log.
        if (error.is('CONFLICT')) {
          toast.error('That seat cannot take that certificate', {
            description:
              'Either the enrolment is not completed yet, or this standard has already been awarded from it.',
          });
          return;
        }
      }
      toast.fromError(error, 'Could not issue that certificate');
    },
  });

  /**
   * Re-seeded per OPENING rather than per target, keyed on the seat — the same reason
   * `SubmissionDialog` carries a ref instead of an effect on its prop object: a
   * background refetch hands this component a new enrolment object with the same
   * contents, and an effect keyed on the object would clear a half-made choice under
   * somebody who is still reading the catalogue.
   */
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    const seed = open ? enrollmentId : null;
    if (seededFor.current === seed) return;
    seededFor.current = seed;
    if (!open) return;
    reset({ qualificationId: '' });
  }, [open, enrollmentId, reset]);

  const [selected, setSelected] = useState('');

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (issue.isPending && !next) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        dismissible={!issue.isPending}
        title="Issue a certificate"
        description={`${studentName} completed ${courseName}. The certificate is generated as a PDF, stored against this seat, and can be verified by its reference from then on.`}
        footer={
          <>
            <Button
              variant="ghost"
              block
              className="sm:w-auto"
              disabled={issue.isPending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form={formId}
              block
              className="sm:w-auto"
              loading={issue.isPending}
              disabled={catalogue.isPending || catalogue.data?.length === 0}
            >
              Issue certificate
            </Button>
          </>
        }
      >
        <form
          id={formId}
          className="flex flex-col gap-4"
          noValidate
          onSubmit={form.handleSubmit(
            (values) => issue.mutate(values),
            // A blocked submit must CHANGE something. The select is the only control, so
            // focusing it is focusing the thing that is blocking.
            () => {
              document.getElementById(`${formId}-qualification`)?.focus();
            },
          )}
        >
          {catalogue.isError ? (
            <EmptyState
              variant="error"
              title="The catalogue could not be loaded"
              description="A qualification has to be chosen from the school's catalogue, so this cannot be issued without it."
            />
          ) : catalogue.data !== undefined && catalogue.data.length === 0 ? (
            /*
             * An EMPTY CATALOGUE IS NOT AN ERROR, and saying so is the point. A school
             * that has never recorded a standard cannot award one, and the honest answer
             * is "there is nothing to award yet" — which is Phase 3's own gap made
             * visible at the place it bites. The alternative, a select with one empty
             * option and an enabled button, is a dialog that fails on submit for a reason
             * the person cannot see.
             */
            <EmptyState
              variant="empty"
              title="No qualifications in the catalogue"
              description="Your school has not recorded any qualifications yet. An admin adds them, and they appear here immediately."
            />
          ) : (
            <FormField
              label="Qualification"
              hint="Awarded by the body named on the certificate, under the level you choose."
              error={form.formState.errors.qualificationId?.message}
            >
              <Select
                value={selected}
                onValueChange={(value) => {
                  setSelected(value);
                  form.setValue('qualificationId', value, { shouldValidate: true });
                }}
                disabled={catalogue.isPending}
              >
                <SelectTrigger
                  id={`${formId}-qualification`}
                  aria-label="Qualification"
                  {...selectProps}
                />
                <SelectContent>
                  {(catalogue.data ?? []).map((qualification: QualificationDto) => (
                    <SelectItem key={qualification.id} value={qualification.id}>
                      {qualification.name} — Level {qualification.level}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          )}

          {/*
            WHAT HAPPENS NEXT, stated before it happens. Issuing is not reversible by the
            person who did it — `certificate:revoke` is an ADMIN verb, deliberately, and
            the reasoning is at the rule — so the one irreversible act in this module gets
            a sentence above the button rather than a confirmation afterwards.
          */}
          <p className="text-xs text-fg-tertiary">
            The certificate is dated today and cannot be withdrawn from this screen. An admin can
            revoke it later, and the certificate will say so wherever it is checked.
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}
