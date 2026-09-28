import { z } from 'zod';
import {
  emailSchema,
  idSchema,
  isoDateTimeSchema,
  nameSchema,
  nullableIsoDateTimeSchema,
  phoneSchema,
} from './common.js';
import { errorCodeSchema } from './errors.js';
import { notificationPayloadSchema, notificationTypeSchema } from './notification.js';
import { paginationQuerySchema } from './pagination.js';

export const roleSchema = z.enum(['STUDENT', 'TEACHER', 'ADMIN']);
export type RoleValue = z.infer<typeof roleSchema>;

export const userStatusSchema = z.enum(['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED']);
export type UserStatusValue = z.infer<typeof userStatusSchema>;

/**
 * The smallest safe rendering of a person: enough to draw an avatar and a name in
 * a comment thread, and nothing that leaks contact details to other students.
 */
export const userSummarySchema = z.object({
  id: idSchema,
  name: z.string(),
  role: roleSchema,
  avatarUrl: z.string().url().nullable(),
});
export type UserSummary = z.infer<typeof userSummarySchema>;

export const teacherProfileSchema = z.object({
  departmentId: idSchema,
  departmentName: z.string(),
  qualification: z.string(),
  specialization: z.string().nullable(),
  staffNo: z.string().nullable(),
});
export type TeacherProfileDto = z.infer<typeof teacherProfileSchema>;

export const studentProfileSchema = z.object({
  departmentId: idSchema,
  departmentName: z.string(),
  enrollmentNo: z.string(),
  enrolledOn: isoDateTimeSchema,
});
export type StudentProfileDto = z.infer<typeof studentProfileSchema>;

/**
 * The full record. `email`, `phoneNumber` and the MFA flag are here and not in the
 * summary because this DTO is only ever served for `user:read`, which is self-only
 * for non-admins.
 */
export const userDetailSchema = z.object({
  id: idSchema,
  email: z.string(),
  name: z.string(),
  role: roleSchema,
  status: userStatusSchema,
  phoneNumber: z.string().nullable(),
  bio: z.string().nullable(),
  avatarUrl: z.string().url().nullable(),
  mfaEnabled: z.boolean(),
  lastLoginAt: nullableIsoDateTimeSchema,
  createdAt: isoDateTimeSchema,
  teacherProfile: teacherProfileSchema.nullable(),
  studentProfile: studentProfileSchema.nullable(),
});
export type UserDetail = z.infer<typeof userDetailSchema>;

/**
 * Self-service edits. Role and status are absent by design — those are admin verbs.
 *
 * The four profile fields are additive (Phase 4b): `qualification`,
 * `specialization` and `staffNo` shape a TeacherProfile, `enrollmentNo` a
 * StudentProfile. Which of them a caller may send is decided by the ACTOR's role,
 * which the body does not carry — the users service refuses role-inappropriate
 * fields with a field-level 422 rather than silently ignoring them. Department
 * membership is deliberately absent: there is no `User.departmentId` column, and
 * placement is an admin concern, not a self-service one.
 */
export const updateUserSchema = z
  .object({
    name: nameSchema,
    phoneNumber: phoneSchema.nullable(),
    bio: z.string().trim().max(2000).nullable(),
    avatarUploadId: idSchema.nullable(),
    // TeacherProfile columns. qualification is NOT NULL, so it can be changed but
    // never cleared; the two nullable columns accept null to clear.
    qualification: z.string().trim().min(2).max(200),
    specialization: z.string().trim().max(200).nullable(),
    staffNo: z.string().trim().max(40).nullable(),
    // StudentProfile.enrollmentNo is NOT NULL and @unique — claiming someone
    // else's number is a P2002 turned 409, exactly as at registration.
    enrollmentNo: z.string().trim().max(40),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Provide at least one field to update.',
  });
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

/** Admin provisioning. No password: the invite email carries a set-password token. */
export const createUserSchema = z
  .object({
    email: emailSchema,
    name: nameSchema,
    role: roleSchema,
    departmentId: idSchema.optional(),
    qualification: z.string().trim().min(2).max(200).optional(),
    specialization: z.string().trim().max(200).optional(),
    staffNo: z.string().trim().max(40).optional(),
    enrollmentNo: z.string().trim().max(40).optional(),
  })
  .superRefine((body, ctx) => {
    // A teacher or student with no department would violate the Restrict FK at
    // insert time; failing here turns a 500 into a field-level 422.
    if (body.role !== 'ADMIN' && body.departmentId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['departmentId'],
        message: 'Teachers and students must belong to a department.',
      });
    }
    if (body.role === 'TEACHER' && body.qualification === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['qualification'],
        message: 'A teacher requires a qualification.',
      });
    }
  });
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const listUsersQuerySchema = paginationQuerySchema.extend({
  role: roleSchema.optional(),
  status: userStatusSchema.optional(),
  departmentId: idSchema.optional(),
  q: z.string().trim().min(1).max(120).optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

/** Suspension always carries a reason; it lands in the audit row and the email. */
export const suspendUserSchema = z.object({
  reason: z.string().trim().min(4).max(500),
});
export type SuspendUserInput = z.infer<typeof suspendUserSchema>;

export const reinstateUserSchema = z.object({
  note: z.string().trim().max(500).optional(),
});
export type ReinstateUserInput = z.infer<typeof reinstateUserSchema>;

/**
 * The hard ceiling on one `POST /users/bulk`.
 *
 * A school's largest realistic intake is tens of people; a hundred is comfortably
 * past that and is where a single request stops being a request and starts being a
 * denial-of-service. The route is ALSO on its own rate-limit bucket and behind its
 * own action, so the cap is the third of three independent brakes rather than the
 * only one. Shared rather than declared in the API because the SPA needs the same
 * number to refuse a file before uploading it — a limit the client cannot see is a
 * limit the client discovers by getting a 422.
 */
export const BULK_IMPORT_MAX_ROWS = 100;

/**
 * One row of a cohort import. `createUserSchema` verbatim, not a near-copy.
 *
 * This is the whole reuse argument for Phase 4's backend, and it is worth stating
 * plainly: a bulk import that declared its own row shape would be a SECOND set of
 * provisioning rules, and the drift between them would be invisible until somebody
 * imported a teacher with no qualification and the import said yes where the single
 * create said no. Binding the same schema means the dry run and the real run
 * validate the same thing, and so does the single-create form in the SPA.
 */
export const bulkImportRowSchema = createUserSchema;

/**
 * The request body for `POST /users/bulk`.
 *
 * `rows` IS `z.array(z.unknown())` AND NOT `z.array(bulkImportRowSchema)`, and that
 * is the single most load-bearing decision in this schema. A typed array would
 * validate every row at the wire, so ONE teacher missing a qualification would 422
 * the whole request — and the school with that row in a sixty-person file learns
 * "your file is invalid" with no way to find out WHICH line. That is the failure the
 * feature exists to remove: "A school importing 60 people will hit 4
 * already-existing addresses and needs the other 56 to land."
 *
 * So each row is validated PER ROW, by the same `createUserSchema`, inside the
 * service, and a bad row becomes one entry in `failed` with its row number. The
 * reuse the brief asks for is intact — it is the SAME schema object, run by the
 * SAME code path as the single-create endpoint; only the timing of its failure
 * differs.
 *
 * What `z.array(z.unknown())` still enforces at the wire is the things that are
 * about the REQUEST rather than about a row: `.min(1)` (an empty import is a
 * mistake, not a no-op) and `.max(BULK_IMPORT_MAX_ROWS)` (the size cap). Byte
 * size is capped separately by the route's `bodyLimit`.
 *
 * `dryRun` defaults to FALSE, which is the safe default for a destructive
 * operation and the wrong one for a lazy caller: a body that omits it imports
 * sixty people. It is defaulted rather than required because the honest fix is the
 * SPA's "Check this file" button being the obvious first thing an admin reaches
 * for, and a required field would only train people to tick it without reading it.
 */
export const bulkImportSchema = z.object({
  rows: z.array(z.unknown()).min(1).max(BULK_IMPORT_MAX_ROWS),
  dryRun: z.boolean().default(false),
});
export type BulkImportInput = z.infer<typeof bulkImportSchema>;

/**
 * The per-row outcome code, which is a real `ErrorCode` and not a string invented
 * here. A failure on row 14 of an import is reported in the same vocabulary as a
 * failure anywhere else in the API, so the SPA's existing problem→copy mapping
 * covers it and a reader of the response does not have to learn a second taxonomy.
 *
 * `NOT_FOUND` is here for the FK Restrict that a department id can trigger, and
 * `INTERNAL` for the unforeseen — the one value a client should never be asked to
 * render, which is why it is the last member rather than the first.
 */
export const bulkImportFailureCodeSchema = errorCodeSchema;
export type BulkImportFailureCode = z.infer<typeof bulkImportFailureCodeSchema>;

/**
 * `{ created, failed: [{ row, code }] }` — the shape the plan specifies.
 *
 * `row` is ONE-BASED and indexes the submitted `rows` array, because the person
 * fixing the file is looking at a spreadsheet whose first row is row 1, and a
 * zero-based index sends them one line up. The brief asks for `{ row, code }` and
 * this is that plus one field: `detail` carries the server's sentence for THAT
 * row, because "row 14: CONFLICT" does not tell an admin which of the four
 * addresses already in the system is the problem, and the whole feature is unusable
 * without it. It is a per-row field rather than `problem.detail` for the reason
 * LESSONS-LEARNED 25 gives: the code is the contract, the detail is a developer
 * aid, and the SPA renders `code` for its headline and `detail` as the sub-line.
 */
export const bulkImportResultSchema = z.object({
  created: z.array(userDetailSchema),
  failed: z.array(
    z.object({
      row: z.number().int().positive(),
      code: bulkImportFailureCodeSchema,
      detail: z.string().optional(),
    }),
  ),
  /** True when nothing was written; the SPA's "Check this file" path. */
  dryRun: z.boolean(),
});
export type BulkImportResult = z.infer<typeof bulkImportResultSchema>;

// ---------------------------------------------------------------------------
// Account lifecycle
// ---------------------------------------------------------------------------

/**
 * How long a deletion request sits before it takes effect.
 *
 * Thirty days, chosen so that "I deleted my account by accident" is always inside
 * the window — the failure this feature exists to make survivable. Exported rather
 * than left as a constant in a service because the SPA has to render the deadline
 * and the sentence beside it, and a number written twice is a number that drifts.
 */
export const ACCOUNT_DELETION_COOL_OFF_DAYS = 30;

/**
 * `POST /users/me/deletion`. The confirmation is the person's own address, typed
 * back, because that is the one string about this account they cannot read off a
 * screen they did not open deliberately — and a checkbox would be a checkbox.
 *
 * `.nullish()` on the body is NOT what this is: the body is mandatory here, unlike
 * the bodyless suspend/reinstate POSTs. It is bound as a plain object because a
 * delete request that arrives with no body has confirmed nothing.
 */
export const accountDeletionSchema = z.object({
  confirmEmail: emailSchema,
});
export type AccountDeletionInput = z.infer<typeof accountDeletionSchema>;

/** What the caller is told about their own pending deletion. Never anybody else's. */
export const accountDeletionStatusSchema = z.object({
  deletionRequestedAt: nullableIsoDateTimeSchema,
  deletionEffectiveFor: nullableIsoDateTimeSchema,
  /** False once `deletedAt` has landed; the cool-off is over and cannot be reopened. */
  cancellable: z.boolean(),
});
export type AccountDeletionStatus = z.infer<typeof accountDeletionStatusSchema>;

/**
 * `GET /users/me/export` — a data-subject access request, satisfied by the API.
 *
 * The envelope is a CLOSED object on purpose. It is not `z.record(z.unknown())`
 * with whatever the query happened to return: an export whose shape is whatever the
 * database joined today cannot be reviewed for leakage, and the review is the only
 * thing standing between this endpoint and a privacy request that hands out
 * somebody else's name.
 *
 * Every member is the caller's own row or a projection of it. Nothing here reaches
 * across a relation to a second person: `enrollments` carries the COURSE's name and
 * code (shared academic content, not personal data) and never the teacher who
 * approved it, `decidedById`/`markedById`/`completedById` are absent for the same
 * reason, and `conversations` carries only threads the caller participates in with
 * their own messages — never a message somebody else wrote. The service assembles
 * each of those by explicit `select`, and the tests assert the absence rather than
 * trusting the shape.
 *
 * Deliberately NOT exported: `passwordHash`, `totpSecret`, `totpLastUsedCounter`,
 * every `codeHash`, every session `tokenHash`, and the `AuditEvent` rows the caller
 * is the actor on. The last is a real omission and it is the right one: an audit
 * row's before/after snapshot is a full copy of whatever was written, so an
 * admin's export would carry every other user's account they ever edited.
 */
export const userExportSchema = z.object({
  generatedAt: isoDateTimeSchema,
  account: z.object({
    id: idSchema,
    email: z.string(),
    name: z.string(),
    role: roleSchema,
    status: userStatusSchema,
    phoneNumber: z.string().nullable(),
    bio: z.string().nullable(),
    mfaEnabled: z.boolean(),
    lastLoginAt: nullableIsoDateTimeSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    deletedAt: nullableIsoDateTimeSchema,
    deletionRequestedAt: nullableIsoDateTimeSchema,
    deletionEffectiveFor: nullableIsoDateTimeSchema,
  }),
  studentProfile: studentProfileSchema.nullable(),
  teacherProfile: teacherProfileSchema.nullable(),
  sessions: z.array(
    z.object({
      id: idSchema,
      provenance: z.enum(['PASSWORD', 'DEMO', 'MFA_PENDING']),
      ip: z.string().nullable(),
      userAgent: z.string().nullable(),
      createdAt: isoDateTimeSchema,
      lastUsedAt: isoDateTimeSchema,
      expiresAt: isoDateTimeSchema,
      absoluteExpiresAt: isoDateTimeSchema,
    }),
  ),
  enrollments: z.array(
    z.object({
      id: idSchema,
      status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'COMPLETED']),
      requestedAt: isoDateTimeSchema,
      decidedAt: nullableIsoDateTimeSchema,
      decisionNote: z.string().nullable(),
      completedAt: nullableIsoDateTimeSchema,
      courseCode: z.string(),
      courseName: z.string(),
      offeringId: idSchema,
      offeringStartDate: nullableIsoDateTimeSchema,
      offeringEndDate: nullableIsoDateTimeSchema,
    }),
  ),
  notifications: z.array(
    z.object({
      id: idSchema,
      type: notificationTypeSchema,
      // The SAME `notificationPayloadSchema` the notifications list binds, and for
      // its stated reason: `Notification.payload` is an unconstrained `Json`
      // column, and a passthrough here would make every future producer free to
      // denormalise somebody's email address into it and have it served by a
      // privacy endpoint. Two keys, and extra stored context is stripped.
      payload: notificationPayloadSchema,
      linkPath: z.string().nullable(),
      readAt: nullableIsoDateTimeSchema,
      createdAt: isoDateTimeSchema,
    }),
  ),
  uploads: z.array(
    z.object({
      id: idSchema,
      originalName: z.string(),
      contentType: z.string(),
      sizeBytes: z.number().int(),
      status: z.enum(['PENDING', 'COMMITTED']),
      createdAt: isoDateTimeSchema,
    }),
  ),
  comments: z.array(
    z.object({
      id: idSchema,
      content: z.string(),
      resourceId: idSchema.nullable(),
      announcementId: idSchema.nullable(),
      createdAt: isoDateTimeSchema,
    }),
  ),
  conversations: z.array(
    z.object({
      id: idSchema,
      title: z.string().nullable(),
      createdAt: isoDateTimeSchema,
      lastMessageAt: isoDateTimeSchema,
      // ONLY the caller's own messages, projected to three fields. A thread is a
      // two-sided record and the other side is somebody else's data; see the
      // schema comment above. `sender` is absent entirely — on a direct thread
      // every message the caller did not write carries somebody else's name.
      messages: z.array(
        z.object({
          id: idSchema,
          content: z.string(),
          createdAt: isoDateTimeSchema,
        }),
      ),
    }),
  ),
});
export type UserExport = z.infer<typeof userExportSchema>;
