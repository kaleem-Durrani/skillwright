import type { ErrorCode, FieldError } from '@skillwright/shared';

export type { FieldError };

export interface AppErrorOptions {
  detail?: string | undefined;
  errors?: FieldError[] | undefined;
  /** Attached to the log line only. Never serialised into the response. */
  cause?: unknown;
  /** Extra response headers, e.g. Retry-After on a 429. */
  headers?: Record<string, string> | undefined;
}

/**
 * The only error type route and service code is allowed to throw deliberately.
 * `isOperational` is what lets the error handler distinguish "the user did
 * something wrong" from "we have a bug", without inspecting messages.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly isOperational = true;
  readonly detail: string | undefined;
  readonly errors: FieldError[] | undefined;
  readonly headers: Record<string, string> | undefined;

  constructor(code: ErrorCode, status: number, title: string, options: AppErrorOptions = {}) {
    super(title, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.detail = options.detail;
    this.errors = options.errors;
    this.headers = options.headers;
    Error.captureStackTrace?.(this, AppError);
  }
}

/** Type guard used by the error handler; instanceof alone breaks across bundle boundaries. */
export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

export const unauthenticated = (detail?: string): AppError =>
  new AppError('UNAUTHENTICATED', 401, 'Authentication required', { detail });

/**
 * `rule` is the policy rule that denied the request. Naming it turns "403" from a
 * mystery into a one-line diagnosis, and it is safe to expose: rule names describe
 * the policy, which is public, not the data, which is not.
 */
export const forbidden = (detail?: string, rule?: string): AppError =>
  new AppError('FORBIDDEN', 403, 'Not permitted', {
    detail: rule ? `${detail ?? 'Denied by policy'} (rule: ${rule})` : detail,
  });

export const notFound = (what = 'Resource'): AppError =>
  new AppError('NOT_FOUND', 404, `${what} not found`);

export const conflict = (detail?: string): AppError =>
  new AppError('CONFLICT', 409, 'Conflicting state', { detail });

export const validationFailed = (errors: FieldError[], detail?: string): AppError =>
  new AppError('VALIDATION_FAILED', 422, 'Request validation failed', { errors, detail });

export const rateLimited = (retryAfterSeconds: number, detail?: string): AppError =>
  new AppError('RATE_LIMITED', 429, 'Too many requests', {
    detail,
    headers: { 'retry-after': String(Math.max(1, Math.ceil(retryAfterSeconds))) },
  });

export const capacityExceeded = (detail?: string): AppError =>
  new AppError('CAPACITY_EXCEEDED', 409, 'Capacity exceeded', { detail });

export const mfaRequired = (detail = 'Two-factor verification is outstanding'): AppError =>
  new AppError('MFA_REQUIRED', 403, 'Two-factor verification required', { detail });

export const emailNotVerified = (detail = 'Confirm your email address to continue'): AppError =>
  new AppError('EMAIL_NOT_VERIFIED', 403, 'Email address not verified', { detail });

export const accountSuspended = (detail = 'This account has been suspended'): AppError =>
  new AppError('ACCOUNT_SUSPENDED', 403, 'Account suspended', { detail });

export const payloadTooLarge = (detail?: string): AppError =>
  new AppError('PAYLOAD_TOO_LARGE', 413, 'Payload too large', { detail });

export const unsupportedMediaType = (detail?: string): AppError =>
  new AppError('UNSUPPORTED_MEDIA_TYPE', 415, 'Unsupported media type', { detail });

export const internal = (cause?: unknown): AppError =>
  new AppError('INTERNAL', 500, 'Internal server error', { cause });
