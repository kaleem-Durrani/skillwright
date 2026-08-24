import { useState, type ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Pencil, Trash2 } from 'lucide-react';
import {
  createCourseOfferingInputSchema,
  updateCourseOfferingInputSchema,
  type CreateCourseOfferingInput,
  type UpdateCourseOfferingInput,
} from '@skillwright/shared/schema';
import { api } from '@/lib/api';
import { formatOfferingDates } from '@/lib/offerings';
import { ApiError } from '@/lib/problem';
import { qk } from '@/lib/query';
import { usePolicy, type PolicySubject } from '@/lib/policy';
import { useSession } from '@/lib/session';
import type { CourseDetail, EnrollmentDto, ViewerCourseOffering } from '@/lib/types';
import { Button, IconButton } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { FormField } from '@/components/ui/FormField';
import { Input } from '@/components/ui/Input';
import { StatusChip } from '@/components/ui/StatusChip';
import { toast } from '@/components/ui/Toast';

/**
 * The course's INTAKES — one row per scheduled run, since Phase 9 the only place
 * dates and seat numbers live. One section, deliberately: a second screen for
 * managing intakes would be an admin surface, and this is data-model plumbing.
 *
 * What a row offers is decided by WHO is looking:
 *   - every viewer reads the facts (dates, seats, workshop seats);
 *   - a student sees THEIR status on that intake, or — where they hold no row —
 *     the per-intake enrol affordance, disabled with its reason when the intake or
 *     its workshop is full or the rung is unmet (the same visible-but-refusing
 *     pattern the page's old single header button used);
 *   - a teacher or admin (`course:update`, the same gate the offering routes
 *     enforce server-side) gets inline manage: add an intake, retune one, retire
 *     one — with the 409-while-enrolled refusal spelled out in its own dialog.
 *
 * The subject comes from the page, which owns the completed-courses lookup this
 * section must not duplicate; `enrollment:request` decides identically for every
 * intake of a course (`hasCompletedPrerequisite` reads the COURSE's rung), so one
 * answer serves all rows. What differs per intake — fullness — is a refusal REASON
 * on a disabled button, never a policy question.
 */
export function CourseOfferings({
  course,
  viewerSubject,
  prerequisiteUnmet,
}: {
  course: CourseDetail;
  /** The page's COURSE-shaped subject, already carrying the viewer's completed rungs. */
  viewerSubject: PolicySubject | undefined;
  /**
   * True when the signed-in student owes the named rung, decided WITH the lookup
   * ANSWERED — unknown must disable nothing, not everything.
   */
  prerequisiteUnmet: boolean;
}): ReactElement {
  const policy = usePolicy();
  const { user } = useSession();
  const client = useQueryClient();
  const [formTarget, setFormTarget] = useState<ViewerCourseOffering | 'new' | null>(null);
  const [retiring, setRetiring] = useState<ViewerCourseOffering | null>(null);

  const canManage = policy.can('course:update', viewerSubject);

  /*
   * Visible-but-refusing: an unmet rung makes can('enrollment:request') FALSE (the
   * server would 403), but a disabled button performs nothing — so the affordance
   * stays on screen naming the rung, for a signed-in viewer on a PUBLISHED course.
   * Anonymous visitors see no buttons; their denial is the session. A DRAFT course
   * stays silent because publication still gates through can().
   */
  const showEnrolRefusal =
    user !== null &&
    !policy.can('enrollment:request', viewerSubject) &&
    prerequisiteUnmet &&
    course.prerequisite !== null &&
    course.publishedAt !== null;

  // One mutation per section, not one per row — hooks cannot live inside a map.
  // `variables` holds the intake id while the request flies, so only the clicked
  // row shows a spinner.
  const requestSeat = useMutation({
    mutationFn: (offeringId: string) =>
      api.post<EnrollmentDto>(`/courses/${course.id}/enrollments`, { offeringId }),
    onSuccess: async () => {
      toast.success('Request sent', {
        description: 'The teacher will review it. You will be notified either way.',
      });
      await client.invalidateQueries({ queryKey: qk.course(course.id) });
    },
    onError: (error) => toast.fromError(error, 'Could not send that request'),
  });

  if (course.offerings.length === 0) {
    return (
      <section aria-labelledby="course-intakes" className="pb-8">
        <div className="pb-3">
          <h2 id="course-intakes" className="font-display text-lg font-semibold">
            Intakes
          </h2>
          <p className="text-sm text-fg-secondary">
            Seats are sold per intake — apply to the one that suits you.
          </p>
        </div>
        <EmptyState
          variant="empty"
          compact
          title="No intakes yet"
          description="This course has no scheduled runs, so there is nothing to apply for yet."
        />
      </section>
    );
  }

  return (
    <section aria-labelledby="course-intakes" className="pb-8">
      <div className="flex flex-col gap-2 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="course-intakes" className="font-display text-lg font-semibold">
            Intakes
          </h2>
          <p className="text-sm text-fg-secondary">
            Seats are sold per intake — apply to the one that suits you.
          </p>
        </div>
        {canManage ? (
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={<CalendarPlus aria-hidden="true" className="size-4" />}
            onClick={() => setFormTarget('new')}
          >
            Add an intake
          </Button>
        ) : null}
      </div>

      <ul className="flex flex-col gap-3">
        {course.offerings.map((offering) => {
          const blocker = enrolBlocker(offering, course, prerequisiteUnmet);
          return (
            <li key={offering.id}>
              <Card className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <OfferingFacts offering={offering} />
                <div className="flex shrink-0 items-center justify-end gap-1">
                  {/* The viewer's own answer ON THIS INTAKE outranks any affordance. */}
                  {offering.viewerEnrollmentStatus ? (
                    <StatusChip status={offering.viewerEnrollmentStatus} />
                  ) : policy.can('enrollment:request', viewerSubject) || showEnrolRefusal ? (
                    <Button
                      size="sm"
                      block
                      className="sm:w-auto"
                      loading={requestSeat.isPending && requestSeat.variables === offering.id}
                      disabled={blocker !== null}
                      onClick={() => requestSeat.mutate(offering.id)}
                    >
                      {blocker ?? 'Request seat'}
                    </Button>
                  ) : null}
                  {canManage ? (
                    <>
                      <IconButton
                        aria-label={`Edit the ${formatOfferingDates(offering)} intake`}
                        icon={<Pencil className="size-4" />}
                        size="sm"
                        onClick={() => setFormTarget(offering)}
                      />
                      <IconButton
                        aria-label={`Retire the ${formatOfferingDates(offering)} intake`}
                        icon={<Trash2 className="size-4" />}
                        size="sm"
                        onClick={() => setRetiring(offering)}
                      />
                    </>
                  ) : null}
                </div>
              </Card>
            </li>
          );
        })}
      </ul>

      {/*
        ONE dialog each for add/edit and retire, remounted per target by `key` — the
        same arrangement ResourceFormDialog uses, so a form never opens holding the
        previous intake's numbers.
      */}
      <OfferingFormDialog
        key={formTarget === null || formTarget === 'new' ? 'new' : formTarget.id}
        target={formTarget}
        courseId={course.id}
        onClose={() => setFormTarget(null)}
      />

      <RetireDialog
        key={retiring?.id ?? 'none'}
        offering={retiring}
        courseId={course.id}
        onClose={() => setRetiring(null)}
      />
    </section>
  );
}

/** One intake's facts, laid out the same at every width. */
function OfferingFacts({ offering }: { offering: ViewerCourseOffering }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <CardTitle className="text-sm">{formatOfferingDates(offering)}</CardTitle>
      <p className="text-xs text-fg-secondary tabular-nums">
        {offering.isFull
          ? `Full — all ${offering.capacity} places taken`
          : `${offering.seatsRemaining} of ${offering.capacity} places left`}
      </p>
      {/* An unbound intake renders no workshop line at all — never a "none" row. */}
      {offering.workshopCapacity !== null ? (
        <p className="text-xs text-fg-tertiary tabular-nums">
          {offering.workshopSeatsRemaining === 0
            ? 'Workshop full'
            : `${offering.workshopSeatsRemaining} of ${offering.workshopCapacity} workshop places left`}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Why THIS intake's button sits disabled, in the words the old single header button
 * used — prerequisite first (it outlives any one intake), then the exhausted bounds.
 * Null means the request may go out.
 */
function enrolBlocker(
  offering: ViewerCourseOffering,
  course: CourseDetail,
  prerequisiteUnmet: boolean,
): string | null {
  if (prerequisiteUnmet && course.prerequisite !== null) {
    return `Requires ${course.prerequisite.code}`;
  }
  if (offering.workshopCapacity !== null && offering.workshopSeatsRemaining === 0) {
    return 'Workshop is full';
  }
  if (offering.isFull) return 'This intake is full';
  return null;
}

// ---------------------------------------------------------------------------
// Add / edit one intake
// ---------------------------------------------------------------------------

type OfferingFormTarget = ViewerCourseOffering | 'new';

/**
 * The four controls both routes accept, as strings. Blank workshop places mean
 * UNBOUND on create (omitted) and CLEAR-IT on edit (explicit null) — the two wire
 * meanings the shared schemas give the same empty box.
 */
interface OfferingFormState {
  capacity: string;
  workshopCapacity: string;
  startDate: string; // datetime-local
  endDate: string; // datetime-local
}

function toFormState(target: OfferingFormTarget): OfferingFormState {
  if (target === 'new') {
    return { capacity: '', workshopCapacity: '', startDate: '', endDate: '' };
  }
  return {
    capacity: String(target.capacity),
    workshopCapacity: target.workshopCapacity !== null ? String(target.workshopCapacity) : '',
    startDate: toDateTimeLocal(target.startDate),
    endDate: toDateTimeLocal(target.endDate),
  };
}

/** An ISO instant as a LOCAL `datetime-local` value — the picker's own dialect. */
function toDateTimeLocal(value: string | null): string {
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

const CAPACITY_MESSAGE = 'Capacity must be a whole number of at least 1.';
const WORKSHOP_MESSAGE = 'Workshop places must be a whole number of at least 1.';

/** Client-side half of the shared schemas' rules; the schema re-checks on submit. */
function validate(state: OfferingFormState): Partial<Record<keyof OfferingFormState, string>> {
  const errors: Partial<Record<keyof OfferingFormState, string>> = {};
  if (!/^\d+$/.test(state.capacity.trim()) || Number(state.capacity) < 1) {
    errors.capacity = CAPACITY_MESSAGE;
  }
  if (
    state.workshopCapacity !== '' &&
    (!/^\d+$/.test(state.workshopCapacity.trim()) || Number(state.workshopCapacity) < 1)
  ) {
    errors.workshopCapacity = WORKSHOP_MESSAGE;
  }
  if (
    state.startDate !== '' &&
    state.endDate !== '' &&
    new Date(state.endDate).getTime() <= new Date(state.startDate).getTime()
  ) {
    errors.endDate = 'The end date must come after the start date.';
  }
  return errors;
}

/**
 * Add ('new') or retune (a row) ONE intake. The bodies are parsed through the SHARED
 * input schemas before they are sent — the same zod definitions the API validates
 * with, so a body this form builds cannot 422 by surprise; only server-known facts
 * (a shrink below the approved count, mostly) can still be refused, and those field
 * errors land back on these controls through `ApiError.byField`.
 */
function OfferingFormDialog({
  target,
  courseId,
  onClose,
}: {
  target: OfferingFormTarget | null;
  courseId: string;
  onClose: () => void;
}): ReactElement {
  // Narrowed once: `null` is closed, `'new'` is create, a row is edit-that-row.
  const editing = target !== null && target !== 'new' ? target : undefined;
  const client = useQueryClient();
  const [state, setState] = useState<OfferingFormState>(() => toFormState(target ?? 'new'));
  const [errors, setErrors] = useState<Partial<Record<keyof OfferingFormState, string>>>({});

  const save = useMutation({
    mutationFn: async () => {
      if (!editing) {
        const body: CreateCourseOfferingInput = {
          capacity: Number(state.capacity),
          ...(state.workshopCapacity === ''
            ? {}
            : { workshopCapacity: Number(state.workshopCapacity) }),
          ...(state.startDate === '' ? {} : { startDate: toIso(state.startDate) }),
          ...(state.endDate === '' ? {} : { endDate: toIso(state.endDate) }),
        };
        const parsed = createCourseOfferingInputSchema.safeParse(body);
        if (!parsed.success) throw new Error('That intake needs another look.');
        return api.post(`/courses/${courseId}/offerings`, parsed.data);
      }
      const previous = toFormState(editing);
      const body: UpdateCourseOfferingInput = {
        ...(Number(state.capacity) !== Number(previous.capacity)
          ? { capacity: Number(state.capacity) }
          : {}),
        ...(state.workshopCapacity !== previous.workshopCapacity
          ? {
              // Nullable where create is optional: an emptied box is an explicit
              // null — "unbind this workshop" — never "leave unchanged".
              workshopCapacity:
                state.workshopCapacity === '' ? null : Number(state.workshopCapacity),
            }
          : {}),
        ...(state.startDate !== previous.startDate
          ? { startDate: state.startDate === '' ? null : toIso(state.startDate) }
          : {}),
        ...(state.endDate !== previous.endDate
          ? { endDate: state.endDate === '' ? null : toIso(state.endDate) }
          : {}),
      };
      const parsed = updateCourseOfferingInputSchema.safeParse(body);
      if (!parsed.success) throw new Error('That intake needs another look.');
      return api.patch(`/courses/${courseId}/offerings/${editing.id}`, parsed.data);
    },
    onSuccess: async () => {
      toast.success(editing === undefined ? 'Intake added' : 'Intake updated');
      await client.invalidateQueries({ queryKey: qk.course(courseId) });
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        const mapped: Partial<Record<keyof OfferingFormState, string>> = {};
        for (const path of ['capacity', 'workshopCapacity', 'startDate', 'endDate'] as const) {
          const message = error.byField[path];
          if (message !== undefined) mapped[path] = message;
        }
        setErrors(mapped);
        if (Object.keys(mapped).length > 0) return;
      }
      toast.fromError(
        error,
        editing === undefined ? 'Could not add that intake' : 'Could not save that intake',
      );
    },
  });

  const locked = save.isPending;

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && !locked && onClose()}>
      <DialogContent
        dismissible={!locked}
        title={editing === undefined ? 'Add an intake' : 'Edit this intake'}
        description={
          editing === undefined
            ? 'Opens another scheduled run of this course. It appears here the moment it is saved.'
            : 'Retune this run. Lowering a bound below the seats already approved is refused.'
        }
        footer={
          <>
            <Button variant="ghost" block className="sm:w-auto" disabled={locked} onClick={onClose}>
              Cancel
            </Button>
            <Button
              block
              className="sm:w-auto"
              loading={save.isPending}
              onClick={() => {
                const found = validate(state);
                setErrors(found);
                if (Object.keys(found).length === 0) save.mutate();
              }}
            >
              {editing === undefined ? 'Add intake' : 'Save changes'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Places" required error={errors.capacity}>
              <Input
                inputMode="numeric"
                placeholder="12"
                disabled={save.isPending}
                value={state.capacity}
                onChange={(event) =>
                  setState((current) => ({ ...current, capacity: event.target.value }))
                }
              />
            </FormField>
            <FormField
              label="Workshop places"
              hint={
                editing === undefined
                  ? 'Optional — leave empty for lecture-only runs.'
                  : 'Empty clears the bound.'
              }
              error={errors.workshopCapacity}
            >
              <Input
                inputMode="numeric"
                placeholder="None"
                disabled={save.isPending}
                value={state.workshopCapacity}
                onChange={(event) =>
                  setState((current) => ({ ...current, workshopCapacity: event.target.value }))
                }
              />
            </FormField>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Starts" hint="Optional." error={errors.startDate}>
              <Input
                type="datetime-local"
                disabled={save.isPending}
                value={state.startDate}
                onChange={(event) =>
                  setState((current) => ({ ...current, startDate: event.target.value }))
                }
              />
            </FormField>
            <FormField label="Ends" hint="Optional — after the start." error={errors.endDate}>
              <Input
                type="datetime-local"
                disabled={save.isPending}
                value={state.endDate}
                onChange={(event) =>
                  setState((current) => ({ ...current, endDate: event.target.value }))
                }
              />
            </FormField>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Retire one intake
// ---------------------------------------------------------------------------

/**
 * Retire confirmation — and specifically NOT a promise it can be undone while
 * anyone holds a seat. The service refuses with 409 while PENDING or APPROVED
 * requests exist on the intake (`deleteOffering`), so the honest copy names that
 * door out: decide the requests first. The SPA renders errors BY CODE (#25), so
 * the CONFLICT gets this screen's own sentence rather than the 409's diagnostic
 * detail.
 */
function RetireDialog({
  offering,
  courseId,
  onClose,
}: {
  offering: ViewerCourseOffering | null;
  courseId: string;
  onClose: () => void;
}): ReactElement {
  const client = useQueryClient();
  const [conflict, setConflict] = useState(false);
  const retire = useMutation({
    mutationFn: (offeringId: string) =>
      api.del<void>(`/courses/${courseId}/offerings/${offeringId}`),
    onSuccess: async () => {
      toast.success('Intake retired', {
        description: 'It no longer takes applications. Records are kept.',
      });
      await client.invalidateQueries({ queryKey: qk.course(courseId) });
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        setConflict(true);
        return;
      }
      toast.fromError(error, 'Could not retire that intake');
    },
  });

  /*
   * `conflict` needs no reset effect: the parent remounts this dialog per target by
   * `key`, and closing always clears the target first — so a reopened dialog is a
   * fresh mount with the flag down.
   */
  return (
    <Dialog
      open={offering !== null}
      onOpenChange={(open) => !open && !retire.isPending && onClose()}
    >
      <DialogContent
        dismissible={!retire.isPending}
        title="Retire this intake?"
        description={
          offering
            ? `${formatOfferingDates(offering)} disappears from this page and takes no further applications.`
            : undefined
        }
        footer={
          <>
            <Button
              variant="ghost"
              block
              className="sm:w-auto"
              disabled={retire.isPending}
              onClick={onClose}
            >
              Keep it
            </Button>
            <Button
              variant="danger"
              block
              className="sm:w-auto"
              loading={retire.isPending}
              disabled={conflict}
              onClick={() => offering && retire.mutate(offering.id)}
            >
              Retire intake
            </Button>
          </>
        }
      >
        {conflict ? (
          <EmptyState
            variant="error"
            compact
            title="Students are still seated or waiting"
            description="Someone holds an approved seat or awaits a decision on this intake. Approve or reject those requests first — then retiring will go through."
            actionLabel="Review the requests"
            onAction={onClose}
          />
        ) : (
          <p className="text-fg-secondary">
            Applications already decided keep their records. An intake nobody holds or waits on is
            removed from the catalogue immediately; one with live requests is refused until they are
            decided.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
