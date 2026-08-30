import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  attendanceRecordSchema,
  commentSchema,
  conversationSchema,
  courseOfferingSchema,
  createCommentSchema,
  createResourceSchema,
  createUserSchema,
  departmentDetailSchema,
  enrollmentSchema,
  loginResponseSchema,
  markRegisterBodySchema,
  messageSchema,
  notificationPayloadSchema,
  notificationSchema,
  problemSchema,
  registerSchema,
  requestEnrollmentSchema,
  resourceSchema,
  sessionActorSchema,
  updateUserSchema,
  uploadSchema,
  userDetailSchema,
  userSummarySchema,
} from '../src/schema/index.js';

/**
 * Unknown-key stripping, in both directions across the wire.
 *
 * This is the behaviour with an incident behind it. PROGRESS records that
 * `notificationPayloadSchema` was "the one response in the system that did not strip
 * extras" — a `.catchall(z.unknown())` sitting over `Notification.payload`, an
 * unconstrained `Json` column written by other modules' side effects, so any future
 * producer denormalising a target's email address or a verification link into it would
 * have had that served straight to the client. The same page had already been caught
 * loading Argon2id hashes and TOTP ciphertext through `include: { user: true }`.
 *
 * Stripping is the default in Zod, which is exactly why it needs a test: nothing about
 * `.passthrough()`, `.catchall()` or a hand-rolled `z.record` on a response shape looks
 * wrong in review, none of them fails a typecheck, and the leak they cause is silent.
 * Requests matter as much — a request schema that stopped stripping turns a `PATCH`
 * body spread into Prisma into privilege escalation.
 */

const ULID = '01JGXDFAM0K2Z1GYCSNM5F5RCX';
const CUID = 'cmsvme3r703ucw4g0i6oyh6fh';
const NOW = '2026-08-30T10:00:00.000Z';

const userSummary = { id: ULID, name: 'Ann Rafiq', role: 'TEACHER', avatarUrl: null };
const departmentSummary = { id: CUID, name: 'Welding', slug: 'welding' };
const courseSummary = {
  id: ULID,
  code: 'WELD-101',
  slug: 'weld-101',
  name: 'Shielded Metal Arc Welding',
  department: departmentSummary,
  teacher: userSummary,
  duration: { value: 6, unit: 'MONTH' },
  publishedAt: NOW,
};
const offering = {
  id: CUID,
  startDate: NOW,
  endDate: null,
  capacity: 24,
  workshopCapacity: 12,
  approvedCount: 9,
  seatsRemaining: 15,
  isFull: false,
  workshopSeatsRemaining: 3,
};
const userDetail = {
  id: ULID,
  email: 'ann@example.com',
  name: 'Ann Rafiq',
  role: 'TEACHER',
  status: 'ACTIVE',
  phoneNumber: null,
  bio: null,
  avatarUrl: null,
  mfaEnabled: true,
  lastLoginAt: NOW,
  createdAt: NOW,
  teacherProfile: null,
  studentProfile: null,
};
const sessionActor = { id: ULID, role: 'TEACHER', status: 'ACTIVE', provenance: 'PASSWORD' };

/**
 * The columns that live one join away from a DTO and must never reach a client.
 * `passwordHash` and `totpSecret` are the two the notifications page actually loaded.
 */
const CREDENTIAL_COLUMNS = {
  passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$hash',
  totpSecret: 'AA==:BB==:CC==',
  recoveryCodeHashes: ['$argon2id$...'],
};

interface StripCase {
  readonly name: string;
  readonly schema: z.ZodTypeAny;
  /** Exactly the keys the shape declares, with the values a real row would carry. */
  readonly row: Record<string, unknown>;
  /** Neighbouring columns a careless `include` or a future `Json` writer would add. */
  readonly leaks: Record<string, unknown>;
}

const RESPONSE_CASES: readonly StripCase[] = [
  {
    name: 'userSummarySchema',
    schema: userSummarySchema,
    row: userSummary,
    // The exact shape of the recorded leak: `include: { user: true }` on every
    // participant of every conversation page, to render three fields.
    leaks: { ...CREDENTIAL_COLUMNS, email: 'ann@example.com', phoneNumber: '+92 300 1234567' },
  },
  {
    name: 'userDetailSchema',
    schema: userDetailSchema,
    row: userDetail,
    leaks: { ...CREDENTIAL_COLUMNS, deletedAt: null, mfaEnrolledAt: NOW },
  },
  {
    name: 'sessionActorSchema',
    schema: sessionActorSchema,
    row: sessionActor,
    // The actor is embedded in every session response and is the object the SPA's
    // own `can()` reads; anything extra here is shipped on literally every page load.
    leaks: { ...CREDENTIAL_COLUMNS, sessionToken: 'st_secret' },
  },
  {
    name: 'notificationPayloadSchema',
    schema: notificationPayloadSchema,
    row: { title: 'Enrollment approved', body: 'You have a seat on WELD-101.' },
    // Verbatim from the incident note: an unconstrained Json column, and the two
    // things a side effect would plausibly denormalise into it.
    leaks: {
      targetEmail: 'ann@example.com',
      verificationLink: 'https://skillwright.dev/verify-email?code=418302',
      actorId: CUID,
    },
  },
  {
    name: 'notificationSchema',
    schema: notificationSchema,
    row: {
      id: ULID,
      type: 'ENROLLMENT_APPROVED',
      payload: { title: 'Enrollment approved', body: 'You have a seat.' },
      linkPath: '/enrollments',
      readAt: null,
      createdAt: NOW,
    },
    leaks: { userId: CUID, channel: 'EMAIL' },
  },
  {
    name: 'messageSchema',
    schema: messageSchema,
    row: {
      id: ULID,
      conversationId: CUID,
      sender: userSummary,
      seq: '17',
      content: 'The workshop moves to Thursday.',
      clientMsgId: '01JGXDFAM0K2Z1GYCSNM5F5RCX',
      createdAt: NOW,
      editedAt: null,
      deletedAt: null,
    },
    leaks: { senderIp: '203.0.113.9', moderationScore: 0.02 },
  },
  {
    name: 'conversationSchema',
    schema: conversationSchema,
    row: {
      id: ULID,
      title: null,
      participants: [
        { user: userSummary, lastReadSeq: '17', lastReadAt: NOW, joinedAt: NOW, leftAt: null },
      ],
      lastMessage: null,
      unreadCount: 0,
      lastMessageAt: NOW,
      createdAt: NOW,
    },
    leaks: { participantUserIds: [CUID] },
  },
  {
    name: 'uploadSchema',
    schema: uploadSchema,
    row: {
      id: ULID,
      key: 'skillwright/resource/01JGXDFAM0K2Z1GYCSNM5F5RCX.pdf',
      bucket: 'skillwright',
      contentType: 'application/pdf',
      sizeBytes: 69,
      originalName: 'syllabus.pdf',
      status: 'COMMITTED',
      ownerId: CUID,
      createdAt: NOW,
      committedAt: NOW,
    },
    leaks: { presignedUrl: 'https://minio.local/skillwright/x?X-Amz-Signature=deadbeef' },
  },
  {
    name: 'resourceSchema',
    schema: resourceSchema,
    row: {
      id: ULID,
      title: 'Arc length and travel speed',
      description: null,
      type: 'DOCUMENT',
      courseId: CUID,
      courseName: 'Shielded Metal Arc Welding',
      author: userSummary,
      isPublic: false,
      uploadId: CUID,
      externalUrl: null,
      sizeBytes: 12345,
      contentType: 'application/pdf',
      commentCount: 2,
      createdAt: NOW,
      updatedAt: NOW,
    },
    // Downloads are short-lived signed URLs, never a path — so the object key must
    // not ride along on the resource itself.
    leaks: { storageKey: 'skillwright/resource/01JGXDFAM0K2Z1GYCSNM5F5RCX.pdf' },
  },
  {
    name: 'commentSchema',
    schema: commentSchema,
    row: {
      id: ULID,
      content: 'Which electrode?',
      author: userSummary,
      resourceId: CUID,
      announcementId: null,
      parentId: null,
      replyCount: 0,
      canEdit: true,
      canDelete: true,
      createdAt: NOW,
      updatedAt: NOW,
      editedAt: null,
    },
    leaks: { authorEmail: 'ann@example.com', deletedAt: null },
  },
  {
    name: 'enrollmentSchema',
    schema: enrollmentSchema,
    row: {
      id: ULID,
      status: 'APPROVED',
      student: userSummary,
      course: courseSummary,
      offering,
      requestedAt: NOW,
      decidedAt: NOW,
      decidedBy: userSummary,
      decisionNote: null,
    },
    leaks: { studentEmail: 'ann@example.com' },
  },
  {
    name: 'courseOfferingSchema',
    schema: courseOfferingSchema,
    row: offering,
    // The viewer-relative field belongs only to the top-level shapes a viewer asked
    // for; course.ts is explicit that embedding it here would be a contradiction.
    leaks: { viewerEnrollmentStatus: 'APPROVED' },
  },
  {
    name: 'attendanceRecordSchema',
    schema: attendanceRecordSchema,
    row: {
      id: ULID,
      enrollmentId: CUID,
      sessionDate: NOW,
      status: 'PRESENT',
      note: null,
      markedBy: userSummary,
    },
    leaks: { studentId: CUID },
  },
  {
    name: 'departmentDetailSchema',
    schema: departmentDetailSchema,
    row: {
      id: ULID,
      name: 'Welding',
      slug: 'welding',
      description: null,
      courseCount: 4,
      teacherCount: 3,
      studentCount: 41,
      createdAt: NOW,
      updatedAt: NOW,
    },
    leaks: { headOfDepartmentEmail: 'head@example.com' },
  },
  {
    name: 'problemSchema',
    schema: problemSchema,
    row: {
      type: 'https://skillwright.dev/problems/internal',
      title: 'Something went wrong',
      status: 500,
      code: 'INTERNAL',
      requestId: 'req_01JGX',
    },
    // An error mapper that let extras through would publish stack traces and raw
    // driver messages to whoever triggered the 500.
    leaks: { stack: 'Error: connect ECONNREFUSED 127.0.0.1:5433\n    at ...', query: 'SELECT 1' },
  },
];

const REQUEST_CASES: readonly StripCase[] = [
  {
    name: 'registerSchema',
    schema: registerSchema,
    row: {
      email: 'ann@example.com',
      password: 'correct horse battery staple',
      name: 'Ann Rafiq',
      departmentId: CUID,
    },
    // "Self-registration only ever creates a student; teachers are provisioned by an
    // admin." A body key that survived stripping and reached a Prisma `create` spread
    // would make that comment untrue for anyone who could read this file.
    leaks: { role: 'ADMIN', status: 'ACTIVE', mfaEnabled: false },
  },
  {
    name: 'updateUserSchema',
    schema: updateUserSchema,
    row: { name: 'Ann Rafiq' },
    // "Role and status are absent by design — those are admin verbs." This is the
    // self-service body, so a passthrough here is a student promoting themself.
    leaks: { role: 'ADMIN', status: 'ACTIVE', email: 'attacker@example.com', id: CUID },
  },
  {
    name: 'createUserSchema',
    schema: createUserSchema,
    row: { email: 'ann@example.com', name: 'Ann Rafiq', role: 'ADMIN' },
    // "No password: the invite email carries a set-password token." Accepting one
    // would let an admin set a password nobody consented to and skip the token.
    leaks: { password: 'set-by-someone-else', passwordHash: 'x', status: 'ACTIVE' },
  },
  {
    name: 'requestEnrollmentSchema',
    schema: requestEnrollmentSchema,
    row: { courseId: CUID, offeringId: ULID },
    // A student asking for a seat must not be able to name the answer.
    leaks: { status: 'APPROVED', decidedAt: NOW, decidedBy: CUID },
  },
  {
    name: 'createResourceSchema',
    schema: createResourceSchema,
    row: {
      courseId: CUID,
      title: 'Arc length and travel speed',
      type: 'DOCUMENT',
      uploadId: ULID,
      isPublic: false,
    },
    // The author is the session's user, never the body's.
    leaks: { authorId: CUID, commentCount: 99 },
  },
  {
    name: 'createCommentSchema',
    schema: createCommentSchema,
    row: { content: 'Which electrode?', resourceId: CUID },
    // `canEdit`/`canDelete` are derived from policy on the way out; taking them on
    // the way in would let the client assert its own permissions.
    leaks: { authorId: CUID, canEdit: true, canDelete: true },
  },
];

describe('response shapes strip unknown keys', () => {
  it.each(RESPONSE_CASES.map((c) => [c.name, c] as const))('%s', (_name, testCase) => {
    const parsed = testCase.schema.parse({ ...testCase.row, ...testCase.leaks }) as Record<
      string,
      unknown
    >;
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(testCase.row).sort());
    for (const key of Object.keys(testCase.leaks)) {
      expect(key in parsed, `${testCase.name} leaked ${key}`).toBe(false);
    }
  });
});

describe('request shapes strip unknown keys', () => {
  it.each(REQUEST_CASES.map((c) => [c.name, c] as const))('%s', (_name, testCase) => {
    const parsed = testCase.schema.parse({ ...testCase.row, ...testCase.leaks }) as Record<
      string,
      unknown
    >;
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(testCase.row).sort());
    for (const key of Object.keys(testCase.leaks)) {
      expect(key in parsed, `${testCase.name} accepted ${key}`).toBe(false);
    }
  });
});

describe('stripping reaches nested shapes, not just the top level', () => {
  /*
   * The leak that actually happened was nested — a `user` relation inside a
   * participant inside a conversation page. A top-level-only check would have passed
   * while the hashes shipped one level down.
   */
  it('strips credential columns out of an embedded userSummary', () => {
    const parsed = commentSchema.parse({
      id: ULID,
      content: 'Which electrode?',
      author: { ...userSummary, ...CREDENTIAL_COLUMNS },
      resourceId: CUID,
      announcementId: null,
      parentId: null,
      replyCount: 0,
      canEdit: true,
      canDelete: true,
      createdAt: NOW,
      updatedAt: NOW,
      editedAt: null,
    });
    expect(parsed.author).toEqual(userSummary);
  });

  it('strips extras out of every element of an array, not only the first', () => {
    const parsed = markRegisterBodySchema.parse({
      offeringId: ULID,
      date: '2026-08-30',
      marks: [
        { enrollmentId: CUID, status: 'PRESENT' },
        { enrollmentId: ULID, status: 'ABSENT', studentId: CUID, gradedBy: 'nobody' },
      ],
    });
    expect(parsed.marks[1]).toEqual({ enrollmentId: ULID, status: 'ABSENT' });
  });

  it('strips the Json payload nested inside a notification', () => {
    // The catchall was on the payload, not the envelope, so this is the assertion
    // that would have failed before it was removed.
    const parsed = notificationSchema.parse({
      id: ULID,
      type: 'ENROLLMENT_APPROVED',
      payload: {
        title: 'Enrollment approved',
        body: 'You have a seat.',
        targetEmail: 'ann@example.com',
      },
      linkPath: null,
      readAt: null,
      createdAt: NOW,
    });
    expect(parsed.payload).toEqual({ title: 'Enrollment approved', body: 'You have a seat.' });
  });
});

describe('the MFA_REQUIRED login branch', () => {
  /*
   * A discriminated union is what stops a half-authenticated response from carrying a
   * user record: the MFA_REQUIRED member declares only `status` and `actor`, so the
   * strip is the enforcement. Replacing the union with one object and an optional
   * `mfaRequired` flag — the shape auth.ts explicitly rejects — would hand the full
   * `userDetail` to a session that has not passed its second factor.
   */
  it('carries no user record, even when the server hands it one', () => {
    const parsed = loginResponseSchema.parse({
      status: 'MFA_REQUIRED',
      actor: { ...sessionActor, provenance: 'MFA_PENDING' },
      user: userDetail,
      expiresAt: NOW,
    });
    expect(parsed).toEqual({
      status: 'MFA_REQUIRED',
      actor: { ...sessionActor, provenance: 'MFA_PENDING' },
    });
  });

  it('still requires the user record on the AUTHENTICATED branch', () => {
    // The other half of the union: forgetting `user` there is a blank shell for the
    // SPA, so the two branches have to differ in both directions.
    const authenticated = { status: 'AUTHENTICATED', actor: sessionActor, expiresAt: NOW };
    expect(loginResponseSchema.safeParse(authenticated).success).toBe(false);
    expect(loginResponseSchema.safeParse({ ...authenticated, user: userDetail }).success).toBe(
      true,
    );
  });
});
