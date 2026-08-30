/**
 * The request the SPA actually puts on the wire, and the error it hands back.
 *
 * Everything else in this app mocks `@/lib/api`, which is right — but it means
 * this module is the one place where nothing checks the wire format. The gap that
 * matters is the one LESSONS-LEARNED #20 describes: a defect that lives between
 * two well-tested components, in the wiring neither one's tests cover. `fetch` is
 * stubbed here and nothing else is, so what is asserted is exactly the URL, the
 * init object and the thrown error.
 *
 * Three of these are load-bearing beyond this file:
 *
 * - The synthesised code for a NON-JSON error response. `query.ts` evicts a dead
 *   session by matching `error.code`, so a 401 that arrives as a proxy's HTML page
 *   has to still come out `UNAUTHENTICATED` or revocation stops working for
 *   precisely the deployments that sit behind a proxy.
 * - Dropping empty-string query values. An empty filter must not travel; a `0` or
 *   a `false` must.
 * - `apiUrl` and `request` sharing one builder. The download anchors navigate to
 *   `apiUrl(...)` while every other call fetches; two builders would drift and the
 *   only symptom would be broken downloads.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_BASE, api, apiUrl } from './api.js';
import { ApiError } from './problem.js';

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** The URL the last call was made against. */
function calledUrl(): string {
  return String(fetchMock.mock.calls.at(-1)?.[0]);
}

/** The init object the last call was made with. */
function calledInit(): RequestInit {
  return fetchMock.mock.calls.at(-1)?.[1] ?? {};
}

function calledHeaders(): Record<string, string> {
  return (calledInit().headers ?? {}) as Record<string, string>;
}

beforeEach(() => {
  fetchMock.mockReset();
  // A fresh Response per call, never one shared instance: a body may only be read
  // once, so a reused Response makes the second assertion in any test fail with
  // "Body has already been read" rather than with what it was checking.
  fetchMock.mockImplementation(async () => json({ ok: true }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('URL building', () => {
  it('serves the API from the same origin as the SPA', () => {
    // Single-origin is what makes `credentials: 'include'` sufficient and why no
    // CORS preflight ever happens. An absolute default here would be a silent
    // switch to cross-origin, where the __Host- cookie stops being sent.
    expect(API_BASE).toBe('/api/v1');
  });

  it('prefixes the base and tolerates a path written without a leading slash', async () => {
    await api.get('/courses');
    expect(calledUrl()).toBe(`${API_BASE}/courses`);

    await api.get('courses');
    expect(calledUrl()).toBe(`${API_BASE}/courses`);
  });

  it('drops empty query values and keeps falsy ones that mean something', async () => {
    await api.get('/courses', {
      query: { q: '', status: undefined, departmentId: null, page: 0, archived: false },
    });

    // '' is an untouched filter box, not a filter for the empty string — sending it
    // is how a search screen asks the API for rows whose title is ''. `0` and
    // `false` are real values and have to survive.
    expect(calledUrl()).toBe(`${API_BASE}/courses?page=0&archived=false`);
  });

  it('encodes values rather than pasting them into the string', async () => {
    await api.get('/search', { query: { q: 'welding & fabrication' } });

    expect(calledUrl()).toBe(`${API_BASE}/search?q=welding+%26+fabrication`);
  });

  it('omits the question mark entirely when every value was dropped', async () => {
    await api.get('/courses', { query: { q: undefined } });

    expect(calledUrl()).toBe(`${API_BASE}/courses`);
  });

  it('builds a download anchor href identically to a fetched URL', async () => {
    // The anchors are a plain browser navigation, not a fetch, so nothing else
    // compares the two. They have to agree or downloads 404 while the app works.
    await api.get('/resources/abc/download', { query: { disposition: 'attachment' } });

    expect(apiUrl('/resources/abc/download', { disposition: 'attachment' })).toBe(calledUrl());
  });
});

describe('request init', () => {
  it('sends the session cookie and asks for both JSON dialects', async () => {
    await api.get('/auth/me');

    expect(calledInit().credentials).toBe('include');
    expect(calledHeaders().Accept).toBe('application/json, application/problem+json');
  });

  it('declares a JSON body only when there is one', async () => {
    await api.get('/courses');
    expect(calledHeaders()['Content-Type']).toBeUndefined();

    // `useLogout` posts with no body at all, which is why the API's bodyless POST
    // schemas are `.nullish()` (LESSONS-LEARNED #12/#24). Announcing a JSON body
    // that is not there would be a lie a stricter server is entitled to reject.
    await api.post('/auth/logout');
    expect(calledHeaders()['Content-Type']).toBeUndefined();
    expect(calledInit().body).toBeUndefined();

    await api.post('/auth/login', { email: 'ada@example.edu' });
    expect(calledHeaders()['Content-Type']).toBe('application/json');
    expect(calledInit().body).toBe('{"email":"ada@example.edu"}');
  });

  it('lets a caller add headers without losing the defaults', async () => {
    await api.patch('/users/me', { name: 'Ada' }, { headers: { 'x-idempotency-key': 'k1' } });

    expect(calledHeaders()['x-idempotency-key']).toBe('k1');
    expect(calledHeaders().Accept).toBe('application/json, application/problem+json');
  });

  it('forwards the abort signal, and only when one was given', async () => {
    const controller = new AbortController();
    await api.get('/auth/me', { signal: controller.signal });
    expect(calledInit().signal).toBe(controller.signal);

    await api.get('/auth/me');
    expect('signal' in calledInit()).toBe(false);
  });

  it('sends the method it was asked for', async () => {
    await api.del('/resources/abc');
    expect(calledInit().method).toBe('DELETE');

    await api.put('/uploads/abc', { key: 'v' });
    expect(calledInit().method).toBe('PUT');
  });
});

describe('reading a successful response', () => {
  it('returns undefined for a 204 rather than choking on an empty body', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(api.del('/resources/abc')).resolves.toBeUndefined();
  });

  it('returns undefined for a 200 that declares zero bytes', async () => {
    fetchMock.mockResolvedValue(
      new Response('', { status: 200, headers: { 'content-length': '0' } }),
    );

    await expect(api.post('/auth/logout')).resolves.toBeUndefined();
  });

  it('returns text when the server did not send JSON', async () => {
    // The attendance register exports CSV through this client.
    fetchMock.mockResolvedValue(
      new Response('name,present\nAda,1\n', {
        status: 200,
        headers: { 'content-type': 'text/csv; charset=utf-8' },
      }),
    );

    await expect(api.get<string>('/courses/abc/register.csv')).resolves.toBe(
      'name,present\nAda,1\n',
    );
  });

  it('parses a JSON body', async () => {
    fetchMock.mockResolvedValue(json({ data: [{ id: 'a' }] }));

    await expect(api.get('/courses')).resolves.toEqual({ data: [{ id: 'a' }] });
  });
});

describe('reading a failure', () => {
  it('carries the problem envelope through verbatim', async () => {
    fetchMock.mockResolvedValue(
      json(
        {
          type: 'about:blank',
          title: 'Validation failed',
          status: 422,
          code: 'VALIDATION_FAILED',
          detail: 'phoneNumber: Expected string, received null',
          errors: [{ path: 'phoneNumber', message: 'Enter a phone number' }],
          requestId: 'req-42',
        },
        422,
      ),
    );

    const error = await api.patch('/users/me', {}).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.code).toBe('VALIDATION_FAILED');
    expect(apiError.status).toBe(422);
    expect(apiError.requestId).toBe('req-42');
    // The field errors are what react-hook-form's `setError` is fed from; losing
    // them turns a per-field message into one generic banner.
    expect(apiError.byField).toEqual({ phoneNumber: 'Enter a phone number' });
  });

  it('still says UNAUTHENTICATED when a 401 arrives as an HTML page', async () => {
    // A reverse proxy or a session middleware can answer 401 with anything at all.
    // `query.ts` evicts the dead session by matching this CODE, so mapping a bare
    // 401 to INTERNAL would leave a suspended user browsing from cache — the exact
    // failure LESSONS-LEARNED #27 is about, reintroduced one layer down.
    fetchMock.mockResolvedValue(
      new Response('<html>401</html>', {
        status: 401,
        headers: { 'content-type': 'text/html', 'x-request-id': 'req-proxy' },
      }),
    );

    const error = (await api.get('/auth/me').catch((cause: unknown) => cause)) as ApiError;

    expect(error.code).toBe('UNAUTHENTICATED');
    expect(error.requestId).toBe('req-proxy');
  });

  it('falls back to INTERNAL, and to a placeholder request id, for anything else', async () => {
    fetchMock.mockResolvedValue(new Response('gateway down', { status: 502 }));

    const error = (await api.get('/courses').catch((cause: unknown) => cause)) as ApiError;

    expect(error.code).toBe('INTERNAL');
    expect(error.status).toBe(502);
    // Never undefined: the id is rendered in the error UI so a user can quote it.
    expect(error.requestId).toBe('unknown');
  });

  it('wraps a request that never left the machine as a status-0 transport error', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const error = (await api.get('/courses').catch((cause: unknown) => cause)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    // status 0 is what `query.ts`'s retry predicate recognises as "worth trying
    // again"; any 4xx-shaped status here would make an offline blip permanent.
    expect(error.status).toBe(0);
    expect(error.message).toBe('Failed to fetch');
  });

  it('re-throws an abort untouched instead of dressing it as a failure', async () => {
    // Every navigation cancels in-flight queries. Wrapping those in ApiError would
    // raise an error toast for each one, on a perfectly healthy app.
    const aborted = new DOMException('The operation was aborted.', 'AbortError');
    fetchMock.mockRejectedValue(aborted);

    await expect(api.get('/courses')).rejects.toBe(aborted);
  });
});
