/**
 * The departments module binds request shapes from @skillwright/shared rather than
 * declaring its own. A second definition of "what a login body is" would drift from
 * the SPA's within a sprint, and the drift would only surface at runtime.
 *
 * This file exists to name the exact subset the routes bind, so the wire surface of
 * the module is readable in one place.
 *
 * Nothing is declared here. Departments are addressed by `{ id }`, which
 * `idParamSchema` already covers, so this module needs no local param object of the
 * kind courses and enrollments declare for their nested `{ courseId }` path.
 */
export {
  createDepartmentSchema,
  departmentDetailSchema,
  departmentSummarySchema,
  idParamSchema,
  listDepartmentsQuerySchema,
  paginated,
  updateDepartmentSchema,
} from '@skillwright/shared';

export type {
  CreateDepartmentInput,
  DepartmentDetail,
  DepartmentSummary,
  ListDepartmentsQuery,
  Paginated,
  UpdateDepartmentInput,
} from '@skillwright/shared';
