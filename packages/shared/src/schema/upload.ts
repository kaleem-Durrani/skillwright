import { z } from 'zod';
import { idSchema, isoDateTimeSchema, nullableIsoDateTimeSchema } from './common.js';

export const uploadStatusSchema = z.enum(['PENDING', 'COMMITTED']);
export type UploadStatusValue = z.infer<typeof uploadStatusSchema>;

/**
 * What the upload is for. Determines the key prefix and the accepted MIME set, so
 * an avatar endpoint cannot be used to smuggle a 500 MB video into the bucket.
 */
export const uploadPurposeSchema = z.enum(['AVATAR', 'RESOURCE', 'SYLLABUS']);
export type UploadPurpose = z.infer<typeof uploadPurposeSchema>;

export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;

export const DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/markdown',
] as const;

export const VIDEO_MIME_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'] as const;

/**
 * Per-purpose limits, enforced twice: here for a fast 422, and again by the
 * presigned POST policy so a client that ignores the limit is refused by the
 * object store itself.
 */
export const UPLOAD_LIMITS: Readonly<
  Record<UploadPurpose, { readonly maxBytes: number; readonly mimeTypes: readonly string[] }>
> = Object.freeze({
  AVATAR: { maxBytes: 2 * 1024 * 1024, mimeTypes: IMAGE_MIME_TYPES },
  SYLLABUS: { maxBytes: 20 * 1024 * 1024, mimeTypes: DOCUMENT_MIME_TYPES },
  RESOURCE: {
    maxBytes: 512 * 1024 * 1024,
    mimeTypes: [...DOCUMENT_MIME_TYPES, ...IMAGE_MIME_TYPES, ...VIDEO_MIME_TYPES],
  },
});

export const presignUploadSchema = z
  .object({
    purpose: uploadPurposeSchema,
    /** Display name only. The server generates the key; the client never picks it. */
    originalName: z.string().trim().min(1).max(255),
    contentType: z.string().trim().min(3).max(160),
    sizeBytes: z.number().int().min(1),
  })
  .superRefine((body, ctx) => {
    const limit = UPLOAD_LIMITS[body.purpose];
    if (!limit.mimeTypes.includes(body.contentType)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contentType'],
        message: `${body.contentType} is not accepted for a ${body.purpose.toLowerCase()} upload.`,
      });
    }
    if (body.sizeBytes > limit.maxBytes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sizeBytes'],
        message: `Maximum size for a ${body.purpose.toLowerCase()} upload is ${limit.maxBytes} bytes.`,
      });
    }
  });
export type PresignUploadInput = z.infer<typeof presignUploadSchema>;

/**
 * The browser PUTs straight to the object store. The API never proxies bytes,
 * which is why a 500 MB video does not occupy a Node process for its lifetime.
 */
export const presignUploadResponseSchema = z.object({
  uploadId: idSchema,
  url: z.string().url(),
  method: z.literal('PUT'),
  headers: z.record(z.string()),
  key: z.string(),
  expiresAt: isoDateTimeSchema,
});
export type PresignUploadResponse = z.infer<typeof presignUploadResponseSchema>;

/** Commit is the server's HeadObject checkpoint; an uncommitted upload is swept by cron. */
export const commitUploadSchema = z.object({
  uploadId: idSchema,
});
export type CommitUploadInput = z.infer<typeof commitUploadSchema>;

export const uploadSchema = z.object({
  id: idSchema,
  key: z.string(),
  bucket: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  originalName: z.string(),
  status: uploadStatusSchema,
  ownerId: idSchema,
  createdAt: isoDateTimeSchema,
  committedAt: nullableIsoDateTimeSchema,
});
export type UploadDto = z.infer<typeof uploadSchema>;

/** Bucket objects are private; downloads are short-lived signed URLs, never a path. */
export const downloadUrlResponseSchema = z.object({
  url: z.string().url(),
  expiresAt: isoDateTimeSchema,
  filename: z.string(),
});
export type DownloadUrlResponse = z.infer<typeof downloadUrlResponseSchema>;
