/**
 * Formatting helpers. Centralised because `toLocaleDateString` with different
 * option bags in twelve components is how a UI ends up showing three different
 * date formats on one screen.
 */

const dateFmt = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const dateTimeFmt = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});

const relativeFmt = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return dateFmt.format(new Date(value));
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return dateTimeFmt.format(new Date(value));
}

export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return timeFmt.format(new Date(value));
}

const RELATIVE_STEPS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['second', 60],
  ['minute', 60],
  ['hour', 24],
  ['day', 7],
  ['week', 4.348],
  ['month', 12],
  ['year', Number.POSITIVE_INFINITY],
];

export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return '—';

  const at = new Date(value).getTime();
  /*
   * An unparseable date reads as the em dash, exactly like a missing one.
   *
   * This used to fall through the ladder instead. `year`'s span is
   * `POSITIVE_INFINITY`, so `Math.abs(delta) < span` is true for every finite
   * delta and the loop always returns there — which makes the line after the loop
   * unreachable for any VALID date, and reachable only for `NaN`, where it
   * rendered the literal string "Invalid Date" into the UI. Every other guard in
   * this module answers "—" for a value it cannot format; this one now agrees
   * rather than being the one place a user sees a JavaScript artefact.
   */
  if (Number.isNaN(at)) return '—';

  let delta = (at - Date.now()) / 1000;
  for (const [unit, span] of RELATIVE_STEPS) {
    if (Math.abs(delta) < span) return relativeFmt.format(Math.round(delta), unit);
    delta /= span;
  }
  // Unreachable while the ladder ends at an infinite span; kept as the honest
  // total-function answer if a finite year span is ever introduced.
  return dateFmt.format(new Date(value));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[index]}`;
}

export function formatDuration(value: number, unit: string): string {
  const label = unit.toLowerCase();
  return `${value} ${value === 1 ? label : `${label}s`}`;
}

/** Two-letter monogram for an avatar fallback. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}
