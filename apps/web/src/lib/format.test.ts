/**
 * The formatting helpers, which are centralised precisely so that twelve
 * components cannot show three different date formats on one screen.
 *
 * Nothing here asserts an English string for a date: the formatters take the
 * runtime's locale, and pinning "5 Mar 2026" would make these tests a statement
 * about the CI container's ICU data rather than about the code. What IS pinned is
 * everything the code actually decides — the absent-value placeholder, the unit
 * ladder `formatRelative` walks, where `formatBytes` stops, and the monogram
 * `initials` produces for the names real people have.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  formatBytes,
  formatDate,
  formatDateTime,
  formatDuration,
  formatRelative,
  formatTime,
  initials,
} from './format.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('absent values', () => {
  it('render an em dash rather than "Invalid Date"', () => {
    // Every one of these is fed a nullable column. `new Date(null)` is the epoch
    // and `new Date(undefined)` is Invalid Date, so without the guard a missing
    // `lastLoginAt` reads as 1 Jan 1970 or as a browser error string on screen.
    for (const format of [formatDate, formatDateTime, formatTime, formatRelative]) {
      expect(format(null)).toBe('—');
      expect(format(undefined)).toBe('—');
      expect(format('')).toBe('—');
    }
  });
});

describe('dates', () => {
  const MOMENT = '2026-03-05T14:30:00.000Z';

  it('treat an ISO string and a Date as the same instant', () => {
    // The wire sends strings and components frequently hold Dates. The two paths
    // must not diverge, or the same timestamp reads differently on two screens.
    expect(formatDate(MOMENT)).toBe(formatDate(new Date(MOMENT)));
    expect(formatDateTime(MOMENT)).toBe(formatDateTime(new Date(MOMENT)));
    expect(formatTime(MOMENT)).toBe(formatTime(new Date(MOMENT)));
  });

  it('drop the year from a date-time and the date from a time', () => {
    // The three exist because they carry different amounts of context, and a
    // regression that collapsed them would be invisible except as clutter.
    expect(formatDateTime(MOMENT).length).toBeLessThan(
      `${formatDate(MOMENT)} ${formatTime(MOMENT)}`.length,
    );
    expect(formatTime(MOMENT).length).toBeLessThan(formatDateTime(MOMENT).length);
  });
});

describe('formatRelative', () => {
  const NOW = new Date('2026-03-05T12:00:00.000Z');
  /** The same formatter the module uses, so only the UNIT choice is asserted. */
  const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

  function at(offsetSeconds: number): string {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    return formatRelative(new Date(NOW.getTime() + offsetSeconds * 1000));
  }

  it('walks the ladder from seconds to years', () => {
    // The spans are 60/60/24/7/4.348/12: each one is the number of the smaller
    // unit in the larger. Getting one wrong does not throw — it reports "45
    // minutes ago" as "45 hours ago", which reads as a data problem.
    expect(at(-30)).toBe(relative.format(-30, 'second'));
    expect(at(-45 * 60)).toBe(relative.format(-45, 'minute'));
    expect(at(-2 * 3600)).toBe(relative.format(-2, 'hour'));
    expect(at(-3 * 86400)).toBe(relative.format(-3, 'day'));
    expect(at(-3 * 7 * 86400)).toBe(relative.format(-3, 'week'));

    // Every offset above tops out at 3 weeks, so the ladder's last two rungs —
    // month (span 12) and year (span Infinity) — were never reached by this
    // file, and a mutant that shrank the month span from 12 to 1 passed the
    // whole suite. `4.348 * 7 * 86400` is one MONTH in the ladder's own units
    // (a week's seconds times the weeks-per-month constant the loop divides
    // by), so a multiple of it lands the offset exactly on the rung under
    // test, with an integer number of months/years for Math.round to land on.
    const MONTH_SECONDS = 4.348 * 7 * 86400;
    const YEAR_SECONDS = MONTH_SECONDS * 12;
    expect(at(-2 * MONTH_SECONDS)).toBe(relative.format(-2, 'month'));
    expect(at(-2 * YEAR_SECONDS)).toBe(relative.format(-2, 'year'));
  });

  it('says "in" for something still ahead', () => {
    // Course start dates and enrolment deadlines are usually in the future, so the
    // sign has to survive the loop.
    expect(at(3 * 86400)).toBe(relative.format(3, 'day'));
  });

  it('answers the em dash for a date it cannot parse, not "Invalid Date"', () => {
    // The ladder's last span is POSITIVE_INFINITY, so a finite delta always returns
    // inside the loop and only NaN ever reached the line after it — where it rendered
    // the literal string 'Invalid Date' into the UI. Every other guard here says '—'.
    expect(formatRelative('not-a-date')).toBe('—');
    expect(formatRelative(new Date('nonsense'))).toBe('—');
  });
});

describe('formatBytes', () => {
  it('keeps plain bytes plain', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('shows one decimal below ten and none above', () => {
    // 1.4 MB is useful; 1.4213 MB is noise and 1 MB loses the distinction between
    // a 1.0 MB and a 1.9 MB upload against a limit.
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(10 * 1024)).toBe('10 KB');
    expect(formatBytes(1024 ** 2)).toBe('1.0 MB');
    expect(formatBytes(1024 ** 3)).toBe('1.0 GB');
  });

  it('stops at gigabytes rather than running off the unit list', () => {
    // The loop is bounded by `units.length - 1`, so a terabyte reads as 1024 GB.
    // That is the correct answer for this app — nothing it stores is a terabyte —
    // and it is stated here so the bound is a decision rather than an accident.
    expect(formatBytes(1024 ** 4)).toBe('1024 GB');
  });
});

describe('formatDuration', () => {
  it('pluralises on the number and lower-cases the unit', () => {
    // The unit arrives from the API in whatever case the column holds.
    expect(formatDuration(1, 'Week')).toBe('1 week');
    expect(formatDuration(12, 'WEEK')).toBe('12 weeks');
    expect(formatDuration(0, 'month')).toBe('0 months');
  });
});

describe('initials', () => {
  it('takes the first and last name, which is what a monogram means', () => {
    expect(initials('Ada Okafor')).toBe('AO');
    // A middle name must not push the surname out of the monogram.
    expect(initials('Ada Grace Okafor')).toBe('AO');
  });

  it('uses two letters of a single name', () => {
    expect(initials('Ada')).toBe('AD');
    expect(initials('A')).toBe('A');
  });

  it('survives the whitespace real records carry', () => {
    expect(initials('  ada   okafor  ')).toBe('AO');
  });

  it('has something to render for an empty name', () => {
    // The avatar fallback renders this unconditionally; an empty string collapses
    // the circle and a crash inside a list item takes the whole list with it.
    expect(initials('')).toBe('?');
    expect(initials('   ')).toBe('?');
  });
});
