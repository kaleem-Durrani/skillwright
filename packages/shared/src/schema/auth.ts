import { z } from 'zod';
import { emailSchema, idSchema, isoDateTimeSchema, nameSchema } from './common.js';
import { roleSchema, userDetailSchema, userStatusSchema } from './user.js';

/** Name of the session cookie. `__Host-` forbids a subdomain from setting it. */
export const SESSION_COOKIE = '__Host-sw_session';

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 200;

/**
 * Length is the only rule.
 *
 * Composition rules (one upper, one digit, one symbol) shrink the search space by
 * telling an attacker what the password looks like, and push users towards
 * `Password1!`. Twelve characters and a breach-list check at registration beats
 * four character classes.
 */
export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`)
  .max(MAX_PASSWORD_LENGTH);

/** Six digits, as a string — leading zeros are significant. */
export const otpCodeSchema = z
  .string()
  .trim()
  .regex(/^[0-9]{6}$/, 'Enter the 6-digit code.');

export const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^[0-9]{6}$/, 'Enter the 6-digit code from your authenticator app.');

/** Recovery codes are formatted `xxxxx-xxxxx` for transcription accuracy. */
export const recoveryCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]{5}-[a-z0-9]{5}$/, 'Enter a recovery code.');

// ---------------------------------------------------------------------------
// Registration and login
// ---------------------------------------------------------------------------

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: nameSchema,
  departmentId: idSchema,
  /** Self-registration only ever creates a student; teachers are provisioned by an admin. */
  enrollmentNo: z.string().trim().min(3).max(40).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.'),
});
export type LoginInput = z.infer<typeof loginSchema>;

/**
 * What the SPA needs to render a shell and to evaluate `can()` locally.
 *
 * `provenance` is included precisely so the client runs the SAME policy the server
 * enforces — an MFA_PENDING session greys out the whole app rather than letting a
 * user click into a 403.
 */
export const sessionActorSchema = z.object({
  id: idSchema,
  role: roleSchema,
  status: userStatusSchema,
  provenance: z.enum(['PASSWORD', 'DEMO', 'MFA_PENDING']),
});
export type SessionActor = z.infer<typeof sessionActorSchema>;

export const sessionResponseSchema = z.object({
  actor: sessionActorSchema,
  user: userDetailSchema,
  expiresAt: isoDateTimeSchema,
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

/**
 * Login either completes or stops at the MFA step. A discriminated union means the
 * client cannot forget the second branch — there is no optional `mfaRequired` flag
 * to ignore.
 */
export const loginResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('AUTHENTICATED'),
    actor: sessionActorSchema,
    user: userDetailSchema,
    expiresAt: isoDateTimeSchema,
  }),
  z.object({
    status: z.literal('MFA_REQUIRED'),
    actor: sessionActorSchema,
  }),
]);
export type LoginResponse = z.infer<typeof loginResponseSchema>;

/** Demo login takes a role, never credentials. The session is stamped DEMO. */
export const demoLoginSchema = z.object({
  role: roleSchema,
});
export type DemoLoginInput = z.infer<typeof demoLoginSchema>;

// ---------------------------------------------------------------------------
// Email verification and password reset
// ---------------------------------------------------------------------------

export const verifyEmailSchema = z.object({
  email: emailSchema,
  code: otpCodeSchema,
});
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

export const resendVerificationSchema = z.object({
  email: emailSchema,
});
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

/** The email is required alongside the code so a stolen code alone is not enough. */
export const resetPasswordSchema = z.object({
  email: emailSchema,
  code: otpCodeSchema,
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/** Changing a password requires the current one; every other session is then revoked. */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: passwordSchema,
  })
  .refine((body) => body.currentPassword !== body.newPassword, {
    path: ['newPassword'],
    message: 'Choose a password you have not used here before.',
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// ---------------------------------------------------------------------------
// TOTP
// ---------------------------------------------------------------------------

/**
 * Step 1 of enrolment: hand over the secret so the user can add it to an
 * authenticator app. Nothing is enabled yet.
 *
 * Recovery codes are deliberately NOT here — see `mfaActivateResponseSchema`.
 * Issuing recovery codes at this point would mint password-equivalent credentials
 * for a second factor the user has not yet proved they hold, and every abandoned
 * enrolment would leave a live set behind.
 */
export const mfaEnrollResponseSchema = z.object({
  /** Base32 shared secret, for manual entry. */
  secret: z.string(),
  /** `otpauth://` URI the client renders as a QR code. */
  otpauthUri: z.string(),
  /** PNG data URI of the same URI, so no image request leaves the origin. */
  qrDataUrl: z.string(),
});
export type MfaEnrollResponse = z.infer<typeof mfaEnrollResponseSchema>;

/** Confirms enrolment. Distinct from `mfaVerifySchema`, which upgrades a session. */
export const mfaConfirmSchema = z.object({
  code: totpCodeSchema,
});
export type MfaConfirmInput = z.infer<typeof mfaConfirmSchema>;

/**
 * Step 2 of enrolment: one valid code has been proved, TOTP is now on, and the
 * recovery codes are returned ONCE. No endpoint can read them back.
 */
export const mfaActivateResponseSchema = z.object({
  recoveryCodes: z.array(z.string()).min(1),
});
export type MfaActivateResponse = z.infer<typeof mfaActivateResponseSchema>;

/**
 * The one action an MFA_PENDING session may take. Accepts either a TOTP code or a
 * single-use recovery code — a locked-out user with no phone still has a way in.
 */
export const mfaVerifySchema = z
  .object({
    code: totpCodeSchema.optional(),
    recoveryCode: recoveryCodeSchema.optional(),
  })
  .refine((body) => (body.code === undefined) !== (body.recoveryCode === undefined), {
    path: ['code'],
    message: 'Provide either an authenticator code or a recovery code.',
  });
export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>;

/** Disabling second-factor auth re-proves the first factor. */
export const mfaDisableSchema = z.object({
  password: z.string().min(1),
  code: totpCodeSchema,
});
export type MfaDisableInput = z.infer<typeof mfaDisableSchema>;

export const mfaStatusResponseSchema = z.object({
  enabled: z.boolean(),
  enrolledAt: z.string().datetime({ offset: true }).nullable(),
  recoveryCodesRemaining: z.number().int(),
});
export type MfaStatusResponse = z.infer<typeof mfaStatusResponseSchema>;
