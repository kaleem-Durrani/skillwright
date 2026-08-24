/**
 * Pins the three offering derivations every course surface shares, because they are
 * the whole client-side half of the Phase 9 contract:
 *
 * - the wire orders intakes soonest-start first, so "first with seats" IS "soonest
 *   open" — a sort here would fork the ordering the detail page renders;
 * - the course-level viewer status exists only because `enrolledApproved` reads one
 *   status per course; APPROVED on ANY intake must win (the server's own rule,
 *   courses.service.ts's `courseEnrollmentStatus`), or an approved student loses
 *   resource access the API would serve — LESSONS-LEARNED #31 in offering dress.
 */
import { describe, expect, it } from 'vitest';
import type { ViewerCourseOffering } from '@/lib/types';
import { formatDate } from '@/lib/format';
import { courseViewerStatus, formatOfferingDates, soonestOpenOffering } from './offerings.js';

function offering(overrides: Partial<ViewerCourseOffering> = {}): ViewerCourseOffering {
  return {
    id: '01JGXDFAM0K2Z1GYCSNM5F5RC1',
    startDate: '2026-09-01T09:00:00.000Z',
    endDate: '2026-12-15T17:00:00.000Z',
    capacity: 12,
    workshopCapacity: null,
    approvedCount: 3,
    seatsRemaining: 9,
    isFull: false,
    workshopSeatsRemaining: null,
    viewerEnrollmentStatus: null,
    ...overrides,
  };
}

describe('soonestOpenOffering', () => {
  it('takes the FIRST intake with seats, trusting the wire order', () => {
    const autumn = offering({ id: 'autumn' });
    const spring = offering({ id: 'spring' });
    expect(soonestOpenOffering([autumn, spring])).toBe(autumn);
  });

  it('skips past full intakes to the next open one', () => {
    const full = offering({ id: 'full', isFull: true, seatsRemaining: 0 });
    const open = offering({ id: 'open' });
    expect(soonestOpenOffering([full, open])).toBe(open);
  });

  it('answers undefined when every intake is full', () => {
    expect(soonestOpenOffering([offering({ isFull: true })])).toBeUndefined();
    expect(soonestOpenOffering([])).toBeUndefined();
  });
});

describe('courseViewerStatus', () => {
  it('lets an APPROVED seat on any intake win over a newer rejection elsewhere', () => {
    const statuses = [
      offering({ id: 'a', viewerEnrollmentStatus: 'REJECTED' }),
      offering({ id: 'b', viewerEnrollmentStatus: 'APPROVED' }),
    ];
    expect(courseViewerStatus(statuses)).toBe('APPROVED');
  });

  it('falls back to the first intake that carries a non-APPROVED status', () => {
    const statuses = [
      offering({ id: 'a', viewerEnrollmentStatus: null }),
      offering({ id: 'b', viewerEnrollmentStatus: 'PENDING' }),
    ];
    expect(courseViewerStatus(statuses)).toBe('PENDING');
  });

  it('is null for a viewer no intake names — anonymous, teachers, admins', () => {
    expect(courseViewerStatus([offering(), offering({ viewerEnrollmentStatus: null })])).toBeNull();
    expect(courseViewerStatus([])).toBeNull();
  });
});

describe('formatOfferingDates', () => {
  // Expected values are composed from `formatDate` ITSELF, never spelled out: the
  // helper must join the two ends it is given, not commit to a locale's word order
  // (the same discipline that keeps the register tests off any fixed calendar).
  const START = '2026-09-01T09:00:00.000Z';
  const END = '2026-12-15T17:00:00.000Z';

  it('joins both ends through an en dash', () => {
    expect(formatOfferingDates(offering({ startDate: START, endDate: END }))).toBe(
      `${formatDate(START)} – ${formatDate(END)}`,
    );
  });

  it('says what is known when only one end is set', () => {
    expect(formatOfferingDates(offering({ startDate: START, endDate: null }))).toBe(
      `From ${formatDate(START)}`,
    );
    expect(formatOfferingDates(offering({ startDate: null, endDate: END }))).toBe(
      `Until ${formatDate(END)}`,
    );
  });

  it('admits an unscheduled intake rather than rendering dashes', () => {
    expect(formatOfferingDates(offering({ startDate: null, endDate: null }))).toBe(
      'Dates to be announced',
    );
  });
});
