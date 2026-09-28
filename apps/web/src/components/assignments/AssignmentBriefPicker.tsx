import { type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Paginated } from '@/lib/api';
import { qk } from '@/lib/query';
import type { ResourceDto } from '@/lib/types';
import { FormField } from '@/components/ui/FormField';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/Select';

/**
 * Radix refuses an empty-string `SelectItem` value, so "no file" travels under a
 * sentinel and the form sees `''` — the same arrangement `CourseFormDialog`'s
 * prerequisite picker uses, and for the same reason.
 */
const NO_FILE = '__none__';

/**
 * What the absence says, in the teacher's words rather than the schema's.
 *
 * "No file" alone reads like a form that has not been filled in. The clause after it
 * is the one that makes the absence a decision: the task is already complete without
 * a file, and the teacher is choosing that, not failing to choose something else.
 */
const NO_FILE_LABEL = 'No file — the task above is the whole brief';

/** Rendered when the attached brief is real but the course list no longer carries it. */
const MISSING_LABEL = 'Attached file (no longer in this course’s resources)';

export interface AssignmentBriefPickerProps {
  courseId: string;
  /** The attached resource's id, or `''` for none. The form's own vocabulary. */
  value: string;
  onChange: (resourceId: string) => void;
  disabled?: boolean;
  /** A refusal the server returned on the `resourceId` path, already mapped by the form. */
  error?: string | null;
}

/**
 * The attached artefact for a task, as a control.
 *
 * A brief is OPTIONAL, and that is the column rather than a preference.
 * `Assignment.resourceId` is nullable, `createAssignmentSchema` takes it `.nullish()`,
 * and a task whose whole instruction is three typed sentences is the common case. So
 * the default state is "no file", and choosing nothing is a legitimate, savable answer
 * instead of a validation error.
 *
 * It is offered on EDIT as well as on create, for the ordinary reason a teacher
 * reaches for it: the wrong file went on, or the right one was uploaded afterwards.
 * What that means on the wire is the form's decision, not this one's — an explicit
 * `null` detaches, an omitted key leaves it alone.
 *
 * WHY the endpoint and never the policy: the options are whatever
 * `GET /courses/:courseId/resources` returned under `qk.courseResources` — the SAME
 * key the Resources tab already reads, so this is one cache entry and one request
 * rather than a second answer to `resource:read` (LESSONS-LEARNED #28). Whether a
 * given resource may be ATTACHED is a further question the server asks separately,
 * through `assertBriefUsable`; this component asks neither.
 *
 * No `enabled` gate is needed, and the reason is worth having written down because it
 * looks like it should be needed: `DialogContent` passes Radix's `forceMount` to
 * `DialogPrimitive.Content`, which does NOT keep a closed dialog's subtree in the
 * document — `AnimatePresence` above it owns that decision, so the tree renders only
 * while `open` is true (and through the exit animation). Measured rather than
 * assumed: a dialog rendered with `open={false}` puts zero nodes in the document,
 * `input[name=title]` and `[role=combobox]` included. The query therefore cannot run
 * on a course page nobody has opened the dialog on, and a gate here would be
 * configuration guarding a case that does not occur.
 */
export function AssignmentBriefPicker({
  courseId,
  value,
  onChange,
  disabled = false,
  error = null,
}: AssignmentBriefPickerProps): ReactElement {
  const resources = useQuery({
    queryKey: qk.courseResources(courseId),
    queryFn: () => api.get<Paginated<ResourceDto>>(`/courses/${courseId}/resources`),
  });

  const rows = resources.data?.data ?? [];
  const total = resources.data?.meta.total ?? rows.length;

  /*
   * A brief can be attached and still be missing from this list, and the commonest
   * reason is not exotic: `DELETE /resources/:id` is a SOFT delete, so the foreign
   * key's `SetNull` never fires for it and the task keeps pointing at a row the list
   * filters out. `GET /resources/:id` filters `deletedAt` too, so no other endpoint
   * recovers the title — the id is genuinely all that is left to show.
   *
   * Rendering it as an explicit option is the difference between "this task has a
   * file you cannot see listed" and an EMPTY control, which every reader of a select
   * takes to mean there is no file at all.
   *
   * Gated on `isSuccess` so the option cannot collide with the real one while the list
   * is in flight; the trigger shows its placeholder for those few milliseconds rather
   * than offering the same value twice.
   */
  const attachedIsMissing =
    value !== '' && resources.isSuccess && !rows.some((r) => r.id === value);

  return (
    <FormField
      label="Attached file"
      hint={briefHint({
        loading: resources.isLoading,
        failed: resources.isError,
        empty: resources.isSuccess && rows.length === 0,
        // The endpoint answers a PAGE, and a course with more resources than the page
        // size carries is a real course. Offering the first twenty without saying so
        // would read as "these are all of them".
        truncated: total > rows.length,
        shown: rows.length,
        total,
      })}
      error={error}
    >
      <Select
        value={value === '' ? NO_FILE : value}
        disabled={disabled || resources.isLoading}
        onValueChange={(next) => onChange(next === NO_FILE ? '' : next)}
      >
        <SelectTrigger placeholder="No file" />
        <SelectContent>
          <SelectItem value={NO_FILE}>{NO_FILE_LABEL}</SelectItem>
          {attachedIsMissing ? (
            <SelectItem
              value={value}
              hint="Attached to this task, but no longer among this course’s resources."
            >
              {MISSING_LABEL}
            </SelectItem>
          ) : null}
          {rows.map((row) => (
            <SelectItem key={row.id} value={row.id}>
              {row.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  );
}

/**
 * One short paragraph, because a hint that changes shape as the query settles is
 * harder to read than a plain one that is always there.
 *
 * The failed case is where optionality becomes load-bearing rather than decorative: a
 * course whose resources will not load must still be able to set a task, so this says
 * so rather than leaving a dead control to look like the only way in.
 */
function briefHint(state: {
  loading: boolean;
  failed: boolean;
  empty: boolean;
  truncated: boolean;
  shown: number;
  total: number;
}): string {
  if (state.loading) return 'Loading this course’s files…';
  if (state.failed) {
    return 'This course’s files could not be loaded, so none can be attached. The task above is the whole brief.';
  }
  if (state.empty) {
    return 'This course has no files yet. Optional — add one on the Resources tab and attach it here.';
  }
  const base =
    'Optional. A file from this course’s resources, for the student to open alongside it.';
  return state.truncated
    ? `${base} Showing ${state.shown} of ${state.total} — the rest are on the Resources tab.`
    : base;
}
