import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MarkRegisterInput } from '@skillwright/shared/schema';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { qk } from '@/lib/query';
import type {
  AttendanceRegisterDto,
  AttendanceRegisterRow,
  AttendanceStatusValue,
} from '@/lib/types';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { FormField } from '@/components/ui/FormField';
import { Input } from '@/components/ui/Input';
import { SkeletonList } from '@/components/ui/Skeleton';
import { StatusChip } from '@/components/ui/StatusChip';
import { toast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/problem';

/** A session date is a DAY — today, in the viewer's own calendar, no UTC shift. */
function todayISO(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * What one seat holds while it is being worked on: the chosen mark (null until a
 * radio is picked) and the optional note exactly as typed.
 */
interface SeatDraft {
  status: AttendanceStatusValue | null;
  note: string;
}

type RegisterDraft = Record<string, SeatDraft>;

const STATUS_CHOICES: ReadonlyArray<{ value: AttendanceStatusValue; label: string }> = [
  { value: 'PRESENT', label: 'Present' },
  { value: 'ABSENT', label: 'Absent' },
  { value: 'LATE', label: 'Late' },
];

/**
 * One choice of three, styled as a segmented control but BUILT as native radios.
 *
 * The pattern is deliberate: a segmented control made of buttons loses arrow-key
 * movement between the options and makes every option a tab stop; a native radio
 * group is one tab stop whose arrows move within it, for free, on every platform.
 * The visible pills are the LABELS — the inputs themselves are visually hidden but
 * stay in the accessibility tree, so screen readers announce "Present, radio
 * button, 1 of 3" exactly as they do anywhere else on the web.
 */
function StatusPicker({
  name,
  legend,
  value,
  onSelect,
}: {
  name: string;
  legend: string;
  value: AttendanceStatusValue | null;
  onSelect: (status: AttendanceStatusValue) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="sr-only">{legend}</legend>
      <div className="grid grid-cols-3 gap-1.5">
        {STATUS_CHOICES.map((choice) => (
          <label
            key={choice.value}
            className={[
              'flex min-h-11 cursor-pointer items-center justify-center rounded-md border px-1 text-sm font-medium select-none',
              'border-[var(--control-border)] bg-[var(--control-bg)] text-fg-secondary',
              'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)]',
              'has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:checked]:text-brand-on-soft',
              // The ring paints on the LABEL when the hidden radio takes focus —
              // `outline-solid` because an `outline-none` sibling on the same element
              // sets Tailwind's outline-style variable to none (see CourseDetail.tsx).
              'has-[:focus-visible]:outline-solid has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-line-focus',
            ].join(' ')}
          >
            <input
              type="radio"
              name={name}
              value={choice.value}
              checked={value === choice.value}
              onChange={() => onSelect(choice.value)}
              className="sr-only"
            />
            {choice.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * One seat: who, their loaded state for this date, the choice, the note.
 *
 * Stacked cards at EVERY width — the register is a vertical list by nature, and
 * `DataList` would mean rendering its two copies side by side in the DOM, which
 * would put two same-named radio groups per student on the page at once.
 */
function RegisterRow({
  row,
  draft,
  onStatus,
  onNote,
}: {
  row: AttendanceRegisterRow;
  draft: SeatDraft;
  onStatus: (status: AttendanceStatusValue) => void;
  onNote: (note: string) => void;
}) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar name={row.student.name} src={row.student.avatarUrl} size="sm" />
          <span className="truncate text-sm font-medium text-fg">{row.student.name}</span>
        </div>
        {/* What the LOADED date already records — independent of the draft below. */}
        {row.status ? (
          <StatusChip status={row.status} />
        ) : (
          <span className="shrink-0 pt-1 text-2xs text-fg-tertiary">Not marked</span>
        )}
      </div>

      {row.markedBy ? (
        <p className="text-2xs text-fg-tertiary">Recorded by {row.markedBy.name}</p>
      ) : null}

      <StatusPicker
        name={`attendance-${row.enrollmentId}`}
        legend={`Attendance for ${row.student.name}`}
        value={draft.status}
        onSelect={onStatus}
      />

      <Input
        aria-label={`Note for ${row.student.name}`}
        placeholder="Note (optional)"
        maxLength={500}
        value={draft.note}
        onChange={(event) => onNote(event.target.value)}
      />
    </Card>
  );
}

export interface AttendanceRegisterProps {
  courseId: string;
}

/**
 * The whole register for one session, saved as ONE action.
 *
 * The API is bulk (`PUT /courses/:id/attendance`), so the UI is too: the teacher
 * works down the roster choosing present/absent/late, and a single Save sends one
 * request carrying exactly the seats they chose a mark for — unmarked seats are
 * omitted rather than sent as nulls, because the wire schema has no null status
 * and "not marked yet" must stay distinguishable from "marked".
 *
 * Draft state is SEEDED FROM THE SERVER, not merged into it: whenever a register
 * arrives (first load, a date change, or the response to a save), the draft is
 * rebuilt from what the database records. Editing against a stale register would
 * silently overwrite a colleague's marks with a view of the roster from before
 * they were approved — so the server's answer always wins, and the 409 path below
 * says so out loud when it happens mid-save.
 */
export function AttendanceRegister({ courseId }: AttendanceRegisterProps) {
  const client = useQueryClient();
  const [date, setDate] = useState(todayISO);
  const [conflict, setConflict] = useState(false);
  const [draft, setDraft] = useState<RegisterDraft>({});

  const register = useQuery({
    queryKey: qk.courseAttendance(courseId, date),
    queryFn: () =>
      api.get<AttendanceRegisterDto>(`/courses/${courseId}/attendance`, { query: { date } }),
  });

  useEffect(() => {
    const data = register.data;
    if (!data) return;
    setConflict(false);
    setDraft(
      Object.fromEntries(
        data.rows.map((row): [string, SeatDraft] => [
          row.enrollmentId,
          { status: row.status, note: row.note ?? '' },
        ]),
      ),
    );
  }, [register.data]);

  const saveMarking = useMutation({
    mutationFn: (input: MarkRegisterInput) =>
      api.put<AttendanceRegisterDto>(`/courses/${courseId}/attendance`, input),
    onSuccess: (saved) => {
      // The response IS the register as it now reads — same schema as the GET —
      // so it becomes the cached answer for this date and the reseed below runs
      // against server truth (notes included) without a second round trip.
      client.setQueryData(qk.courseAttendance(courseId, date), saved);
      toast.success('Register saved', {
        description: `Attendance for ${formatDate(date)} has been recorded.`,
      });
    },
    onError: (error) => {
      /*
       * 409 means the APPROVED roster moved between our read and our write — a
       * request approved while the teacher was marking. That is not a toast-sized
       * problem: the rows on screen are no longer the roster, and saving again
       * would fail again. It gets the page's own voice — honest copy plus the
       * refetch that fixes it — and the copy admits the cost: reloading discards
       * unsaved choices, because the draft is rebuilt from the server.
       */
      if (error instanceof ApiError && error.is('CONFLICT')) {
        setConflict(true);
        return;
      }
      toast.fromError(error, 'Could not save the register');
    },
  });

  const rows = register.data?.rows ?? [];
  const seats = rows.map((row) => ({ row, entry: draft[row.enrollmentId] }));

  const setStatus = (enrollmentId: string, status: AttendanceStatusValue) =>
    setDraft((current) => {
      const seat = current[enrollmentId] ?? { status: null, note: '' };
      return { ...current, [enrollmentId]: { ...seat, status } };
    });

  const setNote = (enrollmentId: string, note: string) =>
    setDraft((current) => {
      const seat = current[enrollmentId] ?? { status: null, note: '' };
      return { ...current, [enrollmentId]: { ...seat, note } };
    });

  /** Exactly the seats with a chosen mark — the body the wire schema actually allows. */
  const markedInput = (): MarkRegisterInput => ({
    date,
    marks: rows.flatMap((row) => {
      const entry = draft[row.enrollmentId];
      if (!entry?.status) return [];
      const note = entry.note.trim();
      return [
        // Omitted note preserves whatever is already recorded (the shared schema's
        // contract); an emptied one does not — typing then clearing a note is intent.
        { enrollmentId: row.enrollmentId, status: entry.status, ...(note === '' ? {} : { note }) },
      ];
    }),
  });

  const markedCount = rows.filter((row) => draft[row.enrollmentId]?.status).length;

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-0.5">
          <CardTitle>Attendance register</CardTitle>
          <p className="text-sm text-fg-secondary">
            Take the roll for one session and save the day as one action.
          </p>
        </div>
        <FormField label="Session date" className="md:w-56">
          <Input
            type="date"
            value={date}
            onChange={(event) => {
              setConflict(false);
              setDate(event.target.value || todayISO());
            }}
          />
        </FormField>
      </div>

      {conflict ? (
        <EmptyState
          variant="error"
          title="The class list changed"
          description="Someone's enrolment was approved or removed while you were marking, so this register is out of date. Load the current one to continue — choices you have not saved yet will be replaced by what is recorded."
          actionLabel="Load the current register"
          onAction={() => {
            // Cleared HERE, not only in the seed effect: a refetch that answers
            // byte-identical rows keeps the old data reference (structural
            // sharing), so an effect keyed on the data alone would leave this
            // panel standing over a register that has already been replaced.
            setConflict(false);
            register.refetch();
          }}
        />
      ) : register.isPending ? (
        <SkeletonList rows={3} />
      ) : register.isError ? (
        <EmptyState
          variant="error"
          description="The register for this date could not be loaded."
          actionLabel="Try again"
          onAction={() => register.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          variant="empty"
          compact
          title="No approved students yet"
          description="Approve enrolment requests in the list below and they will appear on the register."
        />
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {seats.map(({ row, entry }) => (
              <li key={row.enrollmentId}>
                <RegisterRow
                  row={row}
                  draft={entry ?? { status: null, note: '' }}
                  onStatus={(status) => setStatus(row.enrollmentId, status)}
                  onNote={(note) => setNote(row.enrollmentId, note)}
                />
              </li>
            ))}
          </ul>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            {/* Polite live region: the count moves as radios turn, never interrupting. */}
            <p aria-live="polite" className="text-xs text-fg-tertiary">
              {markedCount} of {rows.length} marked
            </p>
            <Button
              block
              className="sm:w-auto sm:self-end"
              loading={saveMarking.isPending}
              disabled={markedCount === 0}
              onClick={() => saveMarking.mutate(markedInput())}
            >
              Save register
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
