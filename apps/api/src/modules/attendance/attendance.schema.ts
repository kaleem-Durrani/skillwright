/**
 * The attendance module binds request and response shapes from @skillwright/shared
 * rather than declaring its own — the same rule enrollments.schema.ts states: a
 * second definition of a wire shape would drift from the SPA's within a sprint.
 *
 * This file names the exact subset the routes bind. The one local declaration is
 * `courseIdParamSchema`, because `@skillwright/shared` exports `{ id }` and
 * `{ slug }` param shapes and nothing for a nested path segment.
 */
import { z } from 'zod';
import { idSchema, sessionDateSchema } from '@skillwright/shared';

export const courseIdParamSchema = z.object({ courseId: idSchema });
export type CourseIdParam = z.infer<typeof courseIdParamSchema>;

/**
 * The query `GET /courses/:courseId/attendance/export` binds — an offering-scoped
 * date range, both ends optional and inclusive. `offeringId` is required since
 * Phase 9: a register belongs to ONE intake.
 *
 * Declared HERE rather than in @skillwright/shared for the audit.schema.ts:1-18
 * reason: the CSV endpoints are API-local wire surface, so there is nothing upstream
 * to bind. The leaf rules are still imported (`sessionDateSchema`, `idSchema`), so no
 * definition is restated — the same discipline every local declaration in this repo
 * follows.
 */
export const attendanceExportQuerySchema = z
  .object({
    offeringId: idSchema,
    from: sessionDateSchema.optional(),
    to: sessionDateSchema.optional(),
  })
  .refine(
    (query) => !(query.from !== undefined && query.to !== undefined && query.from > query.to),
    {
      path: ['from'],
      message: '`from` must not be after `to`',
    },
  );
export type AttendanceExportQuery = z.infer<typeof attendanceExportQuerySchema>;

export {
  attendanceRecordSchema,
  attendanceRegisterSchema,
  attendanceStatusSchema,
  attendanceSummarySchema,
  getRegisterQuerySchema,
  idParamSchema,
  markRegisterBodySchema,
  markRegisterResponseSchema,
} from '@skillwright/shared';

export type {
  AttendanceMarkInput,
  AttendanceRecordDto,
  AttendanceRegisterDto,
  AttendanceStatusValue,
  AttendanceSummaryDto,
  GetRegisterQuery,
  IdParam,
  MarkRegisterInput,
  MarkRegisterResponse,
} from '@skillwright/shared';
