import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as OTPAuth from 'otpauth';
import { BRAND } from '@skillwright/shared';
import {
  buildApp,
  cookieHeader,
  createDepartment,
  originHeaders,
  prisma,
  resetDatabase,
  resetRateLimits,
  sessionCookie,
  testOutbox,
} from './setup.js';

const PASSWORD = 'correct-horse-battery-staple';
const NEW_PASSWORD = 'a-completely-different-passphrase';

let app: FastifyInstance;
let departmentId: string;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase();
  await resetRateLimits(app.redis);
  departmentId = await createDepartment();
});

afterEach(() => {
  vi.useRealTimers();
});

// --- helpers ---------------------------------------------------------------

function post(url: string, payload: unknown, cookie?: string) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/auth${url}`,
    headers: { ...originHeaders, ...(cookie ? { cookie: cookieHeader(cookie) } : {}) },
    payload: payload as Record<string, unknown>,
  });
}

function del(url: string, payload: unknown, cookie?: string) {
  return app.inject({
    method: 'DELETE',
    url: `/api/v1/auth${url}`,
    headers: { ...originHeaders, ...(cookie ? { cookie: cookieHeader(cookie) } : {}) },
    payload: payload as Record<string, unknown>,
  });
}

function me(cookie?: string) {
  return app.inject({
    method: 'GET',
    url: '/api/v1/auth/me',
    headers: cookie ? { cookie: cookieHeader(cookie) } : {},
  });
}

function register(email: string, password = PASSWORD) {
  return post('/register', { email, password, name: 'Test Person', departmentId });
}

async function registerAndVerify(email: string, password = PASSWORD): Promise<void> {
  expect((await register(email, password)).statusCode).toBe(202);

  const code = testOutbox.lastCodeFor(email);
  expect(code).toMatch(/^\d{6}$/);
  expect((await post('/verify-email', { email, code })).statusCode).toBe(200);
}

async function loginOk(email: string, password = PASSWORD): Promise<string> {
  const response = await post('/login', { email, password });
  expect(response.statusCode).toBe(200);
  expect(response.json().status).toBe('AUTHENTICATED');
  const token = sessionCookie(response);
  expect(token).toBeTruthy();
  return token as string;
}

// --- tests -----------------------------------------------------------------

describe('health', () => {
  it('reports process liveness and downstream readiness separately', async () => {
    const healthz = await app.inject({ method: 'GET', url: '/healthz' });
    expect(healthz.statusCode).toBe(200);
    expect(healthz.json()).toMatchObject({ status: 'ok' });

    const readyz = await app.inject({ method: 'GET', url: '/readyz' });
    expect(readyz.statusCode).toBe(200);
    expect(readyz.json()).toMatchObject({ checks: { database: 'ok', redis: 'ok' } });
  });
});

describe('account lifecycle', () => {
  it('walks register -> verify -> login -> forgot -> reset', async () => {
    const email = 'lifecycle@example.com';

    expect((await register(email)).statusCode).toBe(202);

    const created = await prisma.user.findFirstOrThrow({
      where: { email },
      include: { studentProfile: true },
    });
    expect(created.status).toBe('PENDING_VERIFICATION');
    expect(created.role).toBe('STUDENT');
    expect(created.passwordHash).toMatch(/^\$argon2id\$/);
    expect(created.studentProfile?.departmentId).toBe(departmentId);

    // An unverified account cannot log in, and is told exactly that.
    const blocked = await post('/login', { email, password: PASSWORD });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().code).toBe('EMAIL_NOT_VERIFIED');

    const verifyCode = testOutbox.lastCodeFor(email);
    expect((await post('/verify-email', { email, code: verifyCode })).statusCode).toBe(200);
    expect((await prisma.user.findFirstOrThrow({ where: { email } })).status).toBe('ACTIVE');

    const token = await loginOk(email);
    const profile = await me(token);
    expect(profile.statusCode).toBe(200);
    expect(profile.json()).toMatchObject({
      actor: { role: 'STUDENT', status: 'ACTIVE', provenance: 'PASSWORD' },
      user: { email, role: 'STUDENT', mfaEnabled: false },
    });
    expect(JSON.stringify(profile.json())).not.toContain('argon2');

    expect((await post('/forgot-password', { email })).statusCode).toBe(202);

    const resetCode = testOutbox.lastCodeFor(email);
    expect(resetCode).toMatch(/^\d{6}$/);

    const reset = await post('/reset-password', { email, code: resetCode, password: NEW_PASSWORD });
    expect(reset.statusCode).toBe(200);

    expect((await post('/login', { email, password: PASSWORD })).statusCode).toBe(401);
    await loginOk(email, NEW_PASSWORD);
  });

  it('kills every existing session when the password is reset', async () => {
    const email = 'revoked@example.com';
    await registerAndVerify(email);
    const token = await loginOk(email);
    expect((await me(token)).statusCode).toBe(200);

    await post('/forgot-password', { email });
    const code = testOutbox.lastCodeFor(email);
    expect(
      (await post('/reset-password', { email, code, password: NEW_PASSWORD })).statusCode,
    ).toBe(200);

    // The cookie an attacker may already hold is worthless the instant the reset lands.
    const afterReset = await me(token);
    expect(afterReset.statusCode).toBe(401);
    expect(afterReset.json().code).toBe('UNAUTHENTICATED');
    expect(await prisma.session.count()).toBe(0);
  });

  it('logout-all revokes sessions issued to other devices', async () => {
    const email = 'many-devices@example.com';
    await registerAndVerify(email);
    const first = await loginOk(email);
    const second = await loginOk(email);

    const response = await post('/logout-all', {}, second);
    expect(response.statusCode).toBe(200);
    expect(response.json().revoked).toBe(2);

    expect((await me(first)).statusCode).toBe(401);
    expect((await me(second)).statusCode).toBe(401);
  });
});

describe('user enumeration', () => {
  it('answers register identically for a free and a taken address', async () => {
    const taken = 'taken@example.com';
    await registerAndVerify(taken);

    const onTaken = await register(taken);
    const onFree = await register('free@example.com');

    expect(onTaken.statusCode).toBe(onFree.statusCode);
    expect(onTaken.json()).toEqual(onFree.json());
    expect(await prisma.user.count({ where: { email: taken } })).toBe(1);
  });

  it('answers forgot-password identically for a known and an unknown address', async () => {
    const known = 'known@example.com';
    await registerAndVerify(known);

    const onKnown = await post('/forgot-password', { email: known });
    const onUnknown = await post('/forgot-password', { email: 'ghost@example.com' });

    expect(onKnown.statusCode).toBe(onUnknown.statusCode);
    expect(onKnown.json()).toEqual(onUnknown.json());
  });

  it('answers resend-verification identically for a known and an unknown address', async () => {
    const known = 'pending@example.com';
    await register(known);

    const onKnown = await post('/resend-verification', { email: known });
    const onUnknown = await post('/resend-verification', { email: 'nobody@example.com' });

    expect(onKnown.statusCode).toBe(onUnknown.statusCode);
    expect(onKnown.json()).toEqual(onUnknown.json());
  });

  it('rejects a wrong password and an unknown account with the same answer', async () => {
    const email = 'real@example.com';
    await registerAndVerify(email);

    const wrongPassword = await post('/login', { email, password: 'not-the-right-password' });
    const noSuchUser = await post('/login', {
      email: 'absent@example.com',
      password: 'not-the-right-password',
    });

    expect(wrongPassword.statusCode).toBe(401);
    expect(noSuchUser.statusCode).toBe(401);
    expect(wrongPassword.json().detail).toBe(noSuchUser.json().detail);
  });
});

describe('verification codes', () => {
  it('locks the code out after five wrong attempts and burns it', async () => {
    const email = 'lockout@example.com';
    await register(email);
    const realCode = testOutbox.lastCodeFor(email) as string;
    const wrongCode = realCode === '000000' ? '111111' : '000000';

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      statuses.push((await post('/verify-email', { email, code: wrongCode })).statusCode);
    }

    expect(statuses.slice(0, 4)).toEqual([422, 422, 422, 422]);
    expect(statuses[4]).toBe(429);

    // Burned: even the genuine code is dead once the budget is spent.
    expect((await post('/verify-email', { email, code: realCode })).statusCode).toBe(422);
    expect((await prisma.user.findFirstOrThrow({ where: { email } })).status).toBe(
      'PENDING_VERIFICATION',
    );
  });

  it('refuses to send a second code inside the resend cooldown', async () => {
    const email = 'cooldown@example.com';
    await register(email);
    const first = testOutbox.lastCodeFor(email);

    expect((await post('/resend-verification', { email })).statusCode).toBe(202);
    // Same code, because the send path — not the route — refused to mint a new one.
    expect(testOutbox.lastCodeFor(email)).toBe(first);
  });
});

describe('csrf', () => {
  it('refuses a state-changing request from a foreign origin', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'https://evil.example' },
      payload: { email: 'someone@example.com', password: PASSWORD },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
    expect(response.headers['content-type']).toContain('application/problem+json');
  });

  it('refuses a state-changing request with no origin at all', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'someone@example.com', password: PASSWORD },
    });
    expect(response.statusCode).toBe(403);
  });

  it('never puts a stack trace in the problem document', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'https://evil.example' },
      payload: { email: 'someone@example.com', password: PASSWORD },
    });
    const body = response.json();
    expect(body).not.toHaveProperty('stack');
    expect(JSON.stringify(body)).not.toContain('at Object.');
    expect(body.requestId).toEqual(expect.any(String));
  });
});

describe('totp', () => {
  it('enrols, activates, gates a login, and disables again', async () => {
    const email = 'totp@example.com';
    await registerAndVerify(email);
    let token = await loginOk(email);

    const base = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(base);

    // --- enrol: a secret exists but nothing is enforced yet ---
    const enrolled = await post('/mfa/enroll', {}, token);
    expect(enrolled.statusCode).toBe(200);
    const { secret, otpauthUri, qrDataUrl } = enrolled.json();
    expect(otpauthUri.startsWith('otpauth://totp/')).toBe(true);
    expect(qrDataUrl.startsWith('data:image/png;base64,')).toBe(true);

    const stored = await prisma.user.findFirstOrThrow({ where: { email } });
    expect(stored.totpSecret).toBeTruthy();
    // The column holds ciphertext, never the shared secret itself.
    expect(stored.totpSecret).not.toContain(secret);
    expect(stored.totpEnabledAt).toBeNull();

    const totp = new OTPAuth.TOTP({
      issuer: BRAND.name,
      label: email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    });

    // --- activate: one proved code turns it on and yields the recovery codes once ---
    const activated = await post('/mfa/activate', { code: totp.generate() }, token);
    expect(activated.statusCode).toBe(200);
    const recoveryCodes: string[] = activated.json().recoveryCodes;
    expect(recoveryCodes).toHaveLength(10);
    expect(await prisma.recoveryCode.count({ where: { user: { email } } })).toBe(10);
    expect((await prisma.user.findFirstOrThrow({ where: { email } })).totpEnabledAt).not.toBeNull();

    // --- login is now a two-stage affair ---
    expect((await post('/logout', {}, token)).statusCode).toBe(204);

    const staged = await post('/login', { email, password: PASSWORD });
    expect(staged.statusCode).toBe(200);
    expect(staged.json().status).toBe('MFA_REQUIRED');
    expect(staged.json().actor.provenance).toBe('MFA_PENDING');
    const pending = sessionCookie(staged) as string;
    expect((await me(pending)).json().actor.provenance).toBe('MFA_PENDING');

    vi.setSystemTime(base + 30_000);

    const verified = await post('/mfa/verify', { code: totp.generate() }, pending);
    expect(verified.statusCode).toBe(200);
    token = sessionCookie(verified) as string;
    expect(token).not.toBe(pending);
    expect((await me(token)).json().actor.provenance).toBe('PASSWORD');
    // The pre-authentication identifier is dead: no session fixation.
    expect((await me(pending)).statusCode).toBe(401);

    // --- a recovery code also completes the second stage, exactly once ---
    expect((await post('/logout', {}, token)).statusCode).toBe(204);
    const staged2 = await post('/login', { email, password: PASSWORD });
    const pending2 = sessionCookie(staged2) as string;
    const byRecovery = await post('/mfa/verify', { recoveryCode: recoveryCodes[0] }, pending2);
    expect(byRecovery.statusCode).toBe(200);
    token = sessionCookie(byRecovery) as string;

    expect((await post('/logout', {}, token)).statusCode).toBe(204);
    const staged3 = await post('/login', { email, password: PASSWORD });
    const pending3 = sessionCookie(staged3) as string;
    expect(
      (await post('/mfa/verify', { recoveryCode: recoveryCodes[0] }, pending3)).statusCode,
    ).toBe(401);

    vi.setSystemTime(base + 60_000);
    const finished = await post('/mfa/verify', { code: totp.generate() }, pending3);
    expect(finished.statusCode).toBe(200);
    token = sessionCookie(finished) as string;

    // --- replaying that same code inside its own window is refused ---
    const replay = await post('/login', { email, password: PASSWORD });
    const pendingReplay = sessionCookie(replay) as string;
    expect((await post('/mfa/verify', { code: totp.generate() }, pendingReplay)).statusCode).toBe(
      401,
    );

    // --- disabling demands the password AND a live code ---
    vi.setSystemTime(base + 90_000);
    expect(
      (await del('/mfa', { password: 'nope-nope-nope', code: totp.generate() }, token)).statusCode,
    ).toBe(401);
    expect(
      (await del('/mfa', { password: PASSWORD, code: totp.generate() }, token)).statusCode,
    ).toBe(204);

    const after = await prisma.user.findFirstOrThrow({ where: { email } });
    expect(after.totpEnabledAt).toBeNull();
    expect(after.totpSecret).toBeNull();
    expect(await prisma.recoveryCode.count({ where: { userId: after.id } })).toBe(0);

    vi.useRealTimers();

    // And login is single-stage again.
    expect((await post('/login', { email, password: PASSWORD })).json().status).toBe(
      'AUTHENTICATED',
    );
  });

  it('refuses to activate with a code the authenticator never produced', async () => {
    const email = 'totp-bad@example.com';
    await registerAndVerify(email);
    const token = await loginOk(email);

    expect((await post('/mfa/enroll', {}, token)).statusCode).toBe(200);
    expect((await post('/mfa/activate', { code: '000000' }, token)).statusCode).toBe(422);
    expect((await prisma.user.findFirstOrThrow({ where: { email } })).totpEnabledAt).toBeNull();
  });
});

describe('demo login', () => {
  it('issues a DEMO session while the flag is on', async () => {
    const response = await post('/demo', { role: 'STUDENT' });
    expect(response.statusCode).toBe(200);
    expect(response.json().actor.provenance).toBe('DEMO');
    const token = sessionCookie(response) as string;
    expect((await me(token)).json().actor.provenance).toBe('DEMO');
  });
});
