import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';
import { env } from '../env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // GCM's canonical nonce length; 12 avoids the extra GHASH derivation step.
const TAG_BYTES = 16;
const VERSION = 1; // Leading byte, so the ciphertext format can change without a data migration guess.

const key = Buffer.from(env.ENCRYPTION_KEY, 'base64');

/**
 * Encrypts a TOTP shared secret for storage. Symmetric rather than hashed because
 * the server must reproduce the secret to derive codes — this is the one credential
 * in the system that genuinely cannot be one-way.
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([VERSION]), iv, tag, ciphertext]).toString('base64');
}

/** Throws if the payload was truncated, re-encrypted under another key, or tampered with. */
export function decryptSecret(payload: string): string {
  const raw = Buffer.from(payload, 'base64');
  if (raw.length < 1 + IV_BYTES + TAG_BYTES || raw[0] !== VERSION) {
    throw new Error('Malformed encrypted payload');
  }
  const iv = raw.subarray(1, 1 + IV_BYTES);
  const tag = raw.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const ciphertext = raw.subarray(1 + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Hash for values that are already high-entropy (session tokens, 6-digit codes bound
 * to a short expiry and an attempt counter). Argon2 is for user-chosen secrets; using
 * it here would put a 100 ms cost on every authenticated request.
 */
export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** 32 bytes of CSPRNG output, base64url — the raw session cookie value. */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Uniform, non-modulo-biased numeric code. `randomInt` is rejection-sampled by Node. */
export function randomNumericCode(digits = 6): string {
  const max = 10 ** digits;
  return String(randomInt(0, max)).padStart(digits, '0');
}

/** Human-transcribable recovery code: 10 Crockford-ish chars, dashed for readability. */
export function randomRecoveryCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I/L/O/0/1
  let out = '';
  for (let i = 0; i < 10; i += 1) out += alphabet.charAt(randomInt(0, alphabet.length));
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

/** Constant-time compare for hex digests of equal length. */
export function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}
