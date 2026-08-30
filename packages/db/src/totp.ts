import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The storage envelope for a TOTP shared secret, written where the seed can reach it.
 *
 * This exists because there were two of them. `apps/api/src/lib/crypto.ts` writes
 * `base64(version || iv || tag || ciphertext)` keyed on `ENCRYPTION_KEY`; the seed
 * wrote `v1.<iv>.<tag>.<ct>` as dot-joined base64url, keyed on a `TOTP_ENCRYPTION_KEY`
 * that the API's env schema does not even declare. They disagreed on the format AND
 * on the key, so `decryptSecret` threw `Malformed encrypted payload` on every seeded
 * secret, `verifyTotpCode` swallowed the throw and returned `{ valid: false }`, and the
 * demo account the seed banner advertises as TOTP-enabled rejected every correct code
 * it was ever given. Only its recovery codes worked, because those are hashed by a
 * different path. No test caught it: the API suite encrypts with the API's own
 * function and never with the seed's.
 *
 * The format below is byte-identical to what `decryptSecret` expects, and the round
 * trip is asserted in `apps/api/test/auth.test.ts` — a shared function plus a test,
 * because a comment saying "keep these in step" is exactly what was here before.
 *
 * It lives in `@skillwright/db` rather than `@skillwright/shared` because the seed is
 * the only non-API caller and this package is already its dependency; `shared` is
 * deliberately free of Node crypto so the same module can run in a browser.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
/** Leading byte, so the format can change without guessing at a data migration. */
const VERSION = 1;

/**
 * Reads ONE variable out of the repository-root `.env`, without importing it.
 *
 * `process.loadEnvFile` would be shorter and is wrong here: the seed's own
 * `DATABASE_URL` has already been resolved by Prisma Client from
 * `packages/db/.env`, and loading the root file would overwrite it. On a machine
 * where the two point at different databases — which is exactly why the per-package
 * copy exists — that would silently seed the wrong one. So: read the text, take the
 * single key we came for, touch nothing else.
 */
function readRootEnvVar(name: string): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url)); // packages/db/src
  for (const candidate of [resolve(here, '../../..', '.env'), resolve(process.cwd(), '.env')]) {
    if (!existsSync(candidate)) continue;
    for (const line of readFileSync(candidate, 'utf8').split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!match || match[1] !== name) continue;
      return match[2]!.trim().replace(/^["']|["']$/g, '');
    }
  }
  return undefined;
}

/** Resolves the AES-256 key from the same variable, and the same file, the API reads. */
function resolveKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY ?? readRootEnvVar('ENCRYPTION_KEY');
  if (!raw) {
    throw new Error(
      'ENCRYPTION_KEY is not set. The seed encrypts TOTP secrets with the same key the API ' +
        'decrypts them with, so seeding without it produces an account that cannot sign in — ' +
        'which is the exact defect this function was written to end. Copy .env.example to .env ' +
        'at the repository root before running the seed.',
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must decode to 32 bytes for AES-256; got ${key.length}. ` +
        'It is base64, not hex.',
    );
  }
  return key;
}

export interface EncryptTotpSecretOptions {
  /**
   * Derive the IV from the plaintext instead of drawing it at random.
   *
   * ONLY for the seed, and only because re-running it must produce the same row
   * rather than a new ciphertext every time. A repeated IV under one key is a
   * complete break of GCM's authentication, so real enrolment must never pass this.
   */
  deterministicIv?: boolean;
}

/**
 * Encrypts a TOTP shared secret into the envelope `decryptSecret` reads.
 *
 * Symmetric rather than hashed because the server has to reproduce the secret to
 * derive codes — the one credential in this system that genuinely cannot be one-way.
 */
export function encryptTotpSecret(
  plaintext: string,
  options: EncryptTotpSecretOptions = {},
): string {
  const key = resolveKey();
  const iv = options.deterministicIv
    ? createHash('sha256').update(`seed-totp-iv:${plaintext}`).digest().subarray(0, IV_BYTES)
    : randomBytes(IV_BYTES);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([Buffer.from([VERSION]), iv, tag, ciphertext]).toString('base64');
}
