/**
 * Phase 9 — scale, rate limiting and observability.
 *
 * Four defects, one file, because the suite shares one database and one app instance
 * and splitting them would mean paying that setup four times for assertions that are
 * each about a handful of rows. What each block is really pinned on:
 *
 *   1. The ranked search path built an `IN ($1, …, $n)` list from the whole visible id
 *      set. Measured against the compose Postgres on 2026-09-28, that shape cannot be
 *      EXECUTED at all past 32,767 candidates:
 *
 *        too many bind variables in prepared statement,
 *        expected maximum of 32767, received 70004
 *
 *      33,000 visible courses is not a large school; it is a school that has run the
 *      same catalogue for four years. The first test below is the proof, not a
 *      benchmark — it fails with that exact error on the old shape and answers 200 on
 *      the new one, and it asserts the RANKED ANSWER rather than merely the absence of
 *      an exception, because a bounded id set that quietly drops rows would pass a
 *      "does not throw" test and break the product.
 *
 *   2. One 300/min per-IP bucket for the API and the fingerprinted SPA assets alike.
 *      A page load is 8 API calls plus 20 assets; the assets were eating the budget the
 *      API answers from. Asserted by bucket, not by total.
 *
 *   3. The user bucket, which is the only one that survives a shared egress address.
 *      Thirty staff behind one NAT is a Tuesday, not an attack.
 *
 *   4. `multipart` allowed 50 MB and the presign path allowed 512 MB per file with no
 *      per-user ceiling at all, so thirty students could fill a bucket. The refusal is
 *      a real 413 with the shared `PAYLOAD_TOO_LARGE` code the SPA already renders.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppInstance } from '../src/app.js';
import { RATE_LIMIT_BUCKETS, classifyBucket } from '../src/plugins/ratelimit.plugin.js';
import { env } from '../src/env.js';
import { hashPassword } from '../src/lib/password.js';
import {
  buildApp,
  cookieHeader,
  createDepartment,
  originHeaders,
  prisma,
  resetDatabase,
  resetRateLimits,
  sessionCookie,
} from './setup.js';

const PASSWORD = 'correct-horse-battery-staple';
const API = '/api/v1';

let app: AppInstance;
let departmentId: string;
let passwordHash: string;
let seq = 0;

beforeAll(async () => {
  app = await buildApp();
  passwordHash = await hashPassword(PASSWORD);
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase();
  await resetRateLimits(app.redis);
  departmentId = await createDepartment();
  seq = 0;
});

// --- helpers ---------------------------------------------------------------

type TestRole = 'STUDENT' | 'TEACHER' | 'ADMIN';

async function createAccount(email: string, role: TestRole, name = 'Test Person'): Promise<string> {
  const user = await prisma.user.create({
    data: { email, name, role, status: 'ACTIVE', passwordHash },
  });
  return user.id;
}

async function login(email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: `${API}/auth/login`,
    headers: { ...originHeaders },
    payload: { email, password: PASSWORD },
  });
  expect(response.statusCode).toBe(200);
  const token = sessionCookie(response);
  expect(token).toBeTruthy();
  return token as string;
}

/**
 * Bulk course fixture. `$executeRawUnsafe` is used HERE and nowhere in `src/`: 33,000
 * `prisma.course.create()` calls would take longer than this file's timeout, and the
 * rows are the same rows either way — a fixture's job is to be cheap, and this one
 * still goes through the real generated `searchVector` column, which is the thing
 * under test. The `searchVector` is NOT written by hand: it is a GENERATED column and
 * Postgres refuses any UPDATE of it (`column "searchVector" can only be updated to
 * DEFAULT`), so the text in `name`/`description` is what builds the index.
 *
 * The id is `cp9course00000001`-shaped rather than a readable word, and that is
 * LESSON-LEARNED #11 arriving on schedule: `idSchema` accepts a cuid or a ULID and
 * nothing else, so a fixture id like `p9-course-1` produces a perfectly ranked,
 * perfectly correct page that serialises as
 * `Response doesn't match the schema: [{"path":["data",0,"id"],"message":"Expected a cuid or a ULID"}]`
 * — a 500 whose stack never mentions search. Two of the first runs of this file failed
 * for that reason and not for the reason they were written to prove.
 */
async function seedPublishedCourses(count: number, term: string): Promise<void> {
  const teacher = await prisma.user.findFirst({ where: { role: 'TEACHER' } });
  if (!teacher) throw new Error('seedPublishedCourses needs a teacher to own the courses');

  await prisma.$executeRawUnsafe(
    `INSERT INTO "Course"
       (id, code, slug, name, description, "teacherId", "departmentId",
        "durationValue", "durationUnit", "createdAt", "updatedAt", "publishedAt")
     SELECT 'cp9course' || lpad(g::text, 8, '0'), 'P9-' || g, 'p9-course-' || g,
            'Course ' || g || ' ' || $1, 'handbook body ' || $1,
            $2, $3, 1, 'MONTH', now(), now(), now()
       FROM generate_series(1, $4) g`,
    term,
    teacher.id,
    departmentId,
    count,
  );
}

// ---------------------------------------------------------------------------
// 1. Ranked search must survive a candidate set the old `IN` list could not
// ---------------------------------------------------------------------------

describe('ranked search over a large candidate set', () => {
  /**
   * 33,000, not 32,767: the old shape's ceiling is 32,767 BIND VARIABLES and the
   * statement spends a few of them on the term and the LIMIT/OFFSET, so the number
   * that actually trips is a little under the protocol limit. 33,000 is comfortably
   * past it and still a two-second fixture.
   */
  const CANDIDATES = 33_000;

  it(`ranks and counts ${CANDIDATES} visible courses instead of failing to plan them`, async () => {
    const teacher = await createAccount('teacher@example.com', 'TEACHER');
    await prisma.teacherProfile.create({
      data: { userId: teacher, departmentId, staffNo: 'T-1', qualification: 'none' },
    });
    await seedPublishedCourses(CANDIDATES, 'welding');

    const response = await app.inject({ method: 'GET', url: `${API}/courses?q=welding&limit=5` });

    // The old shape answers 500 here: `too many bind variables in prepared statement,
    // expected maximum of 32767, received 33007`.
    expect(response.statusCode).toBe(200);

    const body = response.json() as { data: Array<{ name: string }>; meta: { total: number } };
    expect(body.data).toHaveLength(5);
    // Every seeded course carries the term, so the honest answer is "all of them".
    // Asserting the COUNT is what makes this a claim about matching rather than a
    // claim about not throwing: a bounded set that quietly truncated would return 200
    // with five rows and a smaller total.
    expect(body.meta.total).toBe(CANDIDATES);
  });

  it('still matches a partial code the tsvector arm alone cannot see', async () => {
    const teacher = await createAccount('teacher@example.com', 'TEACHER');
    await prisma.teacherProfile.create({
      data: { userId: teacher, departmentId, staffNo: 'T-1', qualification: 'none' },
    });
    const course = await prisma.course.create({
      data: {
        code: 'WELD-2',
        slug: 'weld-2',
        name: 'Advanced Welding',
        description: null,
        teacherId: teacher,
        departmentId,
        durationValue: 2,
        durationUnit: 'MONTH',
        publishedAt: new Date(),
      },
    });

    // `websearch_to_tsquery('english', 'WELD-2')` parses the hyphen as negation
    // syntax and matches nothing — measured fact, recorded in search.sql.ts. If the
    // trigram arm ever goes, this is the assertion that notices.
    const response = await app.inject({ method: 'GET', url: `${API}/courses?q=WELD-2` });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: Array<{ id: string }> };
    expect(body.data.map((row) => row.id)).toEqual([course.id]);
  });

  it('still stems a word that appears only in the description', async () => {
    const teacher = await createAccount('teacher@example.com', 'TEACHER');
    await prisma.teacherProfile.create({
      data: { userId: teacher, departmentId, staffNo: 'T-1', qualification: 'none' },
    });
    const course = await prisma.course.create({
      data: {
        code: 'GEN-1',
        slug: 'gen-1',
        name: 'General Fabrication',
        description: 'Covers welding preparation, joint cleaning and inspection.',
        teacherId: teacher,
        departmentId,
        durationValue: 1,
        durationUnit: 'MONTH',
        publishedAt: new Date(),
      },
    });

    // The term appears NOWHERE in the name or the code, so neither trigram arm can see
    // it: the only thing that can match is the B-weighted description lexeme inside
    // the generated `searchVector`. Removing the vector arm silently halves what this
    // endpoint finds, and nothing else in the file would notice.
    const response = await app.inject({ method: 'GET', url: `${API}/courses?q=welding` });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: Array<{ id: string }> };
    expect(body.data.map((row) => row.id)).toEqual([course.id]);
  });

  it('cross-entity search agrees with the per-entity list on the same fixture', async () => {
    const teacher = await createAccount('teacher@example.com', 'TEACHER');
    await prisma.teacherProfile.create({
      data: { userId: teacher, departmentId, staffNo: 'T-1', qualification: 'none' },
    });
    const course = await prisma.course.create({
      data: {
        code: 'BRAZE-9',
        slug: 'braze-9',
        name: 'Brazing Fundamentals',
        description: null,
        teacherId: teacher,
        departmentId,
        durationValue: 1,
        durationUnit: 'MONTH',
        publishedAt: new Date(),
      },
    });

    const list = await app.inject({ method: 'GET', url: `${API}/courses?q=BRAZE-9` });
    const search = await app.inject({ method: 'GET', url: `${API}/search?q=BRAZE-9` });

    expect(list.statusCode).toBe(200);
    expect(search.statusCode).toBe(200);
    // `GET /search` is a hand-rolled copy of the same ranking, not a call into it.
    // Two implementations of one idea is how the trigram arm quietly survived in one
    // and not the other; asserting the equality is what stops that.
    const searchBody = search.json() as { courses: { hits: Array<{ id: string }>; total: number } };
    expect(searchBody.courses.hits.map((hit) => hit.id)).toEqual([course.id]);
    expect(searchBody.courses.total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2 + 3. Rate limiting: assets are not API traffic, and a session is not an address
// ---------------------------------------------------------------------------

/**
 * The assertions below are about the BUCKET, not about hitting a ceiling.
 *
 * `test/setup.ts` raises every `RATE_LIMIT_*` to 100_000 so an unrelated suite cannot
 * go flaky, so a test that waits for a 429 would either be slow or need a second app
 * built with different environment variables. What is actually worth pinning is which
 * counter a request spends and against what ceiling — and the plugin already publishes
 * exactly that on every response it counted, in `x-ratelimit-limit` and
 * `x-ratelimit-remaining`.
 *
 * Reading those headers rather than inspecting Redis is not only tidier. The suite's
 * Redis is database 1 for every worker (test/setup.ts rewrites the URL to `/1`), and
 * another suite running in parallel calls `resetRateLimits`, which does `KEYS rl:*` and
 * deletes the lot — including keys this test made a moment earlier. Two agents
 * working at once turned these assertions into a coin flip; the headers are per-response
 * and cannot be deleted by anybody.
 */
function limitHeaders(response: { headers: Record<string, unknown> }): {
  limit: number;
  remaining: number;
} {
  const limit = Number(response.headers['x-ratelimit-limit']);
  const remaining = Number(response.headers['x-ratelimit-remaining']);
  expect(Number.isFinite(limit)).toBe(true);
  expect(Number.isFinite(remaining)).toBe(true);
  return { limit, remaining };
}

describe('rate-limit buckets are separate counters', () => {
  it('classifies a served asset separately from an API call, and gives each its own ceiling', () => {
    // The live path cannot prove this one: `@fastify/static` only registers when
    // WEB_DIST_DIR is set, which it is not in the test app, so there is no asset URL to
    // make a request against. The two API buckets below ARE proven through real
    // requests; this proves the classification a browser actually produces.
    const asset = classifyBucket({
      url: '/assets/index-Bq7f2x.js',
      ip: '203.0.113.9',
      userId: 'cuser0000000000000001',
    });
    const api = classifyBucket({
      url: '/api/v1/courses',
      ip: '203.0.113.9',
      userId: 'cuser0000000000000001',
    });

    expect(asset.bucket).toBe('asset:ip');
    expect(api.bucket).toBe('api:user');
    // Same address, same user, same minute — and two different counters. That is the
    // whole claim: on the old shape both requests landed in one `rl:global:<ip>` key,
    // so a cold-cache page load spent the budget the API was answering from.
    expect(asset.key).not.toBe(api.key);
    expect(asset.max).toBeGreaterThan(api.max);
  });

  it('judges an anonymous API call against the address ceiling', async () => {
    const response = await app.inject({ method: 'GET', url: `${API}/courses` });
    expect(response.statusCode).toBe(200);
    // RATE_LIMIT_GLOBAL_MAX. Read from `env` rather than written as a literal, because
    // the value is whatever the operator configured — test/setup.ts raises it to
    // 100_000, the repository `.env` may still carry 300, and an assertion written
    // against either number passes in one environment and fails in the other.
    expect(limitHeaders(response).limit).toBe(env.RATE_LIMIT_GLOBAL_MAX);
  });

  it('judges an authenticated API call against the USER ceiling, not the address one', async () => {
    const email = `student-${seq++}@example.com`;
    await createAccount(email, 'STUDENT');
    const token = await login(email);

    const response = await app.inject({
      method: 'GET',
      url: `${API}/courses`,
      headers: { cookie: cookieHeader(token) },
    });
    expect(response.statusCode).toBe(200);
    // A DIFFERENT ceiling from the anonymous one, and specifically this phase's
    // RATE_LIMIT_API_USER_MAX. If the two ever came back equal, `request.actor` would
    // be read where it is not yet populated and the hook would have moved back to
    // onRequest — the key would be right and the ceiling wrong, which is the failure
    // mode `classifyBucket` being a single function exists to prevent.
    expect(limitHeaders(response).limit).toBe(RATE_LIMIT_BUCKETS.RATE_LIMIT_API_USER_MAX);
    expect(limitHeaders(response).limit).not.toBe(env.RATE_LIMIT_GLOBAL_MAX);
  });

  it('gives two users two counters, so one cannot spend the other one’s budget', async () => {
    const emailA = `a-${seq++}@example.com`;
    const emailB = `b-${seq++}@example.com`;
    await createAccount(emailA, 'STUDENT');
    await createAccount(emailB, 'STUDENT');
    const tokenA = await login(emailA);
    const tokenB = await login(emailB);

    const call = (token: string) =>
      app.inject({
        method: 'GET',
        url: `${API}/courses`,
        headers: { cookie: cookieHeader(token) },
      });

    // The ceiling is read from the FIRST response rather than imported, so this test
    // fails on the old shape for the reason it exists — one shared counter — rather
    // than because a constant this phase introduced was not there yet.
    const first = limitHeaders(await call(tokenA));
    const ceiling = first.limit;
    const second = limitHeaders(await call(tokenA));
    const other = limitHeaders(await call(tokenB));

    // A's counter decrements; B's does not. If all three were keyed on the shared
    // address — the old shape — B comes back at `ceiling - 3` and this fails by two.
    // This is the assertion that makes the fix about IDENTITY rather than about a
    // larger number: thirty staff behind one office NAT is a Tuesday, not an attack,
    // and no amount of raising the ceiling fixes a counter they all share.
    expect(first.remaining).toBe(ceiling - 1);
    expect(second.remaining).toBe(ceiling - 2);
    expect(other.remaining).toBe(ceiling - 1);
  });

  it('leaves the credential endpoints on their own buckets', async () => {
    // The auth routes carry route-level config, so they are never counted against
    // `api:user` or `api:ip`. Asserted on the LIMIT the response advertises, which is
    // the auth route's own ceiling rather than either global one.
    const email = `login-${seq++}@example.com`;
    await createAccount(email, 'STUDENT');
    await login(email);

    const refused = await app.inject({
      method: 'POST',
      url: `${API}/auth/login`,
      headers: { ...originHeaders },
      payload: { email, password: 'wrong-password-entirely' },
    });
    expect(refused.statusCode).toBe(401);
    expect(limitHeaders(refused).limit).toBe(env.RATE_LIMIT_AUTH_IP_MAX);
  });
});

// ---------------------------------------------------------------------------
// 4. Per-user and whole-bucket upload ceilings, refused with a real 413
// ---------------------------------------------------------------------------

const GIB = 1024 * 1024 * 1024;

/** `Upload` rows written straight, with no presign and no bytes — quota accounting only. */
async function seedUploads(ownerId: string, rows: Array<{ key: string; sizeBytes: number }>) {
  await prisma.upload.createMany({
    data: rows.map((row, index) => ({
      id: `p9upload${ownerId.slice(-6)}${String(index).padStart(6, '0')}`,
      key: `seed/${ownerId.slice(-8)}/${row.key}`,
      bucket: 'skillwright-uploads',
      contentType: 'application/pdf',
      sizeBytes: row.sizeBytes,
      originalName: 'seed.pdf',
      status: 'PENDING',
      ownerId,
    })),
  });
}

async function presignPdf(token: string, sizeBytes: number) {
  return app.inject({
    method: 'POST',
    url: `${API}/uploads/presign`,
    headers: { ...originHeaders, cookie: cookieHeader(token) },
    payload: {
      purpose: 'RESOURCE',
      originalName: 'handbook.pdf',
      contentType: 'application/pdf',
      sizeBytes,
    },
  });
}

describe('upload quota', () => {
  it('refuses a presign that would take one account past its byte ceiling, and nobody else', async () => {
    const heavy = `heavy-${seq++}@example.com`;
    const light = `light-${seq++}@example.com`;
    const heavyId = await createAccount(heavy, 'TEACHER');
    await createAccount(light, 'STUDENT');

    // UPLOAD_USER_MAX_BYTES is 2 GiB. Two 1 GiB PENDING rows put this account AT the
    // ceiling, and a PENDING row counts because the signature for its bytes has
    // already been issued — see the function's own comment.
    await seedUploads(heavyId, [
      { key: 'seed/one', sizeBytes: GIB },
      { key: 'seed/two', sizeBytes: GIB },
    ]);

    const heavyToken = await login(heavy);
    const refused = await presignPdf(heavyToken, 1_024);

    expect(refused.statusCode).toBe(413);
    expect(refused.json().code).toBe('PAYLOAD_TOO_LARGE');
    expect(refused.headers['content-type']).toContain('application/problem+json');

    // The ceiling is per ACCOUNT, not global: a second user with nothing stored is
    // unaffected, which is the difference between a quota and a switch.
    const lightToken = await login(light);
    const allowed = await presignPdf(lightToken, 1_024);
    expect(allowed.statusCode).toBe(201);
  });

  it('refuses a presign that would take the whole bucket past its ceiling', async () => {
    // UPLOAD_BUCKET_MAX_BYTES is 50 GiB and UPLOAD_USER_MAX_BYTES is 2 GiB, so 26
    // accounts each sitting exactly on their own ceiling puts the bucket over while
    // leaving every one of them individually entitled. The 27th user is refused for
    // the BUCKET, and the detail says so — a refusal the caller can do nothing about
    // needs to name the thing they cannot do anything about.
    const owners: string[] = [];
    for (let i = 0; i < 26; i += 1) {
      const email = `filler-${i}-${seq++}@example.com`;
      owners.push(await createAccount(email, 'TEACHER'));
    }
    for (const ownerId of owners) {
      await seedUploads(ownerId, [
        { key: 'seed/a', sizeBytes: GIB },
        { key: 'seed/b', sizeBytes: GIB },
      ]);
    }

    const email = `last-${seq++}@example.com`;
    await createAccount(email, 'TEACHER');
    const token = await login(email);

    const refused = await presignPdf(token, 1_024);
    expect(refused.statusCode).toBe(413);
    expect(refused.json().code).toBe('PAYLOAD_TOO_LARGE');
    // `detail` is for developers, not for the SPA — the SPA renders `code` — so this
    // assertion is about the DIAGNOSTIC being specific, not about it being displayed.
    expect(refused.json().detail).toContain('administrator');
  });

  it('refuses an account that is under its byte ceiling but over its file-count ceiling', async () => {
    const email = `rowflood-${seq++}@example.com`;
    const id = await createAccount(email, 'STUDENT');
    // UPLOAD_USER_MAX_FILES is 500. 500 rows of 1 KB is half a megabyte: under the
    // byte ceiling by four orders of magnitude, and still a flood. This is the case
    // that makes the second knob a separate decision rather than a smaller version of
    // the first.
    await seedUploads(
      id,
      Array.from({ length: 500 }, (_, i) => ({ key: `seed/row-${i}`, sizeBytes: 1024 })),
    );

    const token = await login(email);
    const refused = await presignPdf(token, 1_024);
    expect(refused.statusCode).toBe(413);
    expect(refused.json().code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('leaves an account well under every ceiling completely alone', async () => {
    const email = `ordinary-${seq++}@example.com`;
    const id = await createAccount(email, 'TEACHER');
    await seedUploads(id, [{ key: 'seed/one', sizeBytes: 12_345 }]);
    const token = await login(email);

    const response = await presignPdf(token, 1_024);
    expect(response.statusCode).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// 5. One request id, end to end
// ---------------------------------------------------------------------------

describe('a request can be followed end to end', () => {
  it('carries one id through the response header, the problem body and the audit trail', async () => {
    const email = `audited-${seq++}@example.com`;
    const id = await createAccount(email, 'ADMIN');
    const token = await login(email);

    // 1. A WRITE, so the audit extension has something to stamp. `Department` is in
    //    AUDITED_MODELS, and the extension reads the requestId from the ambient
    //    context rather than from any argument — so the id on the row is the SAME id
    //    the response carried, with nothing threading it through.
    const created = await app.inject({
      method: 'POST',
      url: `${API}/departments`,
      headers: { ...originHeaders, cookie: cookieHeader(token) },
      payload: { name: 'Fabrication', slug: 'fabrication' },
    });
    expect(created.statusCode).toBe(201);
    const writeId = created.headers['x-request-id'] as string;
    expect(writeId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/i);

    const audit = await prisma.auditEvent.findFirst({
      where: { actorId: id, entityId: created.json().id },
      orderBy: { createdAt: 'desc' },
      select: { requestId: true, action: true },
    });
    expect(audit).not.toBeNull();
    expect(audit!.requestId).toBe(writeId);

    // 2. A REFUSAL, so the problem+json body exists. A refused write produces no audit
    //    row — the row is the record of what HAPPENED, and nothing happened — which is
    //    why the two halves are two requests. Both carry the same kind of id, from the
    //    same `onRequest` hook, and the failure mode this guards is a request whose id
    //    appears on the wire but not in the log, or in the log but not on the wire.
    const refused = await app.inject({
      method: 'POST',
      url: `${API}/departments`,
      headers: { ...originHeaders, cookie: cookieHeader(token) },
      payload: { name: 'Also Fabrication', slug: 'fabrication' },
    });
    expect(refused.statusCode).toBe(409);
    const refuseId = refused.headers['x-request-id'] as string;
    expect(refused.json().requestId).toBe(refuseId);
    expect(refuseId).not.toBe(writeId);
  });

  it('establishes the request context for a path that matches no route at all', async () => {
    const response = await app.inject({ method: 'GET', url: '/no-such-path' });
    expect(response.statusCode).toBe(404);
    // A 404 is the failure mode an operator sees most and correlates least, because
    // there is no route to attribute it to. The context is still established, so the
    // id is on the wire and in the completion line.
    expect(response.headers['x-request-id']).toBeTruthy();
    expect(response.json().requestId).toBe(response.headers['x-request-id']);
  });
});
