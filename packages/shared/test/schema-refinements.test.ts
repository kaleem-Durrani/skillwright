import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  UPLOAD_LIMITS,
  courseCodeSchema,
  createAnnouncementSchema,
  createCommentSchema,
  createCourseOfferingInputSchema,
  createCourseSchema,
  createResourceSchema,
  createUserSchema,
  durationSchema,
  markRegisterBodySchema,
  presignUploadSchema,
  sendMessageSchema,
  sessionDateSchema,
  updateAnnouncementSchema,
  updateCourseOfferingInputSchema,
  updateCourseSchema,
  updateDepartmentSchema,
  updateResourceSchema,
  updateUserSchema,
} from '../src/schema/index.js';

/**
 * The conditional rules — every `refine` and `superRefine` in the schema package.
 *
 * These are the branches a plain shape test never reaches, and each one exists because
 * the alternative is a 500 rather than a 422: a teacher with no department violates a
 * Restrict FK at insert time, a resource with two sources violates the CHECK from
 * migration 0002, an intake whose end precedes its start violates a CHECK of its own.
 * The schema is supposed to be where the user reads a sentence about it, with the
 * database constraint as the backstop. Asserting the ISSUE PATH is the point: a rule
 * that fires with no path produces a 422 the form cannot attach to any input, which
 * renders as an error message floating above a page with nothing highlighted.
 */

const ULID = '01JGXDFAM0K2Z1GYCSNM5F5RCX';
const CUID = 'cmsvme3r703ucw4g0i6oyh6fh';

/** The issue paths of a failed parse, in order, so a case can assert on all of them. */
const pathsOf = (result: z.SafeParseReturnType<unknown, unknown>): string[][] => {
  if (result.success) throw new Error('expected the parse to fail');
  return result.error.issues.map((issue) => issue.path.map(String));
};

describe('createUserSchema', () => {
  const base = { email: 'ann@example.com', name: 'Ann Rafiq' };

  it('lets an admin be created with no department', () => {
    // Admins are not seated in a department; requiring one would make the first
    // account impossible to provision.
    expect(createUserSchema.safeParse({ ...base, role: 'ADMIN' }).success).toBe(true);
  });

  it('requires a department for a teacher and for a student', () => {
    // Both profile tables carry a Restrict FK to Department. This is the difference
    // between a field-level 422 on the form and a foreign-key 500 from Prisma.
    for (const role of ['TEACHER', 'STUDENT']) {
      const result = createUserSchema.safeParse({ ...base, role, qualification: 'MSc' });
      expect(pathsOf(result), role).toEqual([['departmentId']]);
    }
  });

  it('requires a qualification for a teacher only', () => {
    expect(
      pathsOf(createUserSchema.safeParse({ ...base, role: 'TEACHER', departmentId: ULID })),
    ).toEqual([['qualification']]);
    expect(
      createUserSchema.safeParse({ ...base, role: 'STUDENT', departmentId: ULID }).success,
    ).toBe(true);
  });

  it('reports both missing fields at once rather than one per round trip', () => {
    // `superRefine` adds issues instead of returning on the first, so the form fills
    // in every error in one submit. A `refine` chain would leak them one at a time.
    expect(pathsOf(createUserSchema.safeParse({ ...base, role: 'TEACHER' }))).toEqual([
      ['departmentId'],
      ['qualification'],
    ]);
  });

  it('accepts a fully specified teacher', () => {
    expect(
      createUserSchema.safeParse({
        ...base,
        role: 'TEACHER',
        departmentId: ULID,
        qualification: 'MSc Welding Engineering',
      }).success,
    ).toBe(true);
  });
});

describe('the "at least one field" guard on PATCH bodies', () => {
  it('refuses an empty body on every partial update schema', () => {
    // `.partial()` makes every key optional, which makes `{}` valid unless something
    // says otherwise — and `{}` reaches the service as an update with no columns,
    // which Prisma happily executes and answers 200 to. The user sees success and
    // nothing changed.
    const partials: Array<[string, z.ZodTypeAny]> = [
      ['updateUserSchema', updateUserSchema],
      ['updateResourceSchema', updateResourceSchema],
      ['updateDepartmentSchema', updateDepartmentSchema],
    ];
    for (const [name, schema] of partials) {
      expect(schema.safeParse({}).success, name).toBe(false);
    }
  });

  it('accepts a body with exactly one field', () => {
    expect(updateUserSchema.safeParse({ bio: null }).success).toBe(true);
    expect(updateResourceSchema.safeParse({ isPublic: true }).success).toBe(true);
    expect(updateDepartmentSchema.safeParse({ description: null }).success).toBe(true);
  });

  /*
   * `updateCourseSchema` is deliberately NOT in that list — it is `.partial()` with no
   * guard. Pinning it here means removing the guard from one of the three above shows
   * up as a failure rather than as consistency.
   */
  it('is absent from updateCourseSchema, which accepts an empty body', () => {
    expect(updateCourseSchema.safeParse({}).success).toBe(true);
  });
});

describe('updateUserSchema nullability', () => {
  it('clears a phone number with null and refuses the empty string', () => {
    // The recorded Phase-4b bug: Settings.tsx sent `phoneNumber: ''` where the schema
    // requires null, so every profile save answered 422 and the form said nothing
    // useful. Null is "clear it"; '' is not a phone number.
    expect(updateUserSchema.safeParse({ phoneNumber: null }).success).toBe(true);
    expect(updateUserSchema.safeParse({ phoneNumber: '' }).success).toBe(false);
    expect(updateUserSchema.safeParse({ phoneNumber: '+92 300 1234567' }).success).toBe(true);
  });

  it('lets the two nullable profile columns be cleared and the NOT NULL one not', () => {
    // `TeacherProfile.qualification` is NOT NULL, so it can change but never clear;
    // `specialization` and `staffNo` are nullable and null means clear. Getting this
    // backwards is a NOT NULL violation from inside a transaction.
    expect(updateUserSchema.safeParse({ specialization: null }).success).toBe(true);
    expect(updateUserSchema.safeParse({ staffNo: null }).success).toBe(true);
    expect(updateUserSchema.safeParse({ qualification: null }).success).toBe(false);
  });
});

describe('presignUploadSchema', () => {
  it('refuses a MIME type the purpose does not accept, naming the field', () => {
    // The stated reason the purpose exists: without it the avatar endpoint is a way to
    // smuggle a 500 MB video into the bucket under a 2 MB policy.
    const result = presignUploadSchema.safeParse({
      purpose: 'AVATAR',
      originalName: 'clip.mp4',
      contentType: 'video/mp4',
      sizeBytes: 1024,
    });
    expect(pathsOf(result)).toEqual([['contentType']]);
  });

  it('holds each purpose to its own byte ceiling, inclusive', () => {
    // `>` not `>=`: a file exactly at the limit is allowed, because the presigned POST
    // policy on the other side of this check uses the same number.
    const avatar = (sizeBytes: number) => ({
      purpose: 'AVATAR' as const,
      originalName: 'me.png',
      contentType: 'image/png',
      sizeBytes,
    });
    const limit = UPLOAD_LIMITS.AVATAR.maxBytes;
    expect(limit).toBe(2 * 1024 * 1024);
    expect(presignUploadSchema.safeParse(avatar(limit)).success).toBe(true);
    expect(pathsOf(presignUploadSchema.safeParse(avatar(limit + 1)))).toEqual([['sizeBytes']]);
  });

  it('reports a wrong type and an oversize body as two separate field errors', () => {
    const result = presignUploadSchema.safeParse({
      purpose: 'AVATAR',
      originalName: 'huge.pdf',
      contentType: 'application/pdf',
      sizeBytes: 3 * 1024 * 1024,
    });
    expect(pathsOf(result)).toEqual([['contentType'], ['sizeBytes']]);
  });

  it('accepts a video only for RESOURCE, and a document for SYLLABUS', () => {
    // RESOURCE is the union of the three MIME sets; SYLLABUS is documents only. If
    // SYLLABUS ever widened to the union, a course syllabus could be a 512 MB video.
    const video = { originalName: 'demo.mp4', contentType: 'video/mp4', sizeBytes: 1024 };
    expect(presignUploadSchema.safeParse({ purpose: 'RESOURCE', ...video }).success).toBe(true);
    expect(presignUploadSchema.safeParse({ purpose: 'SYLLABUS', ...video }).success).toBe(false);
    expect(
      presignUploadSchema.safeParse({
        purpose: 'SYLLABUS',
        originalName: 'syllabus.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1024,
      }).success,
    ).toBe(true);
  });

  it('refuses a zero-byte upload', () => {
    // A presign for nothing leaves a PENDING row for the sweeper and an object the
    // commit step's HeadObject would find empty.
    expect(
      presignUploadSchema.safeParse({
        purpose: 'AVATAR',
        originalName: 'me.png',
        contentType: 'image/png',
        sizeBytes: 0,
      }).success,
    ).toBe(false);
  });

  it('keeps UPLOAD_LIMITS frozen and its ceilings ordered', () => {
    // A request handler that mutated this table would relax the limit for every
    // subsequent request in the process, not just its own.
    expect(Object.isFrozen(UPLOAD_LIMITS)).toBe(true);
    expect(UPLOAD_LIMITS.AVATAR.maxBytes).toBeLessThan(UPLOAD_LIMITS.SYLLABUS.maxBytes);
    expect(UPLOAD_LIMITS.SYLLABUS.maxBytes).toBeLessThan(UPLOAD_LIMITS.RESOURCE.maxBytes);
  });
});

describe('createResourceSchema source rules', () => {
  const base = { courseId: CUID, title: 'Arc length and travel speed', type: 'DOCUMENT' as const };

  it('accepts exactly one source', () => {
    expect(createResourceSchema.safeParse({ ...base, uploadId: ULID }).success).toBe(true);
    expect(
      createResourceSchema.safeParse({
        ...base,
        type: 'LINK',
        externalUrl: 'https://example.com/guide',
      }).success,
    ).toBe(true);
  });

  it('refuses none and refuses both, matching the CHECK from migration 0002', () => {
    // The database constraint is the backstop; this is the sentence the user reads.
    expect(pathsOf(createResourceSchema.safeParse(base))).toEqual([['uploadId']]);
    expect(
      pathsOf(
        createResourceSchema.safeParse({
          ...base,
          uploadId: ULID,
          externalUrl: 'https://example.com/guide',
        }),
      ),
    ).toEqual([['uploadId']]);
  });

  it('refuses a LINK that carries an upload, on the type field', () => {
    // A separate rule from "exactly one source", and it fires on `type` because the
    // fix is to change the type, not to remove the file the user just uploaded.
    expect(
      pathsOf(createResourceSchema.safeParse({ ...base, type: 'LINK', uploadId: ULID })),
    ).toEqual([['type']]);
  });

  it('treats an explicit null the same as an absent field', () => {
    // The fields are `.nullish()`, so a client that serialises "no value" as null must
    // land in the same branch as one that omits the key — otherwise the two clients
    // disagree about whether a resource has a source.
    expect(pathsOf(createResourceSchema.safeParse({ ...base, uploadId: null }))).toEqual([
      ['uploadId'],
    ]);
    expect(
      createResourceSchema.safeParse({ ...base, uploadId: ULID, externalUrl: null }).success,
    ).toBe(true);
  });
});

describe('createCommentSchema target rules', () => {
  it('requires exactly one of resourceId and announcementId', () => {
    // Mirrors `num_nonnulls(resource_id, announcement_id) = 1`. A comment with neither
    // is orphaned; a comment with both appears on two pages and is edited from one.
    expect(pathsOf(createCommentSchema.safeParse({ content: 'Which electrode?' }))).toEqual([
      ['resourceId'],
    ]);
    expect(
      pathsOf(
        createCommentSchema.safeParse({
          content: 'Which electrode?',
          resourceId: CUID,
          announcementId: ULID,
        }),
      ),
    ).toEqual([['resourceId']]);
  });

  it('accepts a reply, which names a parent as well as its one target', () => {
    expect(
      createCommentSchema.safeParse({ content: 'Any 6013.', resourceId: CUID, parentId: ULID })
        .success,
    ).toBe(true);
  });
});

describe('the announcement event-date rule', () => {
  const base = { title: 'Open day', content: 'Doors at nine.' };

  it('refuses an EVENT with no date on create', () => {
    // "An EVENT without a date is a NEWS post wearing a badge" — and the events list
    // filters on `eventDate`, so such a row is invisible everywhere it belongs.
    expect(pathsOf(createAnnouncementSchema.safeParse({ ...base, type: 'EVENT' }))).toEqual([
      ['eventDate'],
    ]);
    expect(
      pathsOf(createAnnouncementSchema.safeParse({ ...base, type: 'EVENT', eventDate: null })),
    ).toEqual([['eventDate']]);
  });

  it('accepts an EVENT with a date, and NEWS without one', () => {
    expect(
      createAnnouncementSchema.safeParse({
        ...base,
        type: 'EVENT',
        eventDate: '2026-09-01T09:00:00Z',
      }).success,
    ).toBe(true);
    expect(createAnnouncementSchema.safeParse({ ...base, type: 'NEWS' }).success).toBe(true);
  });

  it('applies the same rule to the partial update body', () => {
    // The refinement is shared between create and update on purpose; applying it to
    // only one is how a draft NEWS post gets promoted to a dateless EVENT.
    expect(pathsOf(updateAnnouncementSchema.safeParse({ type: 'EVENT' }))).toEqual([['eventDate']]);
    expect(
      updateAnnouncementSchema.safeParse({ type: 'EVENT', eventDate: '2026-09-01T09:00:00Z' })
        .success,
    ).toBe(true);
  });

  it('cannot see the stored row, so clearing a date alone is left to the service', () => {
    // Documented boundary rather than a hole to be plugged here: the refinement reads
    // only the body, and a PATCH of `{ eventDate: null }` against a stored EVENT has
    // no `type` to test. Tightening the schema instead would break every legitimate
    // partial update that does not resend `type`.
    expect(updateAnnouncementSchema.safeParse({ eventDate: null }).success).toBe(true);
  });
});

describe('the offering date rule', () => {
  const dates = { startDate: '2026-09-01T09:00:00Z', endDate: '2026-08-01T09:00:00Z' };

  it('refuses an end before the start, on the end date', () => {
    expect(pathsOf(createCourseOfferingInputSchema.safeParse({ capacity: 24, ...dates }))).toEqual([
      ['endDate'],
    ]);
  });

  it('refuses an end equal to the start', () => {
    // `<=`, not `<`: a zero-length intake has no teaching days and no register.
    const instant = '2026-09-01T09:00:00Z';
    expect(
      createCourseOfferingInputSchema.safeParse({
        capacity: 24,
        startDate: instant,
        endDate: instant,
      }).success,
    ).toBe(false);
  });

  it('says nothing when either end is absent or null', () => {
    // An intake with only a start date is legitimate — the end is set when the cohort
    // finishes — so the rule must not fire on a half-specified pair.
    expect(
      createCourseOfferingInputSchema.safeParse({ capacity: 24, startDate: dates.startDate })
        .success,
    ).toBe(true);
    expect(
      createCourseOfferingInputSchema.safeParse({ capacity: 24, endDate: dates.startDate }).success,
    ).toBe(true);
    expect(
      createCourseOfferingInputSchema.safeParse({ capacity: 24, startDate: null, endDate: null })
        .success,
    ).toBe(true);
  });

  it('is shared by the update body, which is the only reason it is a named function', () => {
    expect(pathsOf(updateCourseOfferingInputSchema.safeParse(dates))).toEqual([['endDate']]);
    expect(
      updateCourseOfferingInputSchema.safeParse({
        startDate: dates.endDate,
        endDate: dates.startDate,
      }).success,
    ).toBe(true);
  });
});

describe('offering capacity', () => {
  it('refuses a capacity of zero on create', () => {
    // An intake nobody can be approved into. The CHECK in the migration keeps the row
    // sane; this is what stops the request in the first place.
    expect(createCourseOfferingInputSchema.safeParse({ capacity: 0 }).success).toBe(false);
    expect(createCourseOfferingInputSchema.safeParse({ capacity: 1 }).success).toBe(true);
  });

  it('accepts null for workshopCapacity on update but not on create', () => {
    // The asymmetry is deliberate and easy to "tidy" away. On create, omitting the key
    // means unbound — a lecture intake. On update, only an explicit null can CLEAR a
    // bound that is already stored, because an omitted key means "leave it alone".
    expect(updateCourseOfferingInputSchema.safeParse({ workshopCapacity: null }).success).toBe(
      true,
    );
    expect(
      createCourseOfferingInputSchema.safeParse({ capacity: 24, workshopCapacity: null }).success,
    ).toBe(false);
    expect(createCourseOfferingInputSchema.safeParse({ capacity: 24 }).success).toBe(true);
  });
});

describe('updateCourseSchema.prerequisiteCourseId', () => {
  it('accepts an explicit null, which is how the rung is cleared', () => {
    // Nullable and not merely optional: an omitted key leaves the requirement in
    // place, so without null there is no way to un-gate a course.
    expect(updateCourseSchema.safeParse({ prerequisiteCourseId: null }).success).toBe(true);
    expect(updateCourseSchema.safeParse({ prerequisiteCourseId: ULID }).success).toBe(true);
    expect(updateCourseSchema.safeParse({ prerequisiteCourseId: 'not-an-id' }).success).toBe(false);
  });
});

describe('createCourseSchema', () => {
  const base = {
    code: 'WELD-101',
    name: 'Shielded Metal Arc Welding',
    departmentId: CUID,
    duration: { value: 6, unit: 'MONTH' as const },
  };

  it('requires at least one intake', () => {
    // Since Phase 9 dates and seats live on an offering, so a course created with none
    // has no dates, no capacity and nothing for a student to enrol in.
    expect(createCourseSchema.safeParse({ ...base, offerings: [] }).success).toBe(false);
    expect(createCourseSchema.safeParse({ ...base, offerings: [{ capacity: 24 }] }).success).toBe(
      true,
    );
  });

  it('caps the intakes in one request', () => {
    const offerings = Array.from({ length: 51 }, () => ({ capacity: 1 }));
    expect(createCourseSchema.safeParse({ ...base, offerings }).success).toBe(false);
    expect(
      createCourseSchema.safeParse({ ...base, offerings: offerings.slice(0, 50) }).success,
    ).toBe(true);
  });

  it('validates each intake, with the index in the issue path', () => {
    // Without the index the form cannot say which of five intakes has the bad dates.
    const result = createCourseSchema.safeParse({
      ...base,
      offerings: [
        { capacity: 24 },
        { capacity: 24, startDate: '2026-09-01T09:00:00Z', endDate: '2026-08-01T09:00:00Z' },
      ],
    });
    expect(pathsOf(result)).toEqual([['offerings', '1', 'endDate']]);
  });
});

describe('courseCodeSchema', () => {
  it('uppercases, so a code typed in lower case is not a second course', () => {
    expect(courseCodeSchema.parse('  weld-101  ')).toBe('WELD-101');
  });

  it('requires the letters-hyphen-digits shape', () => {
    for (const bad of ['WELD101', 'W-101', 'WELD-1', 'WELDING-12345', 'WELD-101-A', '']) {
      expect(courseCodeSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('durationSchema', () => {
  it('refuses a zero-length course and an absurd one', () => {
    // The value is a number precisely so it can be sorted and summed; a zero would
    // sort first in every catalogue listing and mean nothing.
    expect(durationSchema.safeParse({ value: 0, unit: 'WEEK' }).success).toBe(false);
    expect(durationSchema.safeParse({ value: 1001, unit: 'WEEK' }).success).toBe(false);
    expect(durationSchema.safeParse({ value: 6, unit: 'MONTH' }).success).toBe(true);
  });

  it('refuses a free-text unit, which is what this shape replaced', () => {
    expect(durationSchema.safeParse({ value: 6, unit: 'months' }).success).toBe(false);
  });
});

describe('sendMessageSchema.clientMsgId', () => {
  it('requires a 26-character ULID', () => {
    // The recorded Phase-4b bug: Messages.tsx minted a 16-character id and every
    // message send was a 422. The id is the idempotency key for a retry after a
    // timeout, so it is required rather than optional and its shape is not negotiable.
    expect(sendMessageSchema.safeParse({ content: 'hi', clientMsgId: ULID }).success).toBe(true);
    expect(
      sendMessageSchema.safeParse({ content: 'hi', clientMsgId: '01JGXDFAM0K2Z1G' }).success,
    ).toBe(false);
  });

  it('is case-sensitive, unlike idSchema', () => {
    // `idSchema` accepts either case because it also has to admit cuids; this one does
    // not, so a client generating a lowercased ULID 422s on every send. Pinned because
    // the asymmetry is the kind of thing a refactor would "fix" in the wrong direction.
    expect(
      sendMessageSchema.safeParse({ content: 'hi', clientMsgId: ULID.toLowerCase() }).success,
    ).toBe(false);
  });

  it('refuses an empty message and caps the length', () => {
    expect(sendMessageSchema.safeParse({ content: '   ', clientMsgId: ULID }).success).toBe(false);
    expect(
      sendMessageSchema.safeParse({ content: 'a'.repeat(4001), clientMsgId: ULID }).success,
    ).toBe(false);
  });
});

describe('the attendance register body', () => {
  it('takes a bare calendar date and refuses an instant', () => {
    // "A session date is a DAY, not an instant — no timezone arithmetic belongs
    // anywhere near it." Accepting a timestamp is how a register marked at 01:00
    // Karachi lands on the previous day's `@@unique([enrollmentId, sessionDate])`.
    expect(sessionDateSchema.parse('2026-08-30')).toBe('2026-08-30');
    for (const bad of ['2026-08-30T00:00:00Z', '2026-8-30', '30-08-2026', '2026-02-30', '']) {
      expect(sessionDateSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('refuses an empty register and caps a class size', () => {
    // An empty `marks` array is an upsert transaction that writes nothing and reports
    // success; the ceiling keeps one request from being an unbounded transaction.
    const base = { offeringId: ULID, date: '2026-08-30' };
    expect(markRegisterBodySchema.safeParse({ ...base, marks: [] }).success).toBe(false);
    const mark = { enrollmentId: CUID, status: 'PRESENT' as const };
    expect(
      markRegisterBodySchema.safeParse({ ...base, marks: Array.from({ length: 501 }, () => mark) })
        .success,
    ).toBe(false);
    expect(markRegisterBodySchema.safeParse({ ...base, marks: [mark] }).success).toBe(true);
  });

  it('requires the offering, because a register belongs to one intake', () => {
    // Two intakes of the same course never share a teaching day; a register scoped to
    // the course would mark both cohorts at once.
    expect(
      markRegisterBodySchema.safeParse({
        date: '2026-08-30',
        marks: [{ enrollmentId: CUID, status: 'PRESENT' }],
      }).success,
    ).toBe(false);
  });
});
