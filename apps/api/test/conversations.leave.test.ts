import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppInstance } from '../src/app.js';
import { hashPassword } from '../src/lib/password.js';
import {
  buildApp,
  cookieHeader,
  originHeaders,
  prisma,
  resetDatabase,
  resetRateLimits,
  sessionCookie,
} from './setup.js';

/**
 * THE LEAVE ROUTE, and the three things the design note beside `addParticipant`
 * insisted a leave must not be.
 *
 * The note argued that the route was missing on purpose and that the obvious one was
 * wrong. Two of its three arguments were right and are now paid for in `POLICY`
 * (`isMember`, over a new `Subject.memberIds`, so the gate is not decided by the
 * condition the request destroys). The note also wrote down what a leave must NOT be
 * — not a delete of the participant row, not a retraction of anything, not a
 * `lastReadSeq` reset — and those three are assertions here rather than a promise in
 * a comment, because a comment cannot hold an invariant (LESSONS-LEARNED #28).
 *
 * It is a separate file from `conversations.test.ts` rather than a section of it: that
 * suite's `beforeEach` owns the reset order for a module that had no writes, and a
 * file that cannot fail to reset is a file that corrupts the next one.
 */

const PASSWORD = 'correct-horse-battery-staple';

let app: AppInstance;
let passwordHash: string;

beforeAll(async () => {
  app = await buildApp();
  passwordHash = await hashPassword(PASSWORD);
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  // Same unwind order as conversations.test.ts, deepest first: Conversation holds no
  // foreign key to a User, so it outlives `resetDatabase()` as an orphan row.
  await prisma.message.deleteMany({});
  await prisma.conversationParticipant.deleteMany({});
  await prisma.conversation.deleteMany({});
  await prisma.notification.deleteMany({});
  await resetDatabase();
  await resetRateLimits(app.redis);
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
    url: '/api/v1/auth/login',
    headers: { ...originHeaders },
    payload: { email, password: PASSWORD },
  });
  expect(response.statusCode).toBe(200);
  const token = sessionCookie(response);
  expect(token).toBeTruthy();
  return token as string;
}

async function signedIn(
  email: string,
  role: TestRole,
  name?: string,
): Promise<{ id: string; cookie: string }> {
  const id = await createAccount(email, role, name);
  return { id, cookie: await login(email) };
}

function send(method: 'POST' | 'GET', url: string, cookie?: string, payload?: unknown) {
  return app.inject({
    method,
    url: `/api/v1/conversations${url}`,
    headers: { ...originHeaders, ...(cookie ? { cookie: cookieHeader(cookie) } : {}) },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

/** A two-person direct thread with one message in it, and both sides seated. */
async function directThread(): Promise<{
  conversationId: string;
  student: { id: string; cookie: string };
  teacher: { id: string; cookie: string };
}> {
  const student = await signedIn('leave-s@example.com', 'STUDENT', 'Ada Okafor');
  const teacher = await signedIn('leave-t@example.com', 'TEACHER', 'Priya Raman');
  const created = await send('POST', '/', student.cookie, { participantIds: [teacher.id] });
  expect(created.statusCode).toBe(201);
  const conversationId = (created.json() as { id: string }).id;

  const posted = await send('POST', `/${conversationId}/messages`, student.cookie, {
    content: 'hello',
    clientMsgId: '01JGXDFAM0K2Z1GYCSNM5F5RCX',
  });
  expect(posted.statusCode).toBe(201);
  return { conversationId, student, teacher };
}

function seat(conversationId: string, userId: string) {
  return prisma.conversationParticipant.findUniqueOrThrow({
    where: { conversationId_userId: { conversationId, userId } },
  });
}

// ---------------------------------------------------------------------------

describe('POST /conversations/:conversationId/leave', () => {
  it('stamps leftAt and answers with the roster but not the thread content', async () => {
    const { conversationId, student } = await directThread();

    const response = await send('POST', `/${conversationId}/leave`, student.cookie);

    expect(response.statusCode).toBe(200);
    // The person who just left is no longer a `conversation:read` participant, so
    // `lastMessage` is withheld exactly as it is for an admin who seated a stranger.
    expect(response.json().lastMessage).toBeNull();
    const mine = (
      response.json().participants as Array<{ user: { id: string }; leftAt: string }>
    ).find((participant) => participant.user.id === student.id);
    expect(mine?.leftAt).not.toBeNull();
  });

  /*
   * THE THREE FACTS, as assertions.
   *
   * A comment saying "this does not touch lastReadSeq" is worth nothing the day
   * somebody helpfully adds it to the `data` object; a row read back from the database
   * is worth something every time.
   */
  it('is a soft write: no row deleted, no message retracted, no read marker moved', async () => {
    const { conversationId, student, teacher } = await directThread();
    // Give the student a read marker worth losing.
    await send('POST', `/${conversationId}/read`, student.cookie, { seq: '1' });
    const before = await seat(conversationId, student.id);
    const markerBefore = before.lastReadSeq.toString();
    expect(markerBefore).toBe('1');

    expect((await send('POST', `/${conversationId}/leave`, student.cookie)).statusCode).toBe(200);

    // 1. The row is still there, carrying WHEN. A delete would make `leftAt` null
    //    forever — indistinguishable from never having been seated — and would take
    //    the restore that `addParticipant`'s upsert performs with it.
    const after = await seat(conversationId, student.id);
    expect(after.leftAt).toBeInstanceOf(Date);
    expect(after.id).toBe(before.id);
    // 2. The messages are untouched and `nextSeq` is not renumbered.
    expect(await prisma.message.count({ where: { conversationId } })).toBe(1);
    // 3. The marker is where they abandoned it, so a re-seat returns them to the
    //    messages they missed rather than to a thread that claims it is all read.
    expect(after.lastReadSeq.toString()).toBe(markerBefore);

    // And the OTHER side is not touched by somebody else's leave.
    const survivor = await seat(conversationId, teacher.id);
    expect(survivor.leftAt).toBeNull();
  });

  it("takes the thread out of the leaver's list and refuses them its messages", async () => {
    const { conversationId, student } = await directThread();
    await send('POST', `/${conversationId}/leave`, student.cookie);

    const list = await send('GET', '/', student.cookie);
    expect(list.json().data).toEqual([]);

    // `conversation:read` is `isParticipant` and was not changed by the leave. A gate
    // that had been widened to `isMember` would hand a leaver the thread they just
    // walked out of — the whole risk of the new rule, and the reason the two fields
    // are separate.
    const messages = await send('GET', `/${conversationId}/messages`, student.cookie);
    expect(messages.statusCode).toBe(403);
    expect(messages.json().detail).toContain('rule: STUDENT:isParticipant');
  });

  it('refuses a caller who was never seated, naming the rule that denied it', async () => {
    const { conversationId, student } = await directThread();
    const stranger = await signedIn('leave-x@example.com', 'STUDENT', 'Bo Lindqvist');

    const response = await send('POST', `/${conversationId}/leave`, stranger.cookie);

    expect(response.statusCode).toBe(403);
    // `isMember` on an EMPTY subject denies, which is the whole reason the action is
    // NOT in `SUBJECT_INDEPENDENT_ACTIONS` and the SPA cannot gate this with a bare
    // `can()`.
    expect(response.json().detail).toContain('rule: STUDENT:isMember');
    expect((await seat(conversationId, student.id)).leftAt).toBeNull();
  });

  it('refuses an anonymous caller before the service runs', async () => {
    const { conversationId } = await directThread();
    const response = await send('POST', `/${conversationId}/leave`);
    expect(response.statusCode).toBe(401);
  });

  it('conflicts on a second leave and does not move the first one', async () => {
    const { conversationId, student } = await directThread();
    expect((await send('POST', `/${conversationId}/leave`, student.cookie)).statusCode).toBe(200);
    const first = (await seat(conversationId, student.id)).leftAt as Date;

    const again = await send('POST', `/${conversationId}/leave`, student.cookie);

    expect(again.statusCode).toBe(409);
    // A 200 here would be a lie the caller renders as "you are out of this thread"
    // from a write that changed nothing; re-stamping would destroy the only record of
    // WHEN they left.
    expect(((await seat(conversationId, student.id)).leftAt as Date).getTime()).toBe(
      first.getTime(),
    );
  });

  it('sends no notification to the person who pressed the button', async () => {
    const { conversationId, student } = await directThread();
    await send('POST', `/${conversationId}/leave`, student.cookie);
    expect(await prisma.notification.count({ where: { userId: student.id } })).toBe(0);
  });

  /*
   * THE DIRECT THREAD, and the behaviour the design note predicted, verified rather
   * than asserted from reading. `findDirectConversation` identifies a one-to-one by
   * `title: null` PLUS a live participant count equal to the pair, so a thread with
   * one live participant cannot match a fresh two-person create.
   *
   * What that costs is stated rather than hidden: the survivor keeps the old thread
   * and the pair get a new one. The alternative the note considered — refusing the
   * leave — would leave a student no way out of a thread only an admin could put them
   * in, and deleting the thread would destroy the survivor's history over the
   * leaver's decision.
   */
  it('abandons a direct thread to the survivor, and a later thread with the same pair is a new one', async () => {
    const { conversationId, student, teacher } = await directThread();
    await send('POST', `/${conversationId}/leave`, student.cookie);

    // The survivor still has it, with the history on it.
    const survivorList = await send('GET', '/', teacher.cookie);
    expect(survivorList.json().data).toHaveLength(1);

    const reopened = await send('POST', '/', student.cookie, { participantIds: [teacher.id] });
    expect(reopened.statusCode).toBe(201);
    expect((reopened.json() as { id: string }).id).not.toBe(conversationId);

    // Which is only a problem if it is silent, so it is not: the old thread still
    // carries the row that says who left and when.
    const old = await seat(conversationId, student.id);
    expect(old.leftAt).toBeInstanceOf(Date);
  });
});

describe('POST /conversations/:conversationId/participants/remove', () => {
  it('lets an admin take somebody out of a thread, and tells them', async () => {
    const { conversationId, student, teacher } = await directThread();
    const admin = await signedIn('rm-a@example.com', 'ADMIN', 'Dana Whitfield');
    await send('POST', `/${conversationId}/participants`, admin.cookie, { userId: admin.id });

    const response = await send('POST', `/${conversationId}/participants/remove`, admin.cookie, {
      userId: student.id,
    });

    expect(response.statusCode).toBe(200);
    expect((await seat(conversationId, student.id)).leftAt).toBeInstanceOf(Date);
    // The other participant is unaffected, and the thread survives.
    expect((await seat(conversationId, teacher.id)).leftAt).toBeNull();

    /*
     * THE ANNOUNCEMENT. `Message` says what was said; nothing said who was entitled to
     * hear it. Without this row the removed person is left with a thread that vanished
     * from their list, an unread badge nothing can clear, and no way to tell an
     * administrator's mistake from a bug.
     */
    const notification = await prisma.notification.findFirstOrThrow({
      where: { userId: student.id, type: 'CONVERSATION_REMOVED' },
    });
    const payload = notification.payload as { title?: string; body?: string };
    expect(payload.title).toBeTruthy();
    expect(payload.body).toBeTruthy();
    // Nobody else is told about the REMOVAL: the roster change is visible to them and
    // the copy would be untrue for them. Scoped to the type, because the opening
    // message in `directThread` legitimately left the teacher a MESSAGE_RECEIVED.
    expect(
      await prisma.notification.count({
        where: { userId: teacher.id, type: 'CONVERSATION_REMOVED' },
      }),
    ).toBe(0);
  });

  it('refuses a student and a teacher, naming the rule', async () => {
    const { conversationId, student, teacher } = await directThread();

    const asStudent = await send('POST', `/${conversationId}/participants/remove`, student.cookie, {
      userId: teacher.id,
    });
    expect(asStudent.statusCode).toBe(403);
    expect(asStudent.json().detail).toContain('rule: STUDENT:deny');

    const asTeacher = await send('POST', `/${conversationId}/participants/remove`, teacher.cookie, {
      userId: student.id,
    });
    expect(asTeacher.statusCode).toBe(403);
    expect(asTeacher.json().detail).toContain('rule: TEACHER:deny');
    expect((await seat(conversationId, student.id)).leftAt).toBeNull();
  });

  it('refuses an admin removing THEMSELVES, and points them at the leave route', async () => {
    const { conversationId, student } = await directThread();
    const admin = await signedIn('rm-self@example.com', 'ADMIN', 'Dana Whitfield');
    await send('POST', `/${conversationId}/participants`, admin.cookie, { userId: admin.id });

    const response = await send('POST', `/${conversationId}/participants/remove`, admin.cookie, {
      userId: admin.id,
    });

    // Two verbs, so a self-service exit cannot be announced as a moderator's decision.
    expect(response.statusCode).toBe(422);
    expect(response.json().errors[0].path).toBe('userId');
    expect((await seat(conversationId, admin.id)).leftAt).toBeNull();
  });

  it('404s somebody who is not in the thread, and 409s somebody who already left', async () => {
    const { conversationId, student } = await directThread();
    const admin = await signedIn('rm-404@example.com', 'ADMIN', 'Dana Whitfield');
    const stranger = await createAccount('rm-nobody@example.com', 'STUDENT');

    const missing = await send('POST', `/${conversationId}/participants/remove`, admin.cookie, {
      userId: stranger,
    });
    expect(missing.statusCode).toBe(404);

    await send('POST', `/${conversationId}/leave`, student.cookie);
    const gone = await send('POST', `/${conversationId}/participants/remove`, admin.cookie, {
      userId: student.id,
    });
    expect(gone.statusCode).toBe(409);
  });

  it('lets a removed person come back, still owing the messages they missed', async () => {
    const { conversationId, student } = await directThread();
    await send('POST', `/${conversationId}/read`, student.cookie, { seq: '1' });
    const admin = await signedIn('rm-back@example.com', 'ADMIN', 'Dana Whitfield');

    await send('POST', `/${conversationId}/participants/remove`, admin.cookie, {
      userId: student.id,
    });
    const reseated = await send('POST', `/${conversationId}/participants`, admin.cookie, {
      userId: student.id,
    });

    expect(reseated.statusCode).toBe(200);
    const row = await seat(conversationId, student.id);
    expect(row.leftAt).toBeNull();
    // The marker was deliberately left where they abandoned it by the leave, and
    // deliberately not reset by the restore either.
    expect(row.lastReadSeq.toString()).toBe('1');
  });

  it('404s a conversation that does not exist', async () => {
    const admin = await signedIn('rm-gone@example.com', 'ADMIN', 'Dana Whitfield');
    const someone = await createAccount('rm-gone-u@example.com', 'STUDENT');

    const response = await send(
      'POST',
      '/ckzzzzzzzzzzzzzzzzzzzzzzz/participants/remove',
      admin.cookie,
      {
        userId: someone,
      },
    );

    expect(response.statusCode).toBe(404);
  });
});
