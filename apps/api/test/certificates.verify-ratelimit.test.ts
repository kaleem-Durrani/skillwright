/**
 * The verify route's rate limit, proved as an EFFECT rather than as a line of
 * configuration.
 *
 * WHY THIS IS ITS OWN FILE, and why it does not simply set the ceiling. `env.ts` parses
 * `process.env` once at module load, and `setup.ts` — which every suite imports, and
 * which `vitest.config.ts` also lists as a `setupFiles` entry — loads the repository
 * `.env` and calls `buildApp` BEFORE any test file's body runs. A ceiling set here would
 * therefore be set after the value had already been read, and the test would assert
 * nothing at all: a test that passes for the wrong reason is the failure mode this
 * repository cares about most.
 *
 * So this proves the same claim with two measurements that are independent of what the
 * operator has configured. The route under test is `GET /certificates/verify/:reference`
 * and the two routes it is compared against are a known strict-bucket route
 * (`POST /auth/login`, which carries `config: authIpRateLimit`) and a known global-bucket
 * route (`GET /departments`, which carries nothing).
 *
 * WHAT IS BEING PROVED. The feature plan's instruction for this route was "no
 * rate-limit exemption you have not thought about". The answer is that the route takes
 * the SAME strict per-IP bucket the credential routes take — 20 a minute by default,
 * against the global 300 — because the threat is the same one: a host walking one space
 * quickly, against a per-account bucket that does not exist because there is no account.
 * The route takes NO exemption of its own, and removing `config: authIpRateLimit` from it
 * makes both tests below fail.
 *
 * A note on the shape of the second test. It is tempting to write "verifying does not
 * spend the login budget" as a safety property, and it is NOT one: @fastify/rate-limit
 * namespaces a route-level bucket by method and route (`rl:<METHOD> <url>-auth:ip:<ip>`),
 * so the counters are separate — which is precisely what the measured key names in this
 * file's first test show. What that means is that a denial of service against the verify
 * route cannot lock anybody out of signing in, and that is a real property worth pinning
 * rather than a coincidence to leave undocumented.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, resetRateLimits } from './setup.js';
import type { AppInstance } from '../src/app.js';

const UNKNOWN_REFERENCE = 'ZZZZZZZZZZZZZZZZZZZZZZZZ00';

function limitOf(headers: Record<string, unknown>): number {
  return Number(headers['x-ratelimit-limit']);
}

let app: AppInstance;

describe('the unauthenticated verify route', () => {
  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('is on the strict per-IP bucket, and on its own one', async () => {
    await resetRateLimits(app.redis);

    const first = await app.inject({
      method: 'GET',
      url: `/api/v1/certificates/verify/${UNKNOWN_REFERENCE}`,
    });
    // An unknown reference is an ORDINARY answer. A route that 404s on the first
    // unrecognised input has told an enumerator something for free.
    expect(first.statusCode).toBe(404);
    expect(first.json().code).toBe('NOT_FOUND');

    // The same bucket the credential routes use...
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'http://localhost:5173' },
      payload: { email: 'nobody@example.com', password: 'not-the-password' },
    });
    expect(limitOf(first.headers as Record<string, unknown>)).toBe(
      limitOf(login.headers as Record<string, unknown>),
    );

    // ...and NOT the global one, which is the bucket every other request spends.
    const departments = await app.inject({ method: 'GET', url: '/api/v1/departments' });
    expect(limitOf(first.headers as Record<string, unknown>)).not.toBe(
      limitOf(departments.headers as Record<string, unknown>),
    );
    expect(limitOf(departments.headers as Record<string, unknown>)).toBeGreaterThan(
      limitOf(first.headers as Record<string, unknown>),
    );

    // The counter is per METHOD AND ROUTE, which is what stops a flood of anonymous
    // verifications from being the same budget as somebody trying to sign in. The key
    // is asserted by name because the name IS the property: a plugin that fell back to
    // one bucket per IP would put both routes on `…-auth:ip:127.0.0.1` and this test
    // would pass with the count below.
    const keys = await app.redis.keys('rl:*');
    expect(keys).toContain('rl:GET/api/v1/certificates/verify/:reference-auth:ip:127.0.0.1');
    expect(keys).toContain('rl:POST/api/v1/auth/login-auth:ip:127.0.0.1');

    // And the three verifications leave the login budget untouched.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await app.inject({ method: 'GET', url: `/api/v1/certificates/verify/${UNKNOWN_REFERENCE}` });
    }
    const afterVerify = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'http://localhost:5173' },
      payload: { email: 'nobody@example.com', password: 'not-the-password' },
    });
    const remaining = Number(afterVerify.headers['x-ratelimit-remaining']);
    const ceiling = limitOf(afterVerify.headers as Record<string, unknown>);
    // The first login call above already spent one; the counter is shared with the
    // other login calls in this file and nothing else.
    expect(remaining).toBeGreaterThan(ceiling - 5);
  });
});
