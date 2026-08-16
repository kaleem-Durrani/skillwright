import { z } from 'zod';
import {
  emailSchema,
  idSchema,
  isoDateTimeSchema,
  nameSchema,
  nullableIsoDateTimeSchema,
  phoneSchema,
} from './common.js';
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

/** Self-service edits. Role and status are absent by design — those are admin verbs. */
export const updateUserSchema = z
  .object({
    name: nameSchema,
    phoneNumber: phoneSchema.nullable(),
    bio: z.string().trim().max(2000).nullable(),
    avatarUploadId: idSchema.nullable(),
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
