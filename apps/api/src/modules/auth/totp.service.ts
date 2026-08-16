import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import argon2 from 'argon2';
import { prisma, type User } from '@skillwright/db';
import { BRAND } from '@skillwright/shared';
import { decryptSecret, encryptSecret, randomRecoveryCode } from '../../lib/crypto.js';

/** Shown in the authenticator app next to the account. Changing it re-labels every entry. */
const ISSUER = BRAND.name;
const PERIOD_SECONDS = 30;
const DIGITS = 6;
/** ±1 step: forgives a phone whose clock is up to 30 s out, without widening the guess space to minutes. */
const SKEW_STEPS = 1;
export const RECOVERY_CODE_COUNT = 10;

function buildTotp(secretBase32: string, email: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label: email,
    algorithm: 'SHA1',
    digits: DIGITS,
    period: PERIOD_SECONDS,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

export interface TotpEnrolment {
  /** Encrypted at rest; the caller writes this straight into User.totpSecret. */
  encryptedSecret: string;
  /** Plaintext base32, returned to the enrolling user once and never persisted. */
  secretBase32: string;
  otpauthUri: string;
  qrDataUrl: string;
}

/**
 * Creates a secret but does NOT enable anything. Enrolment is only real once the user
 * proves one code, which is what stops a half-finished setup from locking them out.
 */
export async function createEnrolment(email: string): Promise<TotpEnrolment> {
  const secret = new OTPAuth.Secret({ size: 20 }); // 160 bits, the RFC 4226 recommendation
  const totp = buildTotp(secret.base32, email);
  const otpauthUri = totp.toString();

  return {
    encryptedSecret: encryptSecret(secret.base32),
    secretBase32: secret.base32,
    otpauthUri,
    qrDataUrl: await QRCode.toDataURL(otpauthUri, { errorCorrectionLevel: 'M', margin: 1 }),
  };
}

export interface TotpCheck {
  valid: boolean;
  /** The absolute time step the accepted code belongs to; persisted to block replay. */
  counter: bigint | null;
}

/**
 * Validates a code against the stored secret and the replay high-water mark. A code is
 * accepted at most once even though it stays arithmetically valid for its whole window.
 */
export function verifyTotpCode(
  user: Pick<User, 'email' | 'totpSecret' | 'totpLastUsedCounter'>,
  token: string,
): TotpCheck {
  if (!user.totpSecret) return { valid: false, counter: null };

  let totp: OTPAuth.TOTP;
  try {
    totp = buildTotp(decryptSecret(user.totpSecret), user.email);
  } catch {
    return { valid: false, counter: null };
  }

  const delta = totp.validate({ token: token.replace(/\s+/g, ''), window: SKEW_STEPS });
  if (delta === null) return { valid: false, counter: null };

  const counter = BigInt(Math.floor(Date.now() / 1000 / PERIOD_SECONDS) + delta);
  if (user.totpLastUsedCounter !== null && counter <= user.totpLastUsedCounter) {
    return { valid: false, counter: null };
  }
  return { valid: true, counter };
}

/**
 * Replaces every recovery code in one transaction and returns the plaintext ONCE.
 * Regenerating is the only way to see them again, by design.
 */
export async function regenerateRecoveryCodes(userId: string): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => randomRecoveryCode());
  const hashes = await Promise.all(
    codes.map((code) => argon2.hash(code, { type: argon2.argon2id })),
  );

  await prisma.$transaction([
    prisma.recoveryCode.deleteMany({ where: { userId } }),
    prisma.recoveryCode.createMany({
      data: hashes.map((codeHash) => ({ userId, codeHash })),
    }),
  ]);

  return codes;
}

/** Spends a recovery code. Single use: the row is marked the moment it matches. */
export async function consumeRecoveryCode(userId: string, candidate: string): Promise<boolean> {
  const normalised = candidate.trim().toUpperCase();
  const rows = await prisma.recoveryCode.findMany({ where: { userId, usedAt: null } });

  for (const row of rows) {
    const matches = await argon2.verify(row.codeHash, normalised).catch(() => false);
    if (!matches) continue;
    const { count } = await prisma.recoveryCode.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    return count === 1;
  }
  return false;
}
