import { z } from 'zod';
import { idSchema, isoDateTimeSchema, slugSchema } from './common.js';
import { paginationQuerySchema } from './pagination.js';

export const departmentSummarySchema = z.object({
  id: idSchema,
  name: z.string(),
  slug: slugSchema,
});
export type DepartmentSummary = z.infer<typeof departmentSummarySchema>;

export const departmentDetailSchema = departmentSummarySchema.extend({
  description: z.string().nullable(),
  courseCount: z.number().int(),
  teacherCount: z.number().int(),
  studentCount: z.number().int(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type DepartmentDetail = z.infer<typeof departmentDetailSchema>;

/**
 * The slug is optional on create because the server derives it from the name. It
 * is accepted so a migration can preserve existing URLs.
 */
export const createDepartmentSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: slugSchema.optional(),
  description: z.string().trim().max(2000).optional(),
});
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(2000).nullable(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Provide at least one field to update.',
  });
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;

export const listDepartmentsQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(120).optional(),
});
export type ListDepartmentsQuery = z.infer<typeof listDepartmentsQuerySchema>;
