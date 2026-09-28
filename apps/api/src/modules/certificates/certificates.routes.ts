import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { authorize, requireActor } from '../../plugins/auth.plugin.js';
import { authIpRateLimit } from '../../plugins/ratelimit.plugin.js';
import { notFound, validationFailed } from '../../lib/errors.js';
import * as certificateService from './certificates.service.js';
import {
  certificateListSchema,
  certificateSchema,
  createQualificationSchema,
  downloadUrlResponseSchema,
  idParamSchema,
  issueCertificateSchema,
  listCertificatesQuerySchema,
  qualificationListSchema,
  qualificationSchema,
  referenceParamSchema,
  revokeCertificateSchema,
  verifyResultSchema,
} from './certificates.schema.js';
import type { IssueCertificateInput, RevokeCertificateInput } from './certificates.schema.js';

/**
 * A `SubjectLoader` receives the BARE FastifyRequest (auth.plugin.ts), not the
 * type-provider-narrowed one, so `request.params` and `request.body` are `unknown`
 * there. These casts live here and nowhere else — handlers read the narrowed types.
 */
function idOf(request: FastifyRequest): string {
  return (request.params as { id: string }).id;
}

/**
 * The seat named in an issue body, or `undefined` when there is no body at all.
 *
 * `undefined` and NOT a throw and NOT a property access on a possibly-null value. This
 * runs inside the policy `preHandler`, which runs BEFORE the body is parsed precisely so
 * that the body is never the thing that decides whether a caller is entitled — so it has
 * to survive a request that carries nothing. Returning `undefined` hands the loader a
 * row it cannot find, the subject comes back undefined, and every role rule that reads
 * a field denies. A `TypeError` here would be a 500 on a request the caller had no
 * business making.
 */
function enrollmentIdOfBody(request: FastifyRequest): string | undefined {
  const body = request.body as { enrollmentId?: unknown } | null | undefined;
  return typeof body?.enrollmentId === 'string' ? body.enrollmentId : undefined;
}

const certificatesRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /*
   * Registered at the API root, not under a `/certificates` prefix, for one reason: the
   * catalogue routes hang off `/qualifications` and the verify route has to be reachable
   * at the shape a QR code on a printout can carry. Spelling one module's surface across
   * two prefixes is what `attendance.routes.ts` and `assignments.routes.ts` already
   * declined to do.
   */

  /*
   * THE PUBLIC ROUTE. Everything about it is argued at `verify` in the service and at
   * `certificate:verify` in policy.ts; what is left here is the transport-level
   * scrutiny, and there is exactly one decision on this route that is not "return the
   * row".
   *
   * `authIpRateLimit` IS the answer to "no rate-limit exemption you have not thought
   * about": there is no exemption. This route takes the SAME strict per-IP bucket the
   * credential routes take — 20 requests a minute by default, against the global 300 —
   * because the threat is the same one: a host walking one credential space very fast
   * while the per-account bucket it would otherwise hit does not exist, because there
   * IS no account. Reusing the bucket rather than adding a `RATE_LIMIT_VERIFY_*` pair
   * is deliberate too: two constants for one threat is one more thing an operator has
   * to set correctly, and the number that matters here is "tighter than global", which
   * both constants already are.
   *
   * The `authorize` call is NOT decoration even though the cell is `allow` for every
   * caller. It is what puts the action in the generated permissions matrix, in
   * `ANONYMOUS_ALLOWED`, and in the state gates: a SUSPENDED user presenting a live
   * cookie to this route is refused by `status:SUSPENDED` before the role rule is
   * consulted, and an MFA_PENDING session is refused too. A route with no gate at all
   * inherits neither.
   */
  app.get(
    '/certificates/verify/:reference',
    {
      /*
       * `config:`, not a spread at the top level of the route options — which is what
       * the first version of this route did, and which is silently ignored by Fastify.
       * The symptom was the whole point of this route going unexamined: the limiter kept
       * answering with the GLOBAL bucket's headers (limit 300, not 20) and wrote no
       * per-IP key at all. Nothing threw, the route worked, and the one claim this
       * comment makes was false. `auth.routes.ts` is the working spelling.
       */
      config: authIpRateLimit,
      schema: {
        params: referenceParamSchema,
        response: { 200: verifyResultSchema },
      },
      preHandler: authorize('certificate:verify'),
    },
    async (request) => {
      const result = await certificateService.verify(request.params.reference);
      // 404 for a reference nobody holds. The endpoint's contract says so, and the
      // service explains why the 128-bit reference — rather than an indistinguishable
      // status — is what actually does the work here.
      if (!result) throw notFound('Certificate');
      return result;
    },
  );

  /*
   * The holder's own list, and the same route a teacher reads with `?studentId=`.
   *
   * NO SUBJECT GATE, on LESSONS-LEARNED #15: a list has no single subject, and
   * `certificate:read` reads `studentId` and `courseTeacherId`, both absent from an
   * empty one, so a bare `authorize()` here would refuse every caller including admins.
   * Visibility is `visibilityWhere` in the service, which mirrors the policy rows as
   * SQL and is the only thing narrowing the result.
   *
   * `requireActor` in the handler rather than a gate, and it is not decoration:
   * `visibilityWhere` takes a non-null `Actor`, and an unsigned caller has no
   * certificates to see in any case.
   */
  app.get(
    '/certificates',
    {
      schema: {
        querystring: listCertificatesQuerySchema,
        response: { 200: certificateListSchema },
      },
    },
    async (request) =>
      certificateService.list(requireActor(request), {
        studentId: request.query.studentId ?? null,
      }),
  );

  app.get(
    '/qualifications',
    {
      schema: { response: { 200: qualificationListSchema } },
      // Gated even though every cell but the anonymous one is `allow`: the anonymous
      // cell is `deny`, and a route with no `authorize` at all inherits NO state gates
      // either — a suspended account presenting a live cookie would be served the whole
      // catalogue. The first version of this route had no `preHandler` and its own test
      // caught it, which is the only reason this line is here.
      preHandler: authorize('qualification:read'),
    },
    async () => certificateService.listQualifications(),
  );

  /*
   * Adding a standard to the catalogue. Subject-free for the reason `user:create` is:
   * there is no row to load a subject for, and the decision is about the caller's role
   * alone.
   */
  app.post(
    '/qualifications',
    {
      schema: {
        body: createQualificationSchema,
        response: { 201: qualificationSchema },
      },
      preHandler: authorize('qualification:create'),
    },
    async (request, reply) =>
      reply.status(201).send(await certificateService.createQualification(request.body)),
  );

  /*
   * The download. Gated on `certificate:read` rather than a fifth verb — the reasoning
   * is written at `downloadUrlFor` and at `resource:download` in policy.ts: the two
   * answers coincide here because anonymous is denied outright.
   */
  app.get(
    '/certificates/:id/download',
    {
      schema: {
        params: idParamSchema,
        response: { 200: downloadUrlResponseSchema },
      },
      preHandler: authorize('certificate:read', (request) =>
        certificateService.loadCertificateSubject(idOf(request)),
      ),
    },
    async (request) => certificateService.downloadUrlFor(request.params.id),
  );

  /*
   * Issuing. The gate is decided against the SEAT named in the body, so an unauthorised
   * caller is refused before this module says anything about whether the seat is
   * COMPLETED — and the refusal order matters: a 403 to somebody who was never entitled
   * is the correct answer, and a 409 about a seat they may not even see would teach
   * them the wrong thing about their own permissions.
   *
   * THE BODY IS NOT BOUND, and this is the fourth time this repository has had to be
   * told. Fastify validates in `preValidation`, BEFORE the policy `preHandler`, so a
   * route with a required body schema answers `422 VALIDATION_FAILED` to a caller who
   * was never entitled to the certificate — telling them their request was malformed
   * when what actually happened is that they may not touch it. LESSONS-LEARNED #24,
   * watched failing here: the first version of this route bound
   * `body: issueCertificateSchema` and its own test suite caught it on the first run.
   *
   * The consequence for a route whose SUBJECT lives in the body is that the loader has
   * to cope with a body that is not there. `enrollmentIdOfBody` returns `undefined`
   * rather than dereferencing `null`, and `loadEnrollmentSubject(undefined)` refuses the
   * row — so the policy denies on an absent `courseTeacherId` and the caller gets the
   * 403, which is the right answer in the safe direction.
   */
  app.post(
    '/certificates',
    {
      schema: {
        response: { 201: certificateSchema },
      },
      preHandler: authorize('certificate:issue', (request) =>
        certificateService.loadEnrollmentSubject(enrollmentIdOfBody(request)),
      ),
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(await certificateService.issue(requireActor(request), parseIssueBody(request.body))),
  );

  /*
   * Withdrawing. Admin only, and the narrowest cell in the policy table: the reasoning
   * is at `certificate:revoke` there, and the short version is that a revocation is
   * public — this module's own verify route reports it to anybody holding the reference.
   *
   * The body is not bound here either, for the reason spelled out on the route above. A
   * revocation with no reason must be a 422 for an ADMIN and a 403 for a teacher, and
   * the only way both are true is for the decision to happen after the gate.
   */
  app.post(
    '/certificates/:id/revoke',
    {
      schema: {
        params: idParamSchema,
        response: { 200: certificateSchema },
      },
      preHandler: authorize('certificate:revoke', (request) =>
        certificateService.loadCertificateSubject(idOf(request)),
      ),
    },
    async (request) =>
      certificateService.revoke(
        requireActor(request),
        request.params.id,
        parseRevokeBody(request.body),
      ),
  );
};

/**
 * Re-validate a body the ROUTE deliberately did not bind strictly.
 *
 * This is `assignments.routes.ts`'s `parseBody`, for the reason its own header gives and
 * because the two bodies this module refuses to bind are the two whose refusal is
 * load-bearing.
 *
 * The two thin wrappers exist so each call site keeps its concrete input type, and both
 * of them normalise a MISSING body to `{}` before parsing.
 *
 * That normalisation is the difference between an error a caller can act on and one they
 * cannot. Fastify hands a bodyless POST to the handler as `null`, and `z.object({...})`
 * reports `null` as a single root-level issue — `Expected object, received null` at
 * `(root)` — which says nothing about WHICH field was missing. Parsing `{}` instead makes
 * zod report `reason: Required` and `enrollmentId: Required`, which is the whole point of
 * a field-level 422. It is safe for exactly the reason the two bodies are not bound: this
 * runs after the policy gate, so a caller who was never entitled has already been given
 * their 403 and this answer is for somebody who is.
 *
 * An empty zod path is the root, and `(root)` is the convention `errors.plugin.ts` and
 * `Settings.tsx` are both written against.
 */
function parseBody<S extends z.ZodTypeAny>(schema: S, body: unknown): z.output<S> {
  const parsed = schema.safeParse(body ?? {});
  if (parsed.success) return parsed.data;
  throw validationFailed(
    parsed.error.issues.map((issue) => ({
      path: issue.path.length > 0 ? issue.path.join('.') : '(root)',
      message: issue.message,
    })),
  );
}

function parseIssueBody(body: unknown): IssueCertificateInput {
  return parseBody(issueCertificateSchema, body);
}

function parseRevokeBody(body: unknown): RevokeCertificateInput {
  return parseBody(revokeCertificateSchema, body);
}

export default certificatesRoutes;
