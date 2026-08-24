import type { AttendanceSummaryDto } from '@/lib/types';
import { formatDate } from '@/lib/format';
import { StatusChip } from '@/components/ui/StatusChip';

/**
 * One enrolment's attendance at a glance: the counts, then the recent rows.
 *
 * Purely presentational — the gated fetch lives in `EnrollmentAttendance`, which
 * knows the subject shape `attendance:read` asks about. This file renders whatever
 * that fetch brought back and nothing else.
 *
 * The count tiles are a `dl`, not three chips: these are numbers first, statuses
 * second, and the register's own vocabulary (Present/Absent/Late) is spelled out
 * in full-size words rather than abbreviated into badges.
 */
export function AttendanceSummary({ summary }: { summary: AttendanceSummaryDto }) {
  const counts = [
    { label: 'Present', value: summary.counts.present },
    { label: 'Absent', value: summary.counts.absent },
    { label: 'Late', value: summary.counts.late },
  ];

  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-3 gap-2">
        {counts.map((count) => (
          <div key={count.label} className="flex flex-col gap-0.5 rounded-md bg-sunken px-2.5 py-2">
            <dt className="text-2xs tracking-wide text-fg-tertiary uppercase">{count.label}</dt>
            <dd className="text-lg leading-none font-semibold tabular-nums text-fg">
              {count.value}
            </dd>
          </div>
        ))}
      </dl>

      {summary.recent.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-2xs font-semibold tracking-wide text-fg-tertiary uppercase">
            Recent sessions
          </p>
          <ul aria-label="Recent sessions" className="flex flex-col divide-y divide-line-subtle">
            {summary.recent.map((record) => (
              <li key={record.id} className="flex items-center justify-between gap-2 py-1.5">
                {/*
                  One truncating line for date and note: a wrapped note would make a
                  ten-row list taller than the counts above it, and the note is the
                  detail that may be sacrificed at 375px.
                */}
                <span className="min-w-0 flex-1 truncate text-sm text-fg-secondary">
                  {formatDate(record.sessionDate)}
                  {record.note ? <span className="text-fg-tertiary"> · {record.note}</span> : null}
                </span>
                <StatusChip status={record.status} />
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-fg-secondary">No sessions recorded yet.</p>
      )}
    </div>
  );
}
