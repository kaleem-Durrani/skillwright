import argon2 from 'argon2';

/** OWASP 2024 second-choice parameters for Argon2id: 19 MiB, 2 passes, 1 lane. */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, ARGON2_OPTIONS);
}

/** Never throws on a malformed stored hash — a corrupt row is a failed login, not a 500. */
export async function verifyPassword(hash: string, plaintext: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plaintext);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | null = null;

/**
 * Burns the same CPU as a real verification on the "no such user" path. Without it,
 * login and forgot-password answer a miss in ~1 ms and a hit in ~60 ms, which is a
 * user-enumeration oracle no matter how identical the response bodies are.
 */
export async function burnPasswordTiming(
  candidate = 'timing-equalisation-placeholder',
): Promise<void> {
  dummyHash ??= argon2.hash('skillwright-dummy-password-for-timing', ARGON2_OPTIONS);
  await verifyPassword(await dummyHash, candidate);
}
