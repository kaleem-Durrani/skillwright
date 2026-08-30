/**
 * The client half of the permission system.
 *
 * This file exists for one reason: a `can()` that receives no subject, or a
 * subject of the wrong SHAPE, denies — silently, identically, and for everyone.
 * Nothing throws, nothing logs, and the type system is perfectly happy, because
 * every field of `Subject` is optional by design. Both recorded incidents are
 * that failure wearing different clothes:
 *
 * - LESSONS-LEARNED #15: a screen gated a query on `can('conversation:read')`
 *   with no subject. `isParticipant` reads `subject.participantIds`, so the answer
 *   was always false; used as React Query's `enabled:` that is an OFF SWITCH, and
 *   a disabled query in v5 stays `status: 'pending'`, so the skeleton rendered
 *   forever. No request was ever made — there was nothing to see in the network
 *   tab, and it affected admins too.
 * - LESSONS-LEARNED #31: the same screen one step along, passing a COURSE where a
 *   resource was wanted. `resource:read`'s public branch reads `isPublic`, which a
 *   course does not have — it has `publishedAt` — so that disjunct could never
 *   fire whatever the data said. Harder to see than a missing subject, because the
 *   call site looks correct.
 *
 * The tests below are written as PAIRS: the same actor and action, denied with the
 * wrong subject and allowed with the right one. A denial on its own proves
 * nothing here — everything denies.
 */
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MAX_PAGE_SIZE } from '@skillwright/shared/schema';
import type { Action } from '@skillwright/shared/policy';

type ApiFetch = (path: string, options?: unknown) => Promise<unknown>;

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn<ApiFetch>() }));

vi.mock('./api.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, api: { ...(actual.api as object), get: apiGet } };
});

// Imported after the mock so the enrollments lookup resolves the stub.
import { qk } from './query.js';
import type { SessionUser } from './session.js';
import { subject, useAllowedItems, useCan, useCompletedCourseIds, usePolicy } from './policy.js';

const VIEWER_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCX';
const OTHER_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCY';
const COURSE_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCZ';
const TEACHER_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD0';

function viewer(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: VIEWER_ID,
    email: 'ada@example.edu',
    name: 'Ada Okafor',
    role: 'STUDENT',
    status: 'ACTIVE',
    provenance: 'PASSWORD',
    avatarUrl: null,
    totpEnabled: false,
    ...overrides,
  };
}

function wrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

/** A client whose session cache is already answered, so nothing is pending. */
function signedIn(user: SessionUser | null): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(qk.session, { user });
  return queryClient;
}

function policyFor(user: SessionUser | null) {
  return renderHook(() => usePolicy(), { wrapper: wrapper(signedIn(user)) }).result;
}

beforeEach(() => {
  apiGet.mockReset();
});

describe('a subject-dependent action asked without a subject', () => {
  const ACTION: Action = 'conversation:read';

  it('denies an ADMIN, which is what makes the bug look like a broken screen', () => {
    const result = policyFor(viewer({ role: 'ADMIN' }));

    // `conversation:read` is `isParticipant` for every role — admins moderate the
    // threads they were seated in, there is no bypass — so no role escapes this.
    expect(result.current.can(ACTION)).toBe(false);
  });

  it('allows the same admin the moment the subject actually carries the field', () => {
    const result = policyFor(viewer({ role: 'ADMIN' }));

    expect(result.current.can(ACTION, subject({ participantIds: [VIEWER_ID, OTHER_ID] }))).toBe(
      true,
    );
  });

  it('is fine without a subject only for an action whose rule never reads one', () => {
    const result = policyFor(viewer({ role: 'TEACHER' }));

    // `course:create` is a bare allow/deny per role. This is the ONLY shape of
    // subject-free call that is correct, and the distinction is invisible at the
    // call site — which is why the two live side by side here.
    expect(result.current.can('course:create')).toBe(true);
    expect(result.current.can('course:read')).toBe(false);
  });

  it('names the rule that refused, so a denial can be explained', () => {
    const result = policyFor(viewer({ role: 'STUDENT' }));
    const check = result.current.check('conversation:read');

    // Without this the client cannot tell a missing subject from a real refusal,
    // and neither can whoever is reading the screen.
    expect(check.allowed).toBe(false);
    expect(check.allowed === false && check.rule).toBe('STUDENT:isParticipant');
  });
});

describe('a subject of the wrong shape', () => {
  /** What a course detail screen has in hand: publication state, not `isPublic`. */
  const COURSE_SUBJECT = subject({
    id: COURSE_ID,
    courseId: COURSE_ID,
    courseTeacherId: TEACHER_ID,
    publishedAt: '2026-01-05T00:00:00.000Z',
    enrollmentStatus: null,
  });

  /** What a resource row carries: its own flag AND its course's publication state. */
  const RESOURCE_SUBJECT = subject({
    id: '01JGXDFAM0K2Z1GYCSNM5F5RD1',
    courseId: COURSE_ID,
    courseTeacherId: TEACHER_ID,
    isPublic: true,
    publishedAt: '2026-01-05T00:00:00.000Z',
  });

  it('denies a student a resource they are entitled to see', () => {
    const result = policyFor(viewer());

    // The course subject is well-formed, genuinely needed by the page's other
    // gates, and about the wrong kind of thing. `and(isPublic, isPublished)` reads
    // `isPublic`, a course has none, and the disjunct can never fire.
    expect(result.current.can('resource:read', COURSE_SUBJECT)).toBe(false);
    expect(result.current.can('resource:read', RESOURCE_SUBJECT)).toBe(true);
  });

  it('denies an anonymous visitor the same way, so the tab simply never renders', () => {
    const result = policyFor(null);

    expect(result.current.can('resource:read', COURSE_SUBJECT)).toBe(false);
    expect(result.current.can('resource:read', RESOURCE_SUBJECT)).toBe(true);
  });

  it('hides the denial from an ADMIN, whose rule reads no subject at all', () => {
    const result = policyFor(viewer({ role: 'ADMIN' }));

    // This asymmetry is why the incident was reported as "invisible to everyone
    // except an admin": the one role whose cell is a bare `allow` sails through a
    // subject that would have denied every other viewer, so whoever is testing as
    // an admin sees nothing wrong.
    expect(result.current.can('resource:read', COURSE_SUBJECT)).toBe(true);
  });
});

describe('usePolicy while the session is still loading', () => {
  it('reports pending and refuses everything until the actor is known', async () => {
    // A never-answering /auth/me: the state a cold load is in for one round trip.
    apiGet.mockImplementation(() => new Promise(() => {}));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => usePolicy(), { wrapper: wrapper(queryClient) });

    // Screens branch on `isPending` to render skeletons. If they render buttons
    // instead, the buttons are the ANONYMOUS answer — a signed-in teacher would
    // watch their own Edit control appear and then vanish.
    expect(result.current.isPending).toBe(true);
    expect(result.current.can('course:create')).toBe(false);
  });
});

describe('useCan and useAllowedItems', () => {
  it('answers a single action for the current actor', () => {
    const { result } = renderHook(() => useCan('course:create'), {
      wrapper: wrapper(signedIn(viewer({ role: 'TEACHER' }))),
    });

    expect(result.current).toBe(true);
  });

  it('keeps entries that name no action and drops the ones the actor cannot reach', () => {
    const items = [
      { label: 'Dashboard' },
      { label: 'New course', action: 'course:create' as Action },
      { label: 'Users', action: 'user:list' as Action },
    ];

    const { result } = renderHook(() => useAllowedItems(items), {
      wrapper: wrapper(signedIn(viewer({ role: 'TEACHER' }))),
    });

    // An action-free entry is navigation, not an affordance; filtering it out would
    // empty the nav for every non-admin.
    expect(result.current.map((item) => item.label)).toEqual(['Dashboard', 'New course']);
  });
});

describe('useCompletedCourseIds', () => {
  const APPROVED_PAGE = {
    data: [
      { id: 'e1', course: { id: COURSE_ID } },
      { id: 'e2', course: { id: OTHER_ID } },
    ],
    meta: { total: 2, page: 1, limit: MAX_PAGE_SIZE },
  };

  it('reports UNKNOWN rather than none until the lookup has answered', () => {
    const { result } = renderHook(() => useCompletedCourseIds(false), {
      wrapper: wrapper(signedIn(viewer())),
    });

    // `ready: false` with `completedCourseIds: undefined` is the contract a screen
    // needs to hold an enrol button in a loading state. Reporting `[]` instead
    // would say "completed nothing", and every prerequisite-gated course would be
    // refused on data that has not arrived.
    expect(result.current.ready).toBe(false);
    expect(result.current.completedCourseIds).toBeUndefined();
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('reads every approved seat, at the schema ceiling rather than a page size', async () => {
    apiGet.mockResolvedValue(APPROVED_PAGE);

    const { result } = renderHook(() => useCompletedCourseIds(true), {
      wrapper: wrapper(signedIn(viewer())),
    });
    await waitFor(() => expect(result.current.ready).toBe(true));

    // The limit is the assertion that matters. Read at a widget's page size, a
    // student with more approved seats than that page holds would have a
    // prerequisite they HAVE completed silently marked incomplete — the enrol
    // button disappears and nothing anywhere reports why.
    expect(apiGet).toHaveBeenCalledWith('/enrollments', {
      query: { status: 'APPROVED', limit: MAX_PAGE_SIZE },
    });
    expect(result.current.completedCourseIds).toEqual([COURSE_ID, OTHER_ID]);
  });
});
