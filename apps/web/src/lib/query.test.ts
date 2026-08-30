/**
 * The two things `createQueryClient` decides for the whole app, plus the key space.
 *
 * 1. WHEN NOT TO RETRY. The default exponential backoff turns one 403 into four,
 *    quadruples the audit noise and delays the error UI by ~7s. Nothing else in
 *    the SPA sets `retry`, so this one predicate is the policy.
 *
 * 2. SESSION EVICTION — LESSONS-LEARNED #27, observed in a browser on 2026-08-22.
 *    An admin suspends someone mid-session; the API destroys every session row and
 *    401s their next request. `requireAuth` already knew how to bounce a dead
 *    session, but it reads the session through `ensureQueryData` and that entry was
 *    still cached and still fresh, so the guard kept re-answering with the user it
 *    had been told about before the suspension. The suspended student browsed a
 *    fully-painted dashboard, from cache, issuing no requests at all.
 *
 *    Everything below is the client-side listener that fixed it. Its failure mode
 *    is total silence — no throw, no log, no failed request — so it can only be
 *    caught here or by driving a real revocation in a browser.
 *
 * The key space is tested because a key collision is also silent: two shapes under
 * one slot means whichever writer ran last decides what a reader gets back.
 */
import { describe, expect, it, vi } from 'vitest';
import { type QueryClient } from '@tanstack/react-query';
import { ApiError, type ErrorCode } from './problem.js';
import { createQueryClient, qk } from './query.js';

function apiError(status: number, code: ErrorCode): ApiError {
  return new ApiError({
    type: 'about:blank',
    title: code,
    status,
    code,
    requestId: 'req-test',
  });
}

const SIGNED_IN = { user: { id: '01JGXDFAM0K2Z1GYCSNM5F5RCX', name: 'Ada Okafor' } };

/**
 * A client with a live session and one entry fetched under it, which is the state
 * every eviction assertion needs: `handleSessionLost` is a no-op unless the cache
 * still believes someone is signed in.
 */
function signedInClient(onLost: () => void): QueryClient {
  const client = createQueryClient(onLost);
  client.setQueryData(qk.session, SIGNED_IN);
  client.setQueryData(qk.courses({ page: 1 }), { data: [], meta: { total: 0 } });
  return client;
}

/** Drives one failing query through the QueryCache, which is where onError lives. */
async function failQuery(client: QueryClient, error: ApiError): Promise<void> {
  await client
    .fetchQuery({
      queryKey: qk.announcements(),
      queryFn: () => Promise.reject(error),
      retry: false,
    })
    .catch(() => undefined);
}

describe('retry policy', () => {
  const retry = createQueryClient(vi.fn()).getDefaultOptions().queries?.retry as (
    failureCount: number,
    error: unknown,
  ) => boolean;

  it('never retries a refusal the server has already explained', () => {
    // A 403 is not going to become a 200 on the third attempt. Retrying it writes
    // three more audit rows and keeps the user staring at a spinner.
    // 400 is the LOW end of the 4xx band the predicate carves out (`>= 400`, not
    // `> 400`): the boundary itself has to refuse, or a request answered exactly
    // 400 falls through to the generic retry-twice default below instead.
    expect(retry(0, apiError(400, 'VALIDATION_FAILED'))).toBe(false);
    expect(retry(0, apiError(403, 'FORBIDDEN'))).toBe(false);
    expect(retry(0, apiError(404, 'NOT_FOUND'))).toBe(false);
    expect(retry(0, apiError(422, 'VALIDATION_FAILED'))).toBe(false);
  });

  it('never retries a rate limit, which is the one error retrying makes worse', () => {
    expect(retry(0, apiError(429, 'RATE_LIMITED'))).toBe(false);
  });

  it('retries a server fault and a transport blip, twice and then stops', () => {
    // status 0 is `transportProblem` — the request never reached the server, so
    // there is nothing to have been told and a retry is the right guess.
    // Both attempts of ITS OWN `failureCount < 2` are checked, not just the
    // first: the transport branch returns before the shared `500` line ever
    // runs, so a weakened bound on it (`< 1`) would still pass a suite that
    // only ever calls it at failureCount 0.
    expect(retry(0, apiError(0, 'INTERNAL'))).toBe(true);
    expect(retry(1, apiError(0, 'INTERNAL'))).toBe(true);
    expect(retry(2, apiError(0, 'INTERNAL'))).toBe(false);
    expect(retry(1, apiError(500, 'INTERNAL'))).toBe(true);
    expect(retry(2, apiError(500, 'INTERNAL'))).toBe(false);
  });

  it('retries something that is not an ApiError at all', () => {
    // A TypeError thrown inside a queryFn carries no verdict from the server.
    expect(retry(0, new Error('boom'))).toBe(true);
  });
});

describe('a revoked session evicts the cache it outlived', () => {
  it('drops the identity and everything fetched under it on a 401', async () => {
    const onLost = vi.fn();
    const client = signedInClient(onLost);

    await failQuery(client, apiError(401, 'UNAUTHENTICATED'));

    expect(client.getQueryData(qk.session)).toEqual({ user: null });
    expect(client.getQueryData(qk.courses({ page: 1 }))).toBeUndefined();
    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it('treats a 403 ACCOUNT_SUSPENDED the same, because which arrives is a race', async () => {
    // One suspension can produce either code: the service sets the status AND
    // destroys the session rows, so a request landing after the rows are gone is
    // anonymous (401) and one landing between the two writes is a live session
    // owned by a suspended user (403). Handling only 401 leaves half the race
    // browsing from cache.
    const onLost = vi.fn();
    const client = signedInClient(onLost);

    await failQuery(client, apiError(403, 'ACCOUNT_SUSPENDED'));

    expect(client.getQueryData(qk.session)).toEqual({ user: null });
    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it('leaves an ordinary policy denial alone', async () => {
    // A student opening a teacher-only list gets FORBIDDEN. Signing them out and
    // emptying their cache over it would be a far worse bug than the 403.
    const onLost = vi.fn();
    const client = signedInClient(onLost);

    await failQuery(client, apiError(403, 'FORBIDDEN'));

    expect(client.getQueryData(qk.session)).toEqual(SIGNED_IN);
    expect(client.getQueryData(qk.courses({ page: 1 }))).toBeDefined();
    expect(onLost).not.toHaveBeenCalled();
  });

  it('keeps the session slot itself, so the second 401 cannot re-fire the guard', async () => {
    // The loop guard is `if (!session?.user) return`, and it can only read a
    // `{ user: null }` that is still THERE. Sweeping the session entry away with
    // the rest would make every subsequent failure look like a fresh revocation.
    const onLost = vi.fn();
    const client = signedInClient(onLost);

    await failQuery(client, apiError(401, 'UNAUTHENTICATED'));
    await failQuery(client, apiError(401, 'UNAUTHENTICATED'));

    expect(client.getQueryData(qk.session)).toEqual({ user: null });
    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it('does nothing when nobody was signed in to begin with', async () => {
    const onLost = vi.fn();
    const client = createQueryClient(onLost);

    // An anonymous visitor on a public course page hits a 401 on some authenticated
    // side-fetch. There is no session to lose and no guard to re-run.
    await failQuery(client, apiError(401, 'UNAUTHENTICATED'));

    expect(onLost).not.toHaveBeenCalled();
  });

  it('evicts from a failing MUTATION too, not only a query', async () => {
    // Suspension usually surfaces on a write — saving Settings, posting a comment.
    // The MutationCache needs its own onError; a QueryCache-only listener leaves
    // that path exactly as broken as it was before the fix.
    const onLost = vi.fn();
    const client = signedInClient(onLost);

    const mutation = client.getMutationCache().build<unknown, Error, void, unknown>(client, {
      mutationFn: () => Promise.reject(apiError(401, 'UNAUTHENTICATED')),
    });
    await mutation.execute(undefined).catch(() => undefined);

    expect(client.getQueryData(qk.session)).toEqual({ user: null });
    expect(onLost).toHaveBeenCalledTimes(1);
  });
});

describe('query keys', () => {
  it('gives the notification LIST and the unread COUNT separate slots', () => {
    // These used to share one: `notifications(true)` was read as a filtered list by
    // its type parameter and written as `{ unread: number }` by the mark-read
    // mutation, so the first component to actually request unread rows would have
    // rendered a number as a page.
    expect(qk.notifications(true)).not.toEqual(qk.notificationsUnread);
    // ...while both still start with 'notifications', so a blanket sweep reaches both.
    expect(qk.notificationsUnread[0]).toBe('notifications');
    expect(qk.notifications(true)[0]).toBe('notifications');
  });

  it('puts the archive page in its own segment, so a prefix reaches every page', () => {
    const unfiltered = qk.notifications(true) as unknown[];
    const pageThree = qk.notifications(true, 3) as unknown[];

    // TanStack matches structurally: invalidating the two-element prefix has to
    // reach page 3 without anyone enumerating pages, and the bell's own key must
    // stay exactly the two elements it always was.
    expect(pageThree.slice(0, 2)).toEqual(unfiltered);
    expect(unfiltered).toHaveLength(2);
  });

  it('keys a register by intake AND date, so switching either is a cache miss', () => {
    const courseId = '01JGXDFAM0K2Z1GYCSNM5F5RCX';
    const monday = qk.courseAttendance(courseId, 'intake-a', '2026-03-02');

    // A register is one intake's answer for one day. Dropping either from the key
    // serves Tuesday's marks under Monday's slot — silently, and only for whoever
    // opened the two in the same session.
    expect(monday).not.toEqual(qk.courseAttendance(courseId, 'intake-a', '2026-03-03'));
    expect(monday).not.toEqual(qk.courseAttendance(courseId, 'intake-b', '2026-03-02'));
  });

  it('separates a single row from the list it appears in', () => {
    // `course` beside `courses` is the pattern every detail loader relies on: it
    // must be able to invalidate ONE row without knowing what filters the list was
    // under, and without the list's key accidentally matching it as a prefix.
    expect(qk.course('01JGXDFAM0K2Z1GYCSNM5F5RCX')).not.toEqual(qk.courses());
    expect(qk.resource('01JGXDFAM0K2Z1GYCSNM5F5RCX')[0]).toBe('resources');
    expect(qk.announcement('01JGXDFAM0K2Z1GYCSNM5F5RCX')[0]).toBe('announcements');
    expect(qk.department('01JGXDFAM0K2Z1GYCSNM5F5RCX')[0]).toBe('departments');
  });
});
