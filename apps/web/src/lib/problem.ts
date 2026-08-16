/**
 * Client-side mirror of the RFC 9457 envelope defined in
 * packages/shared/src/schema/errors.ts.
 *
 * WHY a mirror rather than an import: this file is the single place the web app
 * touches the error contract, so a drift is a one-file fix, and the web build
 * stays typecheckable while the shared package is still being written. If the
 * shared package's ErrorCode ever gains a member, add it here too — the union is
 * intentionally closed so a `switch` over it stays exhaustive.
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

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface FieldError {
  path: string;
  message: string;
}

export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code: ErrorCode;
  errors?: FieldError[];
  requestId: string;
}

/** Narrow an unknown response body to the Problem envelope. */
export function isProblem(value: unknown): value is Problem {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.title === 'string' &&
    typeof candidate.status === 'number' &&
    typeof candidate.code === 'string'
  );
}

/**
 * Human-facing fallback copy, keyed by code.
 *
 * WHY: `detail` from the server is written for a developer reading a log. The
 * user gets this instead unless the server explicitly marked its detail as
 * user-safe by sending a `title` we recognise.
 */
export const ERROR_COPY: Record<ErrorCode, string> = {
  VALIDATION_FAILED: 'Some of those details need another look.',
  UNAUTHENTICATED: 'Please sign in to continue.',
  FORBIDDEN: "You don't have access to that.",
  NOT_FOUND: "We couldn't find that.",
  CONFLICT: 'That conflicts with something that already exists.',
  RATE_LIMITED: 'Too many attempts. Wait a moment, then try again.',
  PAYLOAD_TOO_LARGE: 'That file is too large.',
  UNSUPPORTED_MEDIA_TYPE: "That file type isn't supported.",
  INTERNAL: 'Something went wrong on our side.',
  MFA_REQUIRED: 'Enter your authentication code to continue.',
  EMAIL_NOT_VERIFIED: 'Verify your email address to continue.',
  ACCOUNT_SUSPENDED: 'This account has been suspended.',
  CAPACITY_EXCEEDED: 'This course is full.',
};

/**
 * The only error type the data layer throws.
 *
 * WHY a class and not a plain object: `instanceof` in a catch block is the one
 * check that survives being passed through TanStack Query, an error boundary,
 * and a toast handler without anyone having to remember a discriminant.
 */
export class ApiError extends Error {
  readonly problem: Problem;
  readonly status: number;
  readonly code: ErrorCode;
  readonly requestId: string;
  readonly fieldErrors: FieldError[];

  constructor(problem: Problem) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
    this.problem = problem;
    this.status = problem.status;
    this.code = problem.code;
    this.requestId = problem.requestId;
    this.fieldErrors = problem.errors ?? [];
  }

  /** Copy safe to render to a user. */
  get userMessage(): string {
    return ERROR_COPY[this.code] ?? ERROR_COPY.INTERNAL;
  }

  /** Field errors reshaped for react-hook-form's `setError`. */
  get byField(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const error of this.fieldErrors) {
      if (!(error.path in out)) out[error.path] = error.message;
    }
    return out;
  }

  is(code: ErrorCode): boolean {
    return this.code === code;
  }
}

/** Build a synthetic Problem for failures that never reached the server. */
export function transportProblem(detail: string): Problem {
  return {
    type: 'about:blank',
    title: 'Network error',
    status: 0,
    detail,
    code: 'INTERNAL',
    requestId: 'local',
  };
}
