/**
 * The assignments module binds request and response shapes from
 * @skillwright/shared rather than declaring its own — the same rule
 * attendance.schema.ts states, and for the same reason: a second definition of a wire
 * shape drifts from the SPA's within a sprint.
 *
 * The two LOCAL declarations are both nested path segments, because `@skillwright/shared`
 * exports `{ id }` and `{ slug }` param shapes and nothing for
 * `/offerings/:offeringId/assignments`. The leaf rule (`idSchema`) is imported, so no
 * definition is restated.
 */
import { z } from 'zod';
import { idSchema } from '@skillwright/shared';

export const offeringIdParamSchema = z.object({ offeringId: idSchema });
export type OfferingIdParam = z.infer<typeof offeringIdParamSchema>;

/**
 * The hand-in body, and deliberately NOT `createSubmissionSchema`.
 *
 * The shared schema carries `assignmentId` because it is the wire shape of the whole
 * operation, but on this route the assignment is in the PATH — so a body that also
 * names it would be a second source for one id, and the one the policy has just
 * decided on is the one the row must carry. The two disagreeing is the failure this
 * strip exists to remove.
 *
 * It is REQUIRED rather than `.nullish()`: a hand-in with no file is not a hand-in, and
 * `Submission.uploadId` is a non-nullable relation in schema.prisma for that reason.
 * The bodyless-POST trap (LESSONS-LEARNED #12) applies to schemas that are ALL-optional;
 * this one has a required field, so `null` is a 422 whoever sends it.
 */
export const handInBodySchema = z.object({ uploadId: idSchema });
export type HandInBody = z.infer<typeof handInBodySchema>;

export {
  assignmentSchema,
  assignmentSubmissionListSchema,
  createAssignmentSchema,
  gradeSubmissionSchema,
  idParamSchema,
  listAssignmentsQuerySchema,
  myAssignmentListSchema,
  returnSubmissionSchema,
  submissionSchema,
  updateAssignmentSchema,
} from '@skillwright/shared';

export type {
  AssignmentDto,
  AssignmentSubmissionList,
  AssignmentSubmissionRow,
  CreateAssignmentInput,
  GradeSubmissionInput,
  IdParam,
  ListAssignmentsQuery,
  MyAssignmentList,
  ReturnSubmissionInput,
  SubmissionDto,
  UpdateAssignmentInput,
} from '@skillwright/shared';
