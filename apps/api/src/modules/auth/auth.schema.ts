/**
 * The auth module binds request shapes from @skillwright/shared rather than
 * declaring its own. A second definition of "what a login body is" would drift from
 * the SPA's within a sprint, and the drift would only surface at runtime.
 *
 * This file exists to name the exact subset the routes bind, so the wire surface of
 * the module is readable in one place.
 */
export {
  demoLoginSchema,
  forgotPasswordSchema,
  loginSchema,
  mfaConfirmSchema,
  mfaDisableSchema,
  mfaVerifySchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '@skillwright/shared';

export type {
  DemoLoginInput,
  ForgotPasswordInput,
  LoginInput,
  LoginResponse,
  MfaActivateResponse,
  MfaConfirmInput,
  MfaDisableInput,
  MfaEnrollResponse,
  MfaVerifyInput,
  RegisterInput,
  ResetPasswordInput,
  SessionActor,
  SessionResponse,
  UserDetail,
  VerifyEmailInput,
} from '@skillwright/shared';
