import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { cursorPaginated, paginated } from '@skillwright/shared';
import { authorize, requireActor } from '../../plugins/auth.plugin.js';
import {
  conversationIdParamSchema,
  conversationSchema,
  createConversationSchema,
  joinConversationSchema,
  listConversationsQuerySchema,
  listMessagesQuerySchema,
  markReadSchema,
  messageSchema,
  sendMessageSchema,
} from './conversations.schema.js';
import * as conversationsService from './conversations.service.js';

/**
 * A `SubjectLoader` receives the BARE FastifyRequest (auth.plugin.ts:106-108), not the
 * type-provider-narrowed one, so `request.params` is `unknown` there. The one cast in
 * this module lives here — at the single site that needs it — and never in a handler,
 * where the type provider has already narrowed the params.
 */
function conversationIdOf(request: FastifyRequest): string {
  return (request.params as { conversationId: string }).conversationId;
}

const conversationsRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /*
   * No `authorize('conversation:read')` here, deliberately.
   *
   * `conversation:read` is `isParticipant` for all three roles (`POLICY`), and
   * `isParticipant` reads `Subject.participantIds` (combinators.ts:82-85). A
   * cross-conversation list has no single subject, and the gate with an empty one
   * denies EVERYONE — a rule that reads an absent field must deny (actor.ts:46-51), so
   * even an admin would be 403'd off their own inbox. This is exactly the case
   * enrollments.routes.ts:32-40 documents.
   *
   * So the route gates on authentication and the policy becomes a WHERE clause:
   * `visibilityWhere` in the service, which mirrors `POLICY`'s `conversation:read` row for row. The
   * session-state gates (MFA_PENDING, SUSPENDED, PENDING_VERIFICATION) still apply —
   * they live in auth.plugin.ts's onRequest hook (:63-83), which covers routes that
   * skip `authorize()`, which is what makes skipping it safe here.
   */
  app.get(
    '/',
    {
      schema: {
        querystring: listConversationsQuerySchema,
        response: { 200: paginated(conversationSchema) },
      },
    },
    async (request) => conversationsService.list(requireActor(request), request.query),
  );

  // `conversation:create` in `POLICY` is anonymous deny / STUDENT, TEACHER, ADMIN
  // allow: role-only,
  // reading no Subject field, so a BARE authorize() is a complete gate — the same
  // argument departments.routes.ts:15-29 makes for its whole module.
  app.post(
    '/',
    {
      schema: { body: createConversationSchema, response: { 201: conversationSchema } },
      preHandler: authorize('conversation:create'),
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(await conversationsService.create(requireActor(request), request.body)),
  );

  app.get(
    '/:conversationId/messages',
    {
      schema: {
        params: conversationIdParamSchema,
        querystring: listMessagesQuerySchema,
        // Cursor, not offset: pagination.ts:70-73. A conversation grows while you read
        // it, and offset paging in a growing list re-serves rows you have already seen.
        response: { 200: cursorPaginated(messageSchema) },
      },
      preHandler: authorize('conversation:read', (request) =>
        conversationsService.loadConversationSubject(conversationIdOf(request)),
      ),
    },
    async (request) =>
      conversationsService.listMessages(request.params.conversationId, request.query),
  );

  app.post(
    '/:conversationId/messages',
    {
      schema: {
        params: conversationIdParamSchema,
        // `sendMessageSchema` is bound UNCHANGED. `clientMsgId` must be a 26-character
        // ULID (message.ts:33-36) because it is an idempotency key backed by
        // @@unique([senderId, clientMsgId]) (on `model Message`); loosening it to accept
        // the SPA's 16-character base36 string (Messages.tsx:164) would weaken that
        // guarantee to buy a client-side bug. The SPA emits a real ULID instead — the
        // repository already depends on `ulid` (app.ts:13).
        body: sendMessageSchema,
        response: { 201: messageSchema },
      },
      // `conversation:send` in `POLICY` — isParticipant for all three roles, same subject
      // as the read.
      preHandler: authorize('conversation:send', (request) =>
        conversationsService.loadConversationSubject(conversationIdOf(request)),
      ),
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(
          await conversationsService.sendMessage(
            requireActor(request),
            request.params.conversationId,
            request.body,
          ),
        ),
  );

  /*
   * STAND-IN GATE, named rather than assumed: there is no `conversation:mark-read`
   * action in the `Action` union, and `conversation:read`
   * (`POLICY`, isParticipant) is both the closest existing gate and the
   * correct predicate — only a seated participant may move their own high-water mark,
   * and the service scopes the UPDATE to `actor.id` so passing this gate never lets one
   * participant move another's. Adding a real action would cost matrix rows in
   * apps/api/test/policy-matrix.test.ts including the denials, plus
   * `pnpm docs:permissions` and the regenerated docs/permissions.md
   * (CONTRIBUTING.md:40-46) — the repository owner's change, not this module's.
   */
  app.post(
    '/:conversationId/read',
    {
      schema: {
        params: conversationIdParamSchema,
        body: markReadSchema,
        // The refreshed conversation, so the caller's badge and the server agree in one
        // round trip rather than two.
        response: { 200: conversationSchema },
      },
      preHandler: authorize('conversation:read', (request) =>
        conversationsService.loadConversationSubject(conversationIdOf(request)),
      ),
    },
    async (request) =>
      conversationsService.markRead(
        requireActor(request),
        request.params.conversationId,
        request.body,
      ),
  );

  /*
   * BARE authorize(): `conversation:join` in `POLICY` is anonymous deny / STUDENT deny /
   * TEACHER deny
   * / ADMIN allow — "Self-joining an arbitrary thread is the whole attack. Only an admin
   * adds a participant, and only to a thread that already exists." Every cell is a
   * terminal allow/deny that reads no Subject field, so no subject loader is needed and
   * adding one would only invent a way for the gate to disagree with the policy.
   *
   * "and only to a thread that already exists" is enforced by the service, which 404s
   * an unknown conversation — the gate cannot, because it never looks one up.
   */
  app.post(
    '/:conversationId/participants',
    {
      schema: {
        params: conversationIdParamSchema,
        body: joinConversationSchema,
        response: { 200: conversationSchema },
      },
      preHandler: authorize('conversation:join'),
    },
    async (request) =>
      conversationsService.addParticipant(
        requireActor(request),
        request.params.conversationId,
        request.body,
      ),
  );

  /*
   * THE ROUTE THIS MODULE RECORDED AS MISSING, and it is the one route in it whose
   * gate reads a subject that is NOT the live participant set.
   *
   * `conversation:leave` is `isMember`, which reads `Subject.memberIds` — every seat
   * the thread has ever had, `leftAt` rows included. `loadConversationSubject` above
   * would have been the wrong loader: `isParticipant` reads `participantIds`, which is
   * the live set, so the gate would have been deciding permission from the exact
   * condition the request makes false. The second call of a double-tap, or a retry
   * after the first answer was lost, would then have been answered by a different
   * question than the first.
   *
   * NO BODY AT ALL, rather than an empty object schema. The request says one thing —
   * the thread in the path — and there is nothing optional here for `.nullish()` to
   * guard: a schema that may be absent is only ever needed because Fastify hands a
   * bodyless POST to the validator as `null` (LESSONS-LEARNED #12), and a route with
   * no body schema never reaches the validator. `leave` takes the actor from the
   * session, never from a body, because "leave" whose subject is in the payload is a
   * route that can be pointed at somebody else's seat.
   */
  app.post(
    '/:conversationId/leave',
    {
      schema: {
        params: conversationIdParamSchema,
        response: { 200: conversationSchema },
      },
      preHandler: authorize('conversation:leave', (request) =>
        conversationsService.loadConversationMembership(conversationIdOf(request)),
      ),
    },
    async (request) =>
      conversationsService.leave(requireActor(request), request.params.conversationId),
  );

  /*
   * `POST` and not `DELETE`, and not because a verb could not have been used. This is
   * a soft write: the participant row survives, carries the moment it happened, and is
   * what `addParticipant` above restores. A DELETE on `/participants/:userId` would
   * name an operation this endpoint does not perform, and the first person to read the
   * route list would reasonably assume the row is gone.
   *
   * BARE authorize(): `conversation:remove` in `POLICY` is anonymous deny / STUDENT
   * deny / TEACHER deny / ADMIN allow — every cell terminal, reading no Subject field,
   * so adding a subject loader would only invent a way for the gate to disagree with
   * the policy. It is the exact inverse of `conversation:join` above and is argued the
   * same way in `POLICY`.
   *
   * The body is `joinConversationSchema` UNCHANGED, and deliberately not a new schema:
   * both routes take one `userId` and nothing else, and a second definition of that
   * would be a second thing to keep in step. Self-removal is refused by the service,
   * not here — it is a statement about the two verbs, and the service is where the
   * write is.
   */
  app.post(
    '/:conversationId/participants/remove',
    {
      schema: {
        params: conversationIdParamSchema,
        body: joinConversationSchema,
        response: { 200: conversationSchema },
      },
      preHandler: authorize('conversation:remove'),
    },
    async (request) =>
      conversationsService.removeParticipant(
        requireActor(request),
        request.params.conversationId,
        request.body,
      ),
  );
};

export default conversationsRoutes;
