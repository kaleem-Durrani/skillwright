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
import { idSchema } from '@skillwright/shared';

export const courseIdParamSchema = z.object({ courseId: idSchema });
export type CourseIdParam = z.infer<typeof courseIdParamSchema>;

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
