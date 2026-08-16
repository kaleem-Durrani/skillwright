import { z } from 'zod';

/**
 * Machine-readable failure taxonomy.
 *
 * HTTP status alone is too coarse for a client to branch on — 403 covers "you are
 * not allowed", "verify your email" and "you are suspended", and those need three
 * different screens. `code` is the field the SPA switches over; `status` stays for
 * proxies and logs.
 */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'INTERNAL',
  'MFA_REQUIRED',
  'EMAIL_NOT_VERIFIED',
  'ACCOUNT_SUSPENDED',
  'CAPACITY_EXCEEDED',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** Const-object form, so call sites read `ErrorCode.NOT_FOUND` instead of a bare string. */
export const ErrorCode = Object.freeze(
  Object.fromEntries(ERROR_CODES.map((c) => [c, c])) as { readonly [K in ErrorCode]: K },
);

/** Default HTTP status per code. The mapper may override; nothing else should. */
export const ERROR_STATUS: Readonly<Record<ErrorCode, number>> = Object.freeze({
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  INTERNAL: 500,
  MFA_REQUIRED: 403,
  EMAIL_NOT_VERIFIED: 403,
  ACCOUNT_SUSPENDED: 403,
  CAPACITY_EXCEEDED: 409,
});

export const fieldErrorSchema = z.object({
  /** Dot/bracket path into the submitted body, e.g. `profile.phoneNumber`. */
  path: z.string(),
  message: z.string(),
});
export type FieldError = z.infer<typeof fieldErrorSchema>;

/**
 * RFC 9457 problem+json, plus two additions the RFC leaves to the application:
 * `code` (the taxonomy above) and `requestId` (present on EVERY response, so a
 * user can paste one number into a support ticket and it resolves to a log line).
 */
export const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  code: errorCodeSchema,
  errors: z.array(fieldErrorSchema).optional(),
  requestId: z.string(),
});
export type Problem = z.infer<typeof problemSchema>;

/** Content type every error response is served with. */
export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** Stable `type` URI for a code, so the field is a real identifier and not a placeholder. */
export function problemTypeUri(code: ErrorCode): string {
  return `https://skillwright.dev/problems/${code.toLowerCase().replace(/_/g, '-')}`;
}
