import type { FastifyReply, FastifyRequest } from 'fastify';
import { ulid } from 'ulid';
import {
  avatarUrlFor,
  prisma,
  type AuditAction,
  type Prisma,
  type Role,
  type SessionProvenance,
  type User,
} from '@skillwright/db';
import { BRAND } from '@skillwright/shared';
import { env, isProduction } from '../../env.js';
import {
  conflict,
  emailNotVerified,
  forbidden,
  notFound,
  unauthenticated,
  validationFailed,
} from '../../lib/errors.js';
import { baseLogger } from '../../lib/logger.js';
import { burnPasswordTiming, hashPassword, verifyPassword } from '../../lib/password.js';
import { sendMail } from '../../lib/mailer.js';
import type {
  DemoLoginInput,
  LoginInput,
  LoginResponse,
  MfaActivateResponse,
  MfaDisableInput,
  MfaEnrollResponse,
  MfaVerifyInput,
  RegisterInput,
  ResetPasswordInput,
  SessionActor,
  SessionResponse,
  UserDetail,
  VerifyEmailInput,
} from './auth.schema.js';
import { consumeCode, issueAndSendCode, lockoutError } from './verification.service.js';
import {
  MFA_PENDING_TTL_MS,
  SESSION_TTL_MS,
  clearSessionCookie,
  createSession,
  destroyAllSessions,
  destroySession,
  setSessionCookie,
  upgradeSessionToPassword,
  type SessionWithUser,
} from './session.service.js';
import {
  consumeRecoveryCode,
  createEnrolment,
  regenerateRecoveryCodes,
  verifyTotpCode,
} from './totp.service.js';

const log = baseLogger.child({ module: 'auth' });

/**
 * One body for every outcome of register / resend / forgot-password. The value is in
 * it being byte-identical whether or not the address exists.
 */
export const ACK = { ok: true } as const;

/** `as const` matters: Prisma derives the payload type from the literal shape. */
const PROFILE_INCLUDE = {
  teacherProfile: { include: { department: true } },
  studentProfile: { include: { department: true } },
} as const;

type UserWithProfiles = Prisma.UserGetPayload<{ include: typeof PROFILE_INCLUDE }>;

/** The ONLY shape a user is serialised as. Nothing here is a credential. */
export function toUserDetail(user: UserWithProfiles): UserDetail {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    phoneNumber: user.phoneNumber,
    bio: user.bio,
    // TODO(uploads): serve a presigned URL when avatarUploadId is set. Until the
    // uploads module lands, the derived avatar is correct rather than broken.
    avatarUrl: avatarUrlFor(user.id),
    mfaEnabled: user.totpEnabledAt !== null,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    teacherProfile: user.teacherProfile
      ? {
          departmentId: user.teacherProfile.departmentId,
          departmentName: user.teacherProfile.department.name,
          qualification: user.teacherProfile.qualification,
          specialization: user.teacherProfile.specialization,
          staffNo: user.teacherProfile.staffNo,
        }
      : null,
    studentProfile: user.studentProfile
      ? {
          departmentId: user.studentProfile.departmentId,
          departmentName: user.studentProfile.department.name,
          enrollmentNo: user.studentProfile.enrollmentNo,
          enrolledOn: user.studentProfile.enrolledOn.toISOString(),
        }
      : null,
  };
}

/** Loads the profile satellites that `UserDetail` needs and builds the DTO. */
export async function loadUserDetail(userId: string): Promise<UserDetail> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: PROFILE_INCLUDE,
  });
  return toUserDetail(user);
}

/** The four fields `can()` reads. Nothing else about the session is the client's business. */
export function toSessionActor(provenance: SessionProvenance, user: User): SessionActor {
  return { id: user.id, role: user.role, status: user.status, provenance };
}

/**
 * Only for events the Prisma audit extension cannot infer. CRUD on User already
 * produces a row there — writing one here too would double every registration.
 */
async function audit(
  action: AuditAction,
  entityId: string,
  actorId: string | null,
  request: FastifyRequest,
): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        actorId,
        action,
        entityType: 'User',
        entityId,
        ip: request.ip ?? null,
        userAgent: request.headers['user-agent']?.slice(0, 512) ?? null,
        requestId: request.id,
      },
    });
  } catch (error) {
    log.error({ err: error, action }, 'failed to write audit event');
  }
}

function findByEmail(email: string): Promise<User | null> {
  return prisma.user.findFirst({ where: { email, deletedAt: null } });
}

// ---------------------------------------------------------------------------
// Registration & email verification
// ---------------------------------------------------------------------------

/**
 * Always resolves with the same public result. Both branches perform exactly one
 * Argon2 hash, so the response time carries no signal about whether the address was
 * already taken.
 */
export async function register(input: RegisterInput): Promise<void> {
  // Department validity is public information, so failing loudly here leaks nothing
  // — and it turns a foreign-key 500 into a field-level 422.
  const department = await prisma.department.findFirst({
    where: { id: input.departmentId, deletedAt: null },
    select: { id: true },
  });
  if (!department) {
    throw validationFailed([{ path: 'departmentId', message: 'Unknown department' }]);
  }

  const passwordHash = await hashPassword(input.password);
  const existing = await findByEmail(input.email);

  if (existing) {
    // Re-send rather than reveal. The cooldown inside issueAndSendCode stops this
    // becoming a mail bomb aimed at someone else's inbox.
    if (existing.status === 'PENDING_VERIFICATION') {
      await issueAndSendCode(existing, 'EMAIL_VERIFY');
    } else {
      await sendMail({
        to: existing.email,
        subject: `Someone tried to register with your ${BRAND.name} address`,
        text: 'An account already exists for this address. If that was you, sign in instead — or reset your password.\n',
      });
    }
    return;
  }

  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      name: input.name,
      // Self-service registration NEVER chooses a privileged role. Teachers and
      // admins are provisioned, which is why role is absent from the DTO.
      role: 'STUDENT',
      status: 'PENDING_VERIFICATION',
      studentProfile: {
        create: {
          departmentId: input.departmentId,
          // A registrant may quote the number the institution gave them; the unique
          // index is what stops two people claiming the same one.
          enrollmentNo: input.enrollmentNo ?? generateEnrollmentNo(),
        },
      },
    },
  });

  await issueAndSendCode(user, 'EMAIL_VERIFY');
}

/** Collision-free without a round trip: ULID's 80 random bits, rendered short. */
function generateEnrollmentNo(): string {
  return `SW-${new Date().getFullYear()}-${ulid().slice(-8)}`;
}

export async function verifyEmail(input: VerifyEmailInput): Promise<void> {
  const user = await findByEmail(input.email);
  if (!user) throw validationFailed([{ path: 'code', message: 'Invalid or expired code' }]);

  if (user.status === 'SUSPENDED') throw forbidden('This account has been suspended');
  if (user.status === 'ACTIVE') return; // Idempotent: a double-submitted code is not an error.

  const { outcome } = await consumeCode(user.id, 'EMAIL_VERIFY', input.code);
  if (outcome === 'locked') lockoutError();
  if (outcome !== 'ok') {
    throw validationFailed([{ path: 'code', message: 'Invalid or expired code' }]);
  }

  await prisma.user.update({ where: { id: user.id }, data: { status: 'ACTIVE' } });
}

export async function resendVerification(email: string): Promise<void> {
  await burnPasswordTiming();
  const user = await findByEmail(email);
  if (user?.status === 'PENDING_VERIFICATION') {
    await issueAndSendCode(user, 'EMAIL_VERIFY');
  }
}

// ---------------------------------------------------------------------------
// Password login
// ---------------------------------------------------------------------------

export async function login(
  input: LoginInput,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<LoginResponse> {
  const user = await findByEmail(input.email);

  if (!user?.passwordHash) {
    await burnPasswordTiming(input.password);
    throw unauthenticated('Email or password is incorrect');
  }

  const ok = await verifyPassword(user.passwordHash, input.password);
  if (!ok) throw unauthenticated('Email or password is incorrect');

  if (user.status === 'SUSPENDED') {
    await destroyAllSessions(user.id);
    throw forbidden('This account has been suspended');
  }
  if (user.status === 'PENDING_VERIFICATION') {
    await issueAndSendCode(user, 'EMAIL_VERIFY');
    throw emailNotVerified('Confirm your email address — we have sent a fresh code.');
  }

  if (user.totpEnabledAt) {
    const { session, token } = await createSession(user.id, 'MFA_PENDING', request);
    setSessionCookie(reply, token, MFA_PENDING_TTL_MS);
    return { status: 'MFA_REQUIRED', actor: toSessionActor(session.provenance, user) };
  }

  const { session, token } = await createSession(user.id, 'PASSWORD', request);
  setSessionCookie(reply, token, SESSION_TTL_MS);
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });
  await audit('LOGIN', user.id, user.id, request);

  return {
    status: 'AUTHENTICATED',
    actor: toSessionActor(session.provenance, updated),
    user: await loadUserDetail(user.id),
    // Zod's isoDateTimeSchema accepts a Date and normalises it on serialisation.
    expiresAt: session.expiresAt.toISOString(),
  };
}

export async function logout(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (request.session) {
    await destroySession(request.session.id);
    await audit('LOGOUT', request.session.userId, request.session.userId, request);
  }
  clearSessionCookie(reply);
}

export async function logoutAll(
  session: SessionWithUser,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<{ revoked: number }> {
  const revoked = await destroyAllSessions(session.userId);
  await audit('LOGOUT', session.userId, session.userId, request);
  clearSessionCookie(reply);
  return { revoked };
}

export async function currentSession(session: SessionWithUser): Promise<SessionResponse> {
  return {
    actor: toSessionActor(session.provenance, session.user),
    user: await loadUserDetail(session.userId),
    expiresAt: session.expiresAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

export async function forgotPassword(email: string): Promise<void> {
  await burnPasswordTiming();
  const user = await findByEmail(email);
  if (user && user.status !== 'SUSPENDED') {
    await issueAndSendCode(user, 'PASSWORD_RESET');
  }
}

export async function resetPassword(input: ResetPasswordInput): Promise<void> {
  const user = await findByEmail(input.email);
  if (!user) {
    await burnPasswordTiming(input.password);
    throw validationFailed([{ path: 'code', message: 'Invalid or expired code' }]);
  }

  const { outcome } = await consumeCode(user.id, 'PASSWORD_RESET', input.code);
  if (outcome === 'locked') lockoutError();
  if (outcome !== 'ok') {
    throw validationFailed([{ path: 'code', message: 'Invalid or expired code' }]);
  }

  const passwordHash = await hashPassword(input.password);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        // A reset also finishes an unfinished sign-up: possession of the mailbox is
        // exactly what email verification was asking for.
        status: user.status === 'PENDING_VERIFICATION' ? 'ACTIVE' : user.status,
      },
    }),
    // Every existing cookie dies. If the reset was triggered by a compromise, leaving
    // the attacker's session alive would defeat the entire exercise.
    prisma.session.deleteMany({ where: { userId: user.id } }),
  ]);
}

// ---------------------------------------------------------------------------
// TOTP
// ---------------------------------------------------------------------------

/**
 * Bound to the shared schema rather than a local interface, so a field renamed in
 * `packages/shared/src/schema/auth.ts` fails this compile instead of silently
 * serving a shape the SPA no longer reads.
 */
export type MfaEnrollResult = MfaEnrollResponse;

export async function mfaEnroll(session: SessionWithUser): Promise<MfaEnrollResponse> {
  if (session.provenance !== 'PASSWORD') {
    throw forbidden('Two-factor enrolment requires a password session', 'mfa.passwordSession');
  }
  if (session.user.totpEnabledAt) {
    throw conflict('Two-factor authentication is already enabled');
  }

  const enrolment = await createEnrolment(session.user.email);
  await prisma.user.update({
    where: { id: session.userId },
    data: { totpSecret: enrolment.encryptedSecret, totpEnabledAt: null, totpLastUsedCounter: null },
  });

  return {
    secret: enrolment.secretBase32,
    otpauthUri: enrolment.otpauthUri,
    qrDataUrl: enrolment.qrDataUrl,
  };
}

export async function mfaActivate(
  session: SessionWithUser,
  code: string,
  request: FastifyRequest,
): Promise<MfaActivateResponse> {
  if (session.provenance !== 'PASSWORD') {
    throw forbidden('Two-factor enrolment requires a password session', 'mfa.passwordSession');
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
  if (user.totpEnabledAt) throw conflict('Two-factor authentication is already enabled');
  if (!user.totpSecret) throw conflict('Start enrolment before activating');

  const check = verifyTotpCode(user, code);
  if (!check.valid) throw validationFailed([{ path: 'code', message: 'That code is not valid' }]);

  await prisma.user.update({
    where: { id: user.id },
    data: { totpEnabledAt: new Date(), totpLastUsedCounter: check.counter },
  });

  const recoveryCodes = await regenerateRecoveryCodes(user.id);
  await audit('MFA_ENABLE', user.id, user.id, request);

  // Shown exactly once. No endpoint can read them back.
  return { recoveryCodes };
}

export async function mfaVerify(
  session: SessionWithUser,
  input: MfaVerifyInput,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<SessionResponse> {
  if (session.provenance !== 'MFA_PENDING') {
    throw conflict('This session is not awaiting two-factor verification');
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
  if (!user.totpEnabledAt) throw conflict('Two-factor authentication is not enabled');

  if (input.code) {
    const check = verifyTotpCode(user, input.code);
    if (!check.valid) throw unauthenticated('That code is not valid');
    await prisma.user.update({
      where: { id: user.id },
      data: { totpLastUsedCounter: check.counter },
    });
  } else {
    const ok = await consumeRecoveryCode(user.id, input.recoveryCode ?? '');
    if (!ok) throw unauthenticated('That recovery code is not valid');
  }

  const { token, expiresAt } = await upgradeSessionToPassword(session.id);
  setSessionCookie(reply, token, SESSION_TTL_MS);

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });
  await audit('LOGIN', user.id, user.id, request);

  return {
    actor: toSessionActor('PASSWORD', updated),
    user: await loadUserDetail(user.id),
    expiresAt: expiresAt.toISOString(),
  };
}

export async function mfaDisable(
  session: SessionWithUser,
  input: MfaDisableInput,
  request: FastifyRequest,
): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
  if (!user.totpEnabledAt) throw conflict('Two-factor authentication is not enabled');
  if (!user.passwordHash) throw conflict('Set a password before changing two-factor settings');

  const passwordOk = await verifyPassword(user.passwordHash, input.password);
  const codeOk = verifyTotpCode(user, input.code).valid;
  // Both factors, because disabling 2FA is exactly the action a session hijacker wants.
  if (!passwordOk || !codeOk) throw unauthenticated('Password or code is incorrect');

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { totpSecret: null, totpEnabledAt: null, totpLastUsedCounter: null },
    }),
    prisma.recoveryCode.deleteMany({ where: { userId: user.id } }),
  ]);

  await audit('MFA_DISABLE', user.id, user.id, request);
}

// ---------------------------------------------------------------------------
// Demo
// ---------------------------------------------------------------------------

const DEMO_EMAILS: Record<Role, string> = {
  STUDENT: 'demo.student@skillwright.local',
  TEACHER: 'demo.teacher@skillwright.local',
  ADMIN: 'demo.admin@skillwright.local',
};

const DEMO_NAMES: Record<Role, string> = {
  STUDENT: 'Demo Student',
  TEACHER: 'Demo Teacher',
  ADMIN: 'Demo Admin',
};

/**
 * Two independent guards. DEMO_MODE is a knob someone can flip by accident;
 * DEPLOY_ENV === 'production' is not, and it wins regardless.
 */
export async function demoLogin(
  input: DemoLoginInput,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<LoginResponse> {
  if (isProduction || !env.DEMO_MODE) throw notFound('Route');

  const email = DEMO_EMAILS[input.role];
  const user = await prisma.user.upsert({
    where: { email },
    update: { status: 'ACTIVE' },
    create: {
      email,
      name: DEMO_NAMES[input.role],
      role: input.role,
      status: 'ACTIVE',
      // No password: a demo identity must not be reachable through the normal login.
      passwordHash: null,
    },
  });

  const { session, token } = await createSession(user.id, 'DEMO', request);
  setSessionCookie(reply, token, SESSION_TTL_MS);
  await audit('LOGIN', user.id, user.id, request);

  return {
    status: 'AUTHENTICATED',
    actor: toSessionActor(session.provenance, user),
    user: await loadUserDetail(user.id),
    expiresAt: session.expiresAt.toISOString(),
  };
}
