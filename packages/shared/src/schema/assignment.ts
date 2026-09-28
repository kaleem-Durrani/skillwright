import { z } from 'zod';
import { idSchema, isoDateTimeSchema, nullableIsoDateTimeSchema } from './common.js';
import { userSummarySchema } from './user.js';

/**
 * Where a hand-in is in the grader's hands. Mirrors `SubmissionStatus` in
 * schema.prisma.
 *
 * Three values rather than a nullable score, because "returned with a zero" and
 * "returned for another go" are different sentences to say to a student. A score that
 * is present on a RETURNED row would also have to answer "out of what", and the
 * schema below refuses that combination rather than leaving it to a service.
 */
export const submissionStatusSchema = z.enum(['SUBMITTED', 'GRADED', 'RETURNED']);
export type SubmissionStatusValue = z.infer<typeof submissionStatusSchema>;

/**
 * A mark out of a task's `maxScore`. Bounded above by 10000 rather than by the
 * assignment's own maximum, because the maximum is per-ROW data the body does not
 * carry; `assignments.service.ts` refuses a mark above the real ceiling with a 422
 * on the `score` path rather than letting the database discover it later.
 */
const scoreSchema = z.number().min(0).max(10_000);

/** `YYYY-MM-DDTHH:mm(:ss.sssZ)` — what `z.coerce.date()` accepts on the way in. */
const dueAtInputSchema = z.coerce.date();

export const createAssignmentSchema = z.object({
  offeringId: idSchema,
  title: z.string().trim().min(2, 'Give the task a title of at least 2 characters').max(200),
  brief: z.string().trim().min(1, 'Say what the task is.').max(10_000),
  dueAt: dueAtInputSchema,
  maxScore: z.number().positive('A task must be worth something.').max(10_000),
  /**
   * The brief as an uploaded artefact. A real `Resource` id, not an Upload: a brief
   * is course material, and `ResourceType` gained `ASSIGNMENT` in migration 0010 so
   * this module does not have to invent a second attachment with its own visibility
   * answer. The service runs the same `assertUploadClaimable`-shaped ownership check
   * `resources.service.ts` runs for `uploadId`, so a teacher cannot attach a
   * colleague's private file to a task on their own intake.
   */
  resourceId: idSchema.nullish(),
});
export type CreateAssignmentInput = z.input<typeof createAssignmentSchema>;

export const updateAssignmentSchema = z
  .object({
    title: z.string().trim().min(2).max(200).optional(),
    brief: z.string().trim().min(1).max(10_000).optional(),
    dueAt: dueAtInputSchema.optional(),
    maxScore: z.number().positive().max(10_000).optional(),
    /** Explicit null DETACHES the brief. Absent leaves it alone. */
    resourceId: idSchema.nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Send at least one field to change.',
  });
export type UpdateAssignmentInput = z.input<typeof updateAssignmentSchema>;

/**
 * A hand-in. `uploadId` is REQUIRED: the bytes ARE the submission, which is why
 * `Submission.uploadId` is a non-nullable 1:1 relation in schema.prisma rather than
 * a nullable pointer the way a brief is.
 *
 * The file arrives through the existing presign → PUT → commit path
 * (`apps/web/src/lib/uploads.ts`), so by the time this body is sent the upload is
 * COMMITTED and the service can check it is this student's and not already backing
 * something else.
 */
export const createSubmissionSchema = z.object({
  assignmentId: idSchema,
  uploadId: idSchema,
});
export type CreateSubmissionInput = z.infer<typeof createSubmissionSchema>;

/**
 * Grading. A score and a verdict, and the two are not independent: a RETURNED task
 * has no mark (it is the "do it again" outcome), so `score` is `.nullish()` rather
 * than merely optional and the refinement refuses a mark on one.
 *
 * The feedback is `.nullish()` on GRADED because a numeric mark alone is a legitimate
 * outcome, and REQUIRED on RETURNED because "I am sending this back" with no
 * explanation is the one thing a teacher must never do to a student.
 */
export const gradeSubmissionSchema = z
  .object({
    score: scoreSchema.nullish(),
    feedback: z.string().trim().max(5_000).nullish(),
  })
  .superRefine((body, ctx) => {
    if (body.score === null) {
      if (body.feedback === null || body.feedback === undefined || body.feedback.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['feedback'],
          message:
            'Say what the student should do differently. A mark with no comment is not a return.',
        });
      }
      return;
    }
    if (body.feedback === undefined && body.score === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['score'],
        message: 'Send a mark, a comment, or both.',
      });
    }
  });
export type GradeSubmissionInput = z.infer<typeof gradeSubmissionSchema>;

/** Returning asks for another attempt. No mark, and a reason is compulsory. */
export const returnSubmissionSchema = z.object({
  feedback: z.string().trim().min(1, 'Say what the student should do differently.').max(5_000),
});
export type ReturnSubmissionInput = z.infer<typeof returnSubmissionSchema>;

export const listAssignmentsQuerySchema = z.object({
  courseId: idSchema.optional(),
  offeringId: idSchema.optional(),
});
export type ListAssignmentsQuery = z.infer<typeof listAssignmentsQuerySchema>;

/** A stored assignment, as the teacher's list and the student's list both read it. */
export const assignmentSchema = z.object({
  id: idSchema,
  offeringId: idSchema,
  title: z.string(),
  brief: z.string(),
  dueAt: isoDateTimeSchema,
  /** Sent as a number, never as Prisma's Decimal JSON (a string) — see the service. */
  maxScore: z.number(),
  resourceId: idSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type AssignmentDto = z.infer<typeof assignmentSchema>;

/** A stored hand-in, as its own student and as a teacher grading it. */
export const submissionSchema = z.object({
  id: idSchema,
  assignmentId: idSchema,
  enrollmentId: idSchema,
  status: submissionStatusSchema,
  attempt: z.number().int().positive(),
  score: z.number().nullable(),
  feedback: z.string().nullable(),
  submittedAt: isoDateTimeSchema,
  gradedAt: nullableIsoDateTimeSchema,
  gradedBy: userSummarySchema.nullable(),
  upload: z.object({
    id: idSchema,
    originalName: z.string(),
    contentType: z.string(),
    sizeBytes: z.number().int(),
  }),
  createdAt: isoDateTimeSchema,
});
export type SubmissionDto = z.infer<typeof submissionSchema>;

/**
 * The student's own view of one task: the assignment, and whether they have handed
 * anything in for it.
 *
 * `submission` is the LATEST attempt (the service orders by `attempt` descending and
 * takes the first), because a student asking "did I do this?" wants the answer they
 * gave last, not the history of every attempt. `submissionCount` rides beside it
 * because "attempt 2 of 2" is what tells them resubmission is a normal thing to do
 * rather than a mistake.
 *
 * `scorePercent` is computed SERVER-SIDE from the assignment's own `maxScore`, so the
 * division that decides a certificate in Phase 3 exists in exactly one place and the
 * client cannot disagree with it. Null while the work is ungraded — never 0, which
 * would be a mark nobody gave.
 */
export const myAssignmentSchema = assignmentSchema.extend({
  course: z.object({ id: idSchema, name: z.string(), code: z.string() }),
  submission: submissionSchema.nullable(),
  submissionCount: z.number().int().nonnegative(),
  scorePercent: z.number().nullable(),
  /** True once the deadline has passed — a fact, not a permission. */
  overdue: z.boolean(),
});
export type MyAssignmentDto = z.infer<typeof myAssignmentSchema>;

/** What `GET /assignments/mine` answers: a list, unpaginated and capped server-side. */
export const myAssignmentListSchema = z.object({ data: z.array(myAssignmentSchema) });
export type MyAssignmentList = z.infer<typeof myAssignmentListSchema>;

/** The teacher/admin read of one assignment's class. */
export const assignmentSubmissionRowSchema = submissionSchema.extend({
  student: userSummarySchema,
  /** The seat it was made on, so a roster of two intakes stays legible. */
  offeringId: idSchema,
});
export type AssignmentSubmissionRow = z.infer<typeof assignmentSubmissionRowSchema>;

export const assignmentSubmissionListSchema = z.object({
  data: z.array(assignmentSubmissionRowSchema),
});
export type AssignmentSubmissionList = z.infer<typeof assignmentSubmissionListSchema>;
