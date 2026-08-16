import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ulid } from 'ulid';
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

const PASSWORD = 'correct-horse-battery-staple';

let app: FastifyInstance;
/** Hashed once: argon2 is deliberately expensive, and every account here shares it. */
let passwordHash: string;

beforeAll(async () => {
  app = await buildApp();
  passwordHash = await hashPassword(PASSWORD);
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  /*
   * resetDatabase() deletes every user, which cascades ConversationParticipant and
   * Message (schema.prisma:548,569 are both onDelete: Cascade) — but Conversation holds
   * no foreign key to a User, so it survives as an orphan row with no participants and
   * leaks into the next suite's counts. Messaging tables are not in resetDatabase()'s
   * FK-safe list, so this suite unwinds its own, deepest first.
   */
  await prisma.message.deleteMany({});
  await prisma.conversationParticipant.deleteMany({});
  await prisma.conversation.deleteMany({});
  await resetDatabase();
  await resetRateLimits(app.redis);
});

// --- helpers ---------------------------------------------------------------

type TestRole = 'STUDENT' | 'TEACHER' | 'ADMIN';

/** Provisioned directly: only students self-register, and this suite needs all three roles. */
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

/** Creates the account and returns both its id and a session cookie for it. */
async function signedIn(
  email: string,
  role: TestRole,
  name?: string,
): Promise<{ id: string; cookie: string }> {
  const id = await createAccount(email, role, name);
  return { id, cookie: await login(email) };
}

function get(url: string, cookie?: string) {
  return app.inject({
    method: 'GET',
    url: `/api/v1/conversations${url}`,
    headers: cookie ? { cookie: cookieHeader(cookie) } : {},
  });
}

/** Every non-GET must look same-origin or csrf.plugin.ts:20-30 rejects it before the route. */
function send(
  method: 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload: unknown,
  cookie?: string,
  headers: Record<string, string> = originHeaders,
) {
  return app.inject({
    method,
    url: `/api/v1/conversations${url}`,
    headers: { ...headers, ...(cookie ? { cookie: cookieHeader(cookie) } : {}) },
    payload: payload as Record<string, unknown>,
  });
}

async function createConversation(
  cookie: string,
  body: Record<string, unknown>,
): Promise<{ id: string }> {
  const response = await send('POST', '/', body, cookie);
  expect(response.statusCode).toBe(201);
  return response.json() as { id: string };
}

async function post(conversationId: string, cookie: string, content: string): Promise<string> {
  const response = await send(
    'POST',
    `/${conversationId}/messages`,
    // A real ULID: sendMessageSchema requires /^[0-9A-HJKMNP-TV-Z]{26}$/ (message.ts:33-36).
    { content, clientMsgId: ulid() },
    cookie,
  );
  expect(response.statusCode).toBe(201);
  return response.json().seq as string;
}

// --- tests -----------------------------------------------------------------

describe('POST /conversations', () => {
  it('seats the creator and serves the shared shape, not the flat client type', async () => {
    const student = await signedIn('student@example.com', 'STUDENT', 'Sam Student');
    const teacher = await signedIn('teacher@example.com', 'TEACHER', 'Tessa Teacher');

    const response = await send('POST', '/', { participantIds: [teacher.id] }, student.cookie);
    expect(response.statusCode).toBe(201);

    const body = response.json();
    // conversation.ts:38-42 — the creator is always seated even though they are not in
    // `participantIds`.
    expect(body.participants).toHaveLength(2);
    expect(body.participants.map((p: { user: { id: string } }) => p.user.id).sort()).toEqual(
      [student.id, teacher.id].sort(),
    );
    // The person is nested under `user`, and lastReadSeq is a STRING (bigIntStringSchema).
    // apps/web/src/lib/types.ts:98-105 disagrees with all of this, which is the point.
    expect(body.participants[0].user).toMatchObject({
      name: expect.any(String),
      role: expect.any(String),
      avatarUrl: expect.any(String),
    });
    expect(body.participants[0].lastReadSeq).toBe('0');
    expect(body.title).toBeNull();
    expect(body.lastMessage).toBeNull();
    expect(body.unreadCount).toBe(0);
  });

  it('posts the optional opening message through the seq-claiming path', async () => {
    const student = await signedIn('opener@example.com', 'STUDENT', 'Sam Student');
    const teacher = await signedIn('opened@example.com', 'TEACHER', 'Tessa Teacher');

    const response = await send(
      'POST',
      '/',
      { participantIds: [teacher.id], message: 'Is there a seat left?' },
      student.cookie,
    );
    expect(response.statusCode).toBe(201);

    const body = response.json();
    // `lastMessage` is a whole MessageDto (conversation.ts:30) — there is no
    // `lastMessagePreview` field anywhere in shared.
    expect(body.lastMessage).toMatchObject({ content: 'Is there a seat left?' });
    // Message.seq is a Postgres bigint shipped as a string, and the first seq is 1
    // because Conversation.nextSeq starts at 1 (schema.prisma:531).
    expect(body.lastMessage.seq).toBe('1');
    expect(body.lastMessage.sender).toMatchObject({ id: student.id, name: 'Sam Student' });
    // Sending is reading: the author's own opening line is not unread to them.
    expect(body.unreadCount).toBe(0);
  });

  it('deduplicates a direct thread instead of creating a second one', async () => {
    const student = await signedIn('dedupe@example.com', 'STUDENT');
    const teacher = await signedIn('dedupe-t@example.com', 'TEACHER');

    const first = await createConversation(student.cookie, { participantIds: [teacher.id] });
    // The other direction, from the other person: still the same thread.
    const second = await createConversation(teacher.cookie, { participantIds: [student.id] });

    expect(second.id).toBe(first.id);
    expect(await prisma.conversation.count()).toBe(1);
  });

  it('turns an unknown participantId into a 422 with a field path', async () => {
    const student = await signedIn('fk@example.com', 'STUDENT');

    const response = await send(
      'POST',
      '/',
      { participantIds: ['ckzzzzzzzzzzzzzzzzzzzzzzz'] },
      student.cookie,
    );
    expect(response.statusCode).toBe(422);
    expect(response.json().errors).toContainEqual({
      path: 'participantIds',
      message: 'Unknown user',
    });
  });

  it('refuses an anonymous caller', async () => {
    const response = await send('POST', '/', { participantIds: ['ckzzzzzzzzzzzzzzzzzzzzzzz'] });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('UNAUTHENTICATED');
  });

  it('refuses a state change that is not same-origin', async () => {
    const student = await signedIn('csrf@example.com', 'STUDENT');
    const teacher = await signedIn('csrf-t@example.com', 'TEACHER');

    const response = await send('POST', '/', { participantIds: [teacher.id] }, student.cookie, {});
    expect(response.statusCode).toBe(403);
    expect(response.json().detail).toContain('rule: csrf.sameOrigin');
  });
});

describe('GET /conversations', () => {
  it('lists the caller’s own threads with an unread count', async () => {
    const student = await signedIn('inbox@example.com', 'STUDENT');
    const teacher = await signedIn('inbox-t@example.com', 'TEACHER');
    const conversation = await createConversation(student.cookie, {
      participantIds: [teacher.id],
    });
    await post(conversation.id, teacher.cookie, 'Yes, two seats.');

    const response = await get('', student.cookie);
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(conversation.id);
    expect(body.data[0].unreadCount).toBe(1);
    expect(body.data[0].lastMessage.content).toBe('Yes, two seats.');
    expect(body.meta).toMatchObject({ page: 1, total: 1, totalPages: 1, hasNext: false });
  });

  it('does not leak a thread the caller is not seated in', async () => {
    const outsider = await signedIn('outsider@example.com', 'STUDENT');
    const a = await signedIn('a@example.com', 'STUDENT');
    const b = await signedIn('b@example.com', 'TEACHER');

    const theirs = await createConversation(a.cookie, { participantIds: [b.id] });
    await post(theirs.id, a.cookie, 'Private.');

    const response = await get('', outsider.cookie);
    expect(response.statusCode).toBe(200);
    // Not "returned and hidden by the client" — filtered server-side, so `meta.total`
    // cannot advertise the existence of the row either.
    expect(response.json().data).toHaveLength(0);
    expect(response.json().meta.total).toBe(0);
  });

  it('refuses an anonymous caller, even though the route skips authorize()', async () => {
    // `requireActor` (auth.plugin.ts:96-99) is the gate here, not `can()`.
    const response = await get('');
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('UNAUTHENTICATED');
  });

  it('filters unreadOnly in SQL, so meta.total agrees with the page', async () => {
    const student = await signedIn('unread@example.com', 'STUDENT');
    const teacher = await signedIn('unread-t@example.com', 'TEACHER');

    const noisy = await createConversation(student.cookie, { participantIds: [teacher.id] });
    await post(noisy.id, teacher.cookie, 'Unread.');
    // A titled second thread, so the direct-thread dedupe does not fold it into the first.
    const quiet = await createConversation(student.cookie, {
      participantIds: [teacher.id],
      title: 'Quiet thread',
    });

    const response = await get('?unreadOnly=true', student.cookie);
    expect(response.statusCode).toBe(200);
    expect(response.json().data.map((row: { id: string }) => row.id)).toEqual([noisy.id]);
    expect(response.json().meta.total).toBe(1);
    expect(quiet.id).not.toBe(noisy.id);
  });

  it('searches titles without widening past the caller’s own threads', async () => {
    const student = await signedIn('search@example.com', 'STUDENT');
    const teacher = await signedIn('search-t@example.com', 'TEACHER');
    const other = await signedIn('search-o@example.com', 'STUDENT');

    await createConversation(student.cookie, {
      participantIds: [teacher.id],
      title: 'Welding intake',
    });
    await createConversation(other.cookie, {
      participantIds: [teacher.id],
      title: 'Welding intake',
    });

    const response = await get('?q=welding', student.cookie);
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toHaveLength(1);
  });
});

describe('GET /conversations/:conversationId/messages', () => {
  it('pages newest-first in the cursor envelope', async () => {
    const student = await signedIn('thread@example.com', 'STUDENT');
    const teacher = await signedIn('thread-t@example.com', 'TEACHER');
    const conversation = await createConversation(student.cookie, {
      participantIds: [teacher.id],
    });

    await post(conversation.id, student.cookie, 'one');
    await post(conversation.id, teacher.cookie, 'two');
    await post(conversation.id, student.cookie, 'three');

    const response = await get(`/${conversation.id}/messages?limit=2`, student.cookie);
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.data.map((m: { content: string }) => m.content)).toEqual(['three', 'two']);
    // seq is a string, and the sender is nested — Messages.tsx reads `senderId` and
    // `senderName`, which this shape deliberately does not have.
    expect(body.data[0].seq).toBe('3');
    expect(body.data[0].sender).toMatchObject({ id: student.id });
    expect(body.data[0].senderId).toBeUndefined();
    expect(body.meta).toEqual({ nextCursor: '2', hasMore: true });
  });

  it('backfills forward with `after`, which is the reconnect direction', async () => {
    const student = await signedIn('backfill@example.com', 'STUDENT');
    const teacher = await signedIn('backfill-t@example.com', 'TEACHER');
    const conversation = await createConversation(student.cookie, {
      participantIds: [teacher.id],
    });

    await post(conversation.id, student.cookie, 'one');
    await post(conversation.id, teacher.cookie, 'two');
    await post(conversation.id, teacher.cookie, 'three');

    const response = await get(`/${conversation.id}/messages?after=1`, student.cookie);
    expect(response.statusCode).toBe(200);
    expect(response.json().data.map((m: { content: string }) => m.content)).toEqual([
      'two',
      'three',
    ]);
    expect(response.json().meta.hasMore).toBe(false);
  });

  it('refuses a caller who is not a participant, naming the rule', async () => {
    const student = await signedIn('private@example.com', 'STUDENT');
    const teacher = await signedIn('private-t@example.com', 'TEACHER');
    const intruder = await signedIn('intruder@example.com', 'STUDENT');
    const conversation = await createConversation(student.cookie, {
      participantIds: [teacher.id],
    });

    const response = await get(`/${conversation.id}/messages`, intruder.cookie);
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
    // policy.ts:397-404 — `conversation:read` is isParticipant for every role.
    expect(response.json().detail).toContain('rule: STUDENT:isParticipant');
  });

  it('refuses an admin who was never seated in the thread', async () => {
    const student = await signedIn('closed@example.com', 'STUDENT');
    const teacher = await signedIn('closed-t@example.com', 'TEACHER');
    const admin = await signedIn('admin@example.com', 'ADMIN');
    const conversation = await createConversation(student.cookie, {
      participantIds: [teacher.id],
    });

    const response = await get(`/${conversation.id}/messages`, admin.cookie);
    expect(response.statusCode).toBe(403);
    // policy.ts:401-403 — "Admins moderate threads they were seated in"; there is no
    // bypass row, and the service must not invent one.
    expect(response.json().detail).toContain('rule: ADMIN:isParticipant');
  });
});

describe('POST /conversations/:conversationId/messages', () => {
  it('returns the original message on a retry rather than double-posting', async () => {
    const student = await signedIn('idem@example.com', 'STUDENT');
    const teacher = await signedIn('idem-t@example.com', 'TEACHER');
    const conversation = await createConversation(student.cookie, {
      participantIds: [teacher.id],
    });

    const payload = { content: 'Sent twice', clientMsgId: ulid() };
    const first = await send('POST', `/${conversation.id}/messages`, payload, student.cookie);
    const second = await send('POST', `/${conversation.id}/messages`, payload, student.cookie);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json().id).toBe(first.json().id);
    expect(second.json().seq).toBe(first.json().seq);
    expect(await prisma.message.count({ where: { conversationId: conversation.id } })).toBe(1);
  });

  it('rejects the SPA’s base36 clientMsgId at the validator, before the policy gate', async () => {
    const student = await signedIn('trap4@example.com', 'STUDENT');
    const teacher = await signedIn('trap4-t@example.com', 'TEACHER');
    const intruder = await signedIn('trap4-i@example.com', 'STUDENT');
    const conversation = await createConversation(student.cookie, {
      participantIds: [teacher.id],
    });

    // Messages.tsx:164 generates exactly this shape. The caller is ALSO a non-participant,
    // so a correct policy gate would answer 403 — the 422 proves Fastify validates before
    // preHandler, and that every send from the SPA fails today.
    const response = await send(
      'POST',
      `/${conversation.id}/messages`,
      {
        content: 'hello',
        clientMsgId: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
      },
      intruder.cookie,
    );
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('VALIDATION_FAILED');
  });

  it('refuses a non-participant with a well-formed body', async () => {
    const student = await signedIn('send-p@example.com', 'STUDENT');
    const teacher = await signedIn('send-t@example.com', 'TEACHER');
    const intruder = await signedIn('send-i@example.com', 'TEACHER');
    const conversation = await createConversation(student.cookie, {
      participantIds: [teacher.id],
    });

    const response = await send(
      'POST',
      `/${conversation.id}/messages`,
      { content: 'let me in', clientMsgId: ulid() },
      intruder.cookie,
    );
    expect(response.statusCode).toBe(403);
    // policy.ts:411-416.
    expect(response.json().detail).toContain('rule: TEACHER:isParticipant');
    expect(await prisma.message.count({ where: { conversationId: conversation.id } })).toBe(0);
  });

  it('hands out gap-free sequence numbers across senders', async () => {
    const student = await signedIn('seq@example.com', 'STUDENT');
    const teacher = await signedIn('seq-t@example.com', 'TEACHER');
    const conversation = await createConversation(student.cookie, {
      participantIds: [teacher.id],
    });

    expect(await post(conversation.id, student.cookie, 'a')).toBe('1');
    expect(await post(conversation.id, teacher.cookie, 'b')).toBe('2');
    expect(await post(conversation.id, student.cookie, 'c')).toBe('3');

    const row = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    // nextSeq is the NEXT seq to hand out, so live messages occupy 1 .. nextSeq-1.
    expect(row.nextSeq).toBe(4n);
  });
});

describe('POST /conversations/:conversationId/read', () => {
  it('drives the unread count to zero and never moves the mark backwards', async () => {
    const student = await signedIn('read@example.com', 'STUDENT');
    const teacher = await signedIn('read-t@example.com', 'TEACHER');
    const conversation = await createConversation(student.cookie, {
      participantIds: [teacher.id],
    });
    await post(conversation.id, teacher.cookie, 'one');
    await post(conversation.id, teacher.cookie, 'two');

    const marked = await send('POST', `/${conversation.id}/read`, { seq: '2' }, student.cookie);
    expect(marked.statusCode).toBe(200);
    expect(marked.json().unreadCount).toBe(0);

    // A late receipt from an older render must not resurrect messages already seen.
    const stale = await send('POST', `/${conversation.id}/read`, { seq: '1' }, student.cookie);
    expect(stale.statusCode).toBe(200);
    expect(stale.json().unreadCount).toBe(0);
  });

  it('refuses a caller who is not a participant', async () => {
    const student = await signedIn('mark@example.com', 'STUDENT');
    const teacher = await signedIn('mark-t@example.com', 'TEACHER');
    const intruder = await signedIn('mark-i@example.com', 'STUDENT');
    const conversation = await createConversation(student.cookie, {
      participantIds: [teacher.id],
    });

    const response = await send('POST', `/${conversation.id}/read`, { seq: 1 }, intruder.cookie);
    expect(response.statusCode).toBe(403);
    expect(response.json().detail).toContain('rule: STUDENT:isParticipant');
  });

  it('moves only the caller’s own mark', async () => {
    const student = await signedIn('mine@example.com', 'STUDENT');
    const teacher = await signedIn('mine-t@example.com', 'TEACHER');
    const conversation = await createConversation(student.cookie, {
      participantIds: [teacher.id],
    });
    await post(conversation.id, student.cookie, 'hello');

    const response = await send('POST', `/${conversation.id}/read`, { seq: 1 }, teacher.cookie);
    expect(response.statusCode).toBe(200);

    const studentSeat = await prisma.conversationParticipant.findUniqueOrThrow({
      where: { conversationId_userId: { conversationId: conversation.id, userId: student.id } },
    });
    const teacherSeat = await prisma.conversationParticipant.findUniqueOrThrow({
      where: { conversationId_userId: { conversationId: conversation.id, userId: teacher.id } },
    });
    expect(teacherSeat.lastReadSeq).toBe(1n);
    // The sender's own mark was already 1 from sending, and the teacher's request did
    // not touch it — the updateMany is scoped to actor.id.
    expect(studentSeat.lastReadSeq).toBe(1n);
  });
});

describe('POST /conversations/:conversationId/participants', () => {
  it('refuses a student, naming the rule that denied it', async () => {
    const student = await signedIn('join@example.com', 'STUDENT');
    const teacher = await signedIn('join-t@example.com', 'TEACHER');
    const outsider = await createAccount('join-o@example.com', 'STUDENT');
    const conversation = await createConversation(student.cookie, {
      participantIds: [teacher.id],
    });

    const response = await send(
      'POST',
      `/${conversation.id}/participants`,
      { userId: outsider },
      student.cookie,
    );
    expect(response.statusCode).toBe(403);
    // policy.ts:417-424 — "Self-joining an arbitrary thread is the whole attack."
    expect(response.json().detail).toContain('rule: STUDENT:deny');
  });

  it('lets an admin seat someone, and re-seating clears leftAt', async () => {
    const student = await signedIn('seat@example.com', 'STUDENT');
    const teacher = await signedIn('seat-t@example.com', 'TEACHER');
    const admin = await signedIn('seat-a@example.com', 'ADMIN');
    const conversation = await createConversation(student.cookie, {
      participantIds: [teacher.id],
    });
    await post(conversation.id, student.cookie, 'hello');

    const seated = await send(
      'POST',
      `/${conversation.id}/participants`,
      { userId: admin.id },
      admin.cookie,
    );
    expect(seated.statusCode).toBe(200);
    expect(seated.json().participants).toHaveLength(3);
    // The admin is now seated, so the thread's content is theirs to read.
    expect(seated.json().lastMessage.content).toBe('hello');

    await prisma.conversationParticipant.updateMany({
      where: { conversationId: conversation.id, userId: admin.id },
      data: { leftAt: new Date() },
    });

    const reseated = await send(
      'POST',
      `/${conversation.id}/participants`,
      { userId: admin.id },
      admin.cookie,
    );
    expect(reseated.statusCode).toBe(200);
    const row = await prisma.conversationParticipant.findUniqueOrThrow({
      where: { conversationId_userId: { conversationId: conversation.id, userId: admin.id } },
    });
    expect(row.leftAt).toBeNull();
  });

  it('withholds thread content from an admin who seated someone else', async () => {
    const student = await signedIn('quiet@example.com', 'STUDENT');
    const teacher = await signedIn('quiet-t@example.com', 'TEACHER');
    const admin = await signedIn('quiet-a@example.com', 'ADMIN');
    const newcomer = await createAccount('quiet-n@example.com', 'STUDENT');
    const conversation = await createConversation(student.cookie, {
      participantIds: [teacher.id],
    });
    await post(conversation.id, student.cookie, 'secret');

    const response = await send(
      'POST',
      `/${conversation.id}/participants`,
      { userId: newcomer },
      admin.cookie,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().participants).toHaveLength(3);
    // `conversation:join` is ADMIN-allow, but `conversation:read` is still
    // isParticipant for ADMIN (policy.ts:397-404): seating someone does not earn the
    // right to read the thread.
    expect(response.json().lastMessage).toBeNull();
  });

  it('404s a conversation that does not exist', async () => {
    const admin = await signedIn('missing-a@example.com', 'ADMIN');
    const someone = await createAccount('missing-u@example.com', 'STUDENT');

    const response = await send(
      'POST',
      '/ckzzzzzzzzzzzzzzzzzzzzzzz/participants',
      { userId: someone },
      admin.cookie,
    );
    // The gate is role-only, so the existence check is the service's — policy.ts:421
    // says "only to a thread that already exists" and nothing else could enforce it.
    expect(response.statusCode).toBe(404);
  });
});
