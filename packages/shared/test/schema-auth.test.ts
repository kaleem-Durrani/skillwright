import { describe, expect, it } from 'vitest';
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  SESSION_COOKIE,
  changePasswordSchema,
  mfaVerifySchema,
  otpCodeSchema,
  passwordSchema,
  recoveryCodeSchema,
  registerSchema,
  totpCodeSchema,
} from '../src/schema/index.js';

/**
 * The credential-shaped rules in auth.ts.
 *
 * Every one of these is a decision the file argues for in prose and nothing enforces:
 * length is the only password rule, a six-digit code is a STRING because leading zeros
 * are significant, and `mfaVerifySchema` takes exactly one of two credentials. Prose
 * does not fail a build. A well-meaning "harden the password policy" commit that adds
 * a composition rule, or a "tidy the types" commit that makes an OTP a number, would
 * both pass typecheck and lint, and the second one silently locks out one user in ten.
 */

describe('passwordSchema', () => {
  it('accepts twelve characters of nothing but lowercase letters', () => {
    // The documented position: composition rules shrink the search space by telling an
    // attacker the shape of the password and push people towards `Password1!`. If a
    // "must contain a digit and a symbol" check is ever added, this is what breaks.
    expect(passwordSchema.safeParse('correcthorse').success).toBe(true);
    expect(passwordSchema.safeParse('correct horse battery staple').success).toBe(true);
  });

  it('holds the floor at exactly MIN_PASSWORD_LENGTH, with the message the form renders', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
    expect(passwordSchema.safeParse('a'.repeat(MIN_PASSWORD_LENGTH)).success).toBe(true);
    const short = passwordSchema.safeParse('a'.repeat(MIN_PASSWORD_LENGTH - 1));
    expect(short.success).toBe(false);
    if (short.success) throw new Error('unreachable');
    expect(short.error.issues[0]?.message).toBe('Use at least 12 characters.');
  });

  it('caps length, because Argon2id hashes whatever it is handed', () => {
    // Without a ceiling a login POST is an unbounded amount of work per request, and
    // the hash cost is deliberately high — that is a denial of service, not a typo.
    //
    // So the literal is asserted, exactly as MIN_PASSWORD_LENGTH is above. The two
    // `'a'.repeat(MAX_PASSWORD_LENGTH)` assertions are self-referential: raising the
    // constant to 100000 keeps them green, and the denial of service this test names
    // is then live and unguarded.
    expect(MAX_PASSWORD_LENGTH).toBe(200);
    expect(passwordSchema.safeParse('a'.repeat(MAX_PASSWORD_LENGTH)).success).toBe(true);
    expect(passwordSchema.safeParse('a'.repeat(MAX_PASSWORD_LENGTH + 1)).success).toBe(false);
  });
});

describe('otpCodeSchema and totpCodeSchema', () => {
  it('keeps a leading zero, which is why the code is a string', () => {
    // One code in ten starts with a zero. As a number `012345` parses to 12345, fails
    // the six-digit comparison against the stored value, and the user is told "That
    // code is not right" forever — a bug that reproduces for 10% of accounts.
    expect(otpCodeSchema.parse('012345')).toBe('012345');
    expect(totpCodeSchema.parse('000000')).toBe('000000');
  });

  it('refuses a number, so the string-ness cannot be lost at a call site', () => {
    expect(otpCodeSchema.safeParse(123456).success).toBe(false);
  });

  it('requires exactly six digits', () => {
    for (const bad of ['12345', '1234567', '12 345', 'abcdef', '']) {
      expect(otpCodeSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
      expect(totpCodeSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('trims, because a pasted code arrives with whitespace', () => {
    expect(otpCodeSchema.parse(' 418302 ')).toBe('418302');
  });
});

describe('recoveryCodeSchema', () => {
  it('lowercases what the user typed, because the codes are shown lowercase', () => {
    // Transcribed off a printout under a keyboard's caps lock, `ABCDE-FGHIJ` has to
    // match the stored hash of `abcde-fghij` or the last way back in fails.
    expect(recoveryCodeSchema.parse('  ABCDE-FGHIJ  ')).toBe('abcde-fghij');
  });

  it('requires the two five-character groups', () => {
    // The hyphenated shape exists for transcription accuracy; accepting the unhyphenated
    // form would mean two spellings of one code and only one of them hashing correctly.
    for (const bad of ['abcdefghij', 'abcd-fghij', 'abcde_fghij', 'abcde-fghi', '']) {
      expect(recoveryCodeSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('mfaVerifySchema', () => {
  /*
   * An exclusive or, spelled `(a === undefined) !== (b === undefined)`. Both halves
   * matter: neither credential is an empty request that would reach the verifier with
   * nothing to check, and both at once is a caller trying two credentials in one
   * request against whatever rate limit counts requests rather than attempts.
   */
  it('accepts an authenticator code alone', () => {
    expect(mfaVerifySchema.parse({ code: '418302' })).toEqual({ code: '418302' });
  });

  it('accepts a recovery code alone, so a lost phone is not a lost account', () => {
    expect(mfaVerifySchema.parse({ recoveryCode: 'abcde-fghij' })).toEqual({
      recoveryCode: 'abcde-fghij',
    });
  });

  it('refuses an empty body and refuses both at once, at a path the form can render', () => {
    for (const body of [{}, { code: '418302', recoveryCode: 'abcde-fghij' }]) {
      const result = mfaVerifySchema.safeParse(body);
      expect(result.success, JSON.stringify(body)).toBe(false);
      if (result.success) throw new Error('unreachable');
      expect(result.error.issues[0]?.path).toEqual(['code']);
      expect(result.error.issues[0]?.message).toBe(
        'Provide either an authenticator code or a recovery code.',
      );
    }
  });
});

describe('changePasswordSchema', () => {
  it('refuses a change that changes nothing, and says so on the new password field', () => {
    // Every other session is revoked on a password change, so a no-op change is a
    // session reset dressed as a security action — and the user believes they rotated.
    const result = changePasswordSchema.safeParse({
      currentPassword: 'correct horse battery staple',
      newPassword: 'correct horse battery staple',
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');
    expect(result.error.issues[0]?.path).toEqual(['newPassword']);
  });

  it('accepts a genuine change', () => {
    expect(
      changePasswordSchema.safeParse({
        currentPassword: 'correct horse battery staple',
        newPassword: 'a different long password',
      }).success,
    ).toBe(true);
  });

  it('holds the new password to the full policy and the old one to none', () => {
    // `currentPassword` is `min(1)` on purpose: it is checked against a stored hash,
    // not against the policy, and applying the policy to it would lock out anyone
    // whose password predates the current rules.
    expect(
      changePasswordSchema.safeParse({ currentPassword: 'x', newPassword: 'short' }).success,
    ).toBe(false);
    expect(
      changePasswordSchema.safeParse({ currentPassword: 'x', newPassword: 'a'.repeat(12) }).success,
    ).toBe(true);
  });
});

describe('registerSchema', () => {
  it('requires a department, because self-registration inserts a StudentProfile', () => {
    // `StudentProfile.departmentId` is a Restrict FK; a missing one is a 500 at insert
    // time rather than a field-level 422 on the form the user is looking at.
    const body = { email: 'ann@example.com', password: 'a'.repeat(12), name: 'Ann Rafiq' };
    expect(registerSchema.safeParse(body).success).toBe(false);
    expect(
      registerSchema.safeParse({ ...body, departmentId: '01JGXDFAM0K2Z1GYCSNM5F5RCX' }).success,
    ).toBe(true);
  });
});

describe('SESSION_COOKIE', () => {
  it('keeps the __Host- prefix', () => {
    // `__Host-` is what forbids a subdomain from setting the session cookie, and it is
    // spelled in exactly one place. Renaming it without the prefix is a same-site
    // cookie-fixation hole that no test of the auth flow would notice.
    expect(SESSION_COOKIE.startsWith('__Host-')).toBe(true);
  });
});
