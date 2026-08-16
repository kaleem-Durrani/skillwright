import { prisma, type User, type VerificationPurpose } from '@skillwright/db';
import { BRAND } from '@skillwright/shared';
import { randomNumericCode, safeEqualHex, sha256 } from '../../lib/crypto.js';
import { sendMail } from '../../lib/mailer.js';
import { rateLimited } from '../../lib/errors.js';

export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
export const RESEND_COOLDOWN_MS = 60 * 1000;

export type VerifyOutcome = 'ok' | 'invalid' | 'locked';

const SUBJECTS: Record<VerificationPurpose, string> = {
  EMAIL_VERIFY: `Confirm your ${BRAND.name} email address`,
  PASSWORD_RESET: `Reset your ${BRAND.name} password`,
  EMAIL_CHANGE: `Confirm your new ${BRAND.name} email address`,
};

function body(purpose: VerificationPurpose, code: string): string {
  const minutes = CODE_TTL_MS / 60_000;
  const intent =
    purpose === 'PASSWORD_RESET'
      ? 'Use this code to choose a new password'
      : 'Use this code to confirm your email address';
  return `${intent}:\n\n    ${code}\n\nIt expires in ${minutes} minutes and can be used once.\nIf you did not request it, ignore this message — nothing has changed.\n`;
}

/**
 * Issues a code and mails it, or silently does nothing if the previous code for this
 * purpose is younger than the cooldown.
 *
 * The cooldown lives HERE rather than in the route because every caller — register,
 * resend, forgot-password, an admin re-invite — must obey it. A route-level guard is
 * one new endpoint away from being forgotten.
 */
export async function issueAndSendCode(
  user: Pick<User, 'id' | 'email'>,
  purpose: VerificationPurpose,
  payload?: string,
): Promise<void> {
  const latest = await prisma.verification.findFirst({
    where: { userId: user.id, purpose },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });

  if (latest && Date.now() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS) return;

  const code = randomNumericCode(6);

  await prisma.$transaction([
    // Exactly one live code per purpose, so an attacker cannot widen the guess space
    // by requesting twenty codes and trying all of them.
    prisma.verification.deleteMany({ where: { userId: user.id, purpose, consumedAt: null } }),
    prisma.verification.create({
      data: {
        userId: user.id,
        purpose,
        codeHash: sha256(code),
        payload: payload ?? null,
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      },
    }),
  ]);

  await sendMail({ to: user.email, subject: SUBJECTS[purpose], text: body(purpose, code) });
}

/**
 * Spends a code. Returns 'locked' once the attempt budget is gone — the code is burned
 * at that point, so a lockout cannot be waited out, only re-requested.
 */
export async function consumeCode(
  userId: string,
  purpose: VerificationPurpose,
  code: string,
): Promise<{ outcome: VerifyOutcome; payload?: string | null }> {
  const record = await prisma.verification.findFirst({
    where: { userId, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });

  if (!record) return { outcome: 'invalid' };
  if (record.attempts >= MAX_ATTEMPTS) return { outcome: 'locked' };

  if (!safeEqualHex(record.codeHash, sha256(code))) {
    const updated = await prisma.verification.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
      select: { attempts: true },
    });
    if (updated.attempts >= MAX_ATTEMPTS) {
      await prisma.verification.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      });
      return { outcome: 'locked' };
    }
    return { outcome: 'invalid' };
  }

  await prisma.verification.update({
    where: { id: record.id },
    data: { consumedAt: new Date() },
  });
  return { outcome: 'ok', payload: record.payload };
}

/** Turns a lockout into the 429 the client should see, with the code's own TTL as Retry-After. */
export function lockoutError(): never {
  throw rateLimited(CODE_TTL_MS / 1000, 'Too many incorrect codes. Request a new one.');
}
