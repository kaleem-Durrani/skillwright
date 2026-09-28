import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { authorize, requireActor } from '../../plugins/auth.plugin.js';
import { validationFailed } from '../../lib/errors.js';
import * as assignmentService from './assignments.service.js';
import {
  assignmentSchema,
  assignmentSubmissionListSchema,
  createAssignmentSchema,
  gradeSubmissionSchema,
  handInBodySchema,
  idParamSchema,
  listAssignmentsQuerySchema,
  myAssignmentListSchema,
  offeringIdParamSchema,
  returnSubmissionSchema,
  submissionSchema,
  updateAssignmentSchema,
} from './assignments.schema.js';

/**
 * Re-validate a body that the ROUTE deliberately did not bind strictly.
 *
 * This exists because of LESSONS-LEARNED #24, and because the first version of this
 * module's own return route was watched failing that test while it was being written.
 *
 * Fastify runs body validation in `preValidation`, BEFORE the policy `preHandler`. So a
 * route whose body schema REQUIRES a field answers `422 VALIDATION_FAILED` to a
 * caller who sent nothing at all — including one who was never entitled to the thing.
 * That is the exact fault #24 records: a teacher who had never been entitled to an
 * enrolment POSTed with no body and was told "malformed" about a resource they were
 * never allowed to touch, so they learn the wrong thing about their own permissions.
 *
 * The fix is to bind the body `.nullish()` — which accepts the `null` Fastify hands a
 * bodyless POST — and parse it HERE, in the handler, which runs after the gate. An
 * unauthorised caller now gets the 403 the policy decided, and an authorised one who
 * really did send nothing gets a 422 with the schema's own field path.
 *
 * `.nullish()` and not `.optional()`: a bodyless POST arrives as `null`, and
 * `z.object().optional()` accepts `undefined` and never meets it (lesson 12).
 */
function parseBody<S extends z.ZodTypeAny>(schema: S, body: unknown): z.output<S> {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  throw validationFailed(
    result.error.issues.map((issue) => ({
      // The same `(root)` convention errors.plugin.ts uses for a whole-body refinement:
      // an empty zod path is the root, and `Settings.tsx` is written against it.
      path: issue.path.length > 0 ? issue.path.join('.') : '(root)',
      message: issue.message,
    })),
  );
}

/**
 * A `SubjectLoader` receives the BARE FastifyRequest (auth.plugin.ts), not the
 * type-provider-narrowed one, so `request.params` and `request.body` are `unknown`
 * there. These casts live here and nowhere else — handlers read the narrowed types.
 */
function idOf(request: FastifyRequest): string {
  return (request.params as { id: string }).id;
}

function offeringIdOfParams(request: FastifyRequest): string {
  return (request.params as { offeringId: string }).offeringId;
}

function offeringIdOfBody(request: FastifyRequest): string {
  return (request.body as { offeringId: string }).offeringId;
}

const assignmentsRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /*
   * Registered at the API root (app.ts), NOT under a single prefix, and the reason is
   * the same one attendance.routes.ts gives: a module boundary and a URL prefix are not
   * the same thing. Tasks hang off an INTAKE (`/offerings/:id/assignments`) and hand-ins
   * off a TASK and a HAND-IN (`/assignments/:id/submissions`, `/submissions/:id/grade`),
   * and spelling one module's surface across three other modules' files would scatter it.
   */

  /*
   * No `authorize('assignment:read')` here, and the reason is LESSONS-LEARNED #15
   * rather than a shortcut.
   *
   * A per-intake LIST has no single subject, and the gate with an empty one denies
   * EVERY caller including admins: `assignment:read` reads `enrollmentStatus` and
   * `courseTeacherId`, both of which are absent from an empty subject, and a rule that
   * reads an absent field must deny. That mistake has shipped six times in this
   * repository.
   *
   * So visibility is a WHERE clause instead — `visibilityWhere` in the service, which
   * mirrors the policy rows as SQL — and this route requires a session and nothing
   * more. The session requirement is `requireActor` in the handler rather than a gate,
   * and it is not decoration: `visibilityWhere` takes a non-null `Actor`, so there is
   * no anonymous branch to write, and an unsigned caller has no coursework to see in
   * any case.
   */
  app.get(
    '/offerings/:offeringId/assignments',
    {
      schema: {
        params: offeringIdParamSchema,
        response: { 200: z.array(assignmentSchema) },
      },
    },
    async (request) =>
      assignmentService.listForOffering(requireActor(request), request.params.offeringId),
  );

  /*
   * The student's own list, and the endpoint the one-query claim belongs to.
   *
   * Self-scoping for the same reason `GET /enrollments` is: the rows are the caller's
   * own, there is no subject to gate on, and `listMine`'s WHERE is the mirror of
   * `enrolledApproved`. A teacher or an admin is answered `[]` rather than a 403 — they
   * have no enrolment of their own, and the per-intake list above is their reader.
   */
  app.get(
    '/assignments/mine',
    {
      schema: {
        querystring: listAssignmentsQuerySchema,
        response: { 200: myAssignmentListSchema },
      },
    },
    async (request) => assignmentService.listMine(requireActor(request), request.query),
  );

  /*
   * Setting work. The subject is the INTAKE NAMED IN THE BODY — there is no row yet,
   * and `ownsCourse` is what stops a teacher setting a task on a colleague's intake by
   * guessing an offeringId. The actor travels with the loader rather than being looked
   * up again inside it, so `enrollmentStatus` is the REQUESTING caller's and not an
   * arbitrary row's (actor.ts).
   */
  app.post(
    '/offerings/:offeringId/assignments',
    {
      schema: {
        params: offeringIdParamSchema,
        body: createAssignmentSchema,
        response: { 201: assignmentSchema },
      },
      preHandler: authorize('assignment:create', (request) =>
        assignmentService.loadOfferingSubject(offeringIdOfParams(request), request.actor),
      ),
    },
    async (request, reply) =>
      reply.status(201).send(await assignmentService.create(requireActor(request), request.body)),
  );

  /*
   * The whole class. Gated on `submission:read` with the ASSIGNMENT's subject, which
   * carries no `studentId` — so a student's own `isEnrolledStudent` cell reads an absent
   * field and refuses, even for a student who is seated in that very course.
   *
   * That is deliberate, and it is the same shape `attendance:read` uses for a whole
   * register: a class list is not assembled one personal row at a time, and the field
   * that would let it be is exactly the field a subject without one lacks. It is
   * pinned by a test rather than left to this comment.
   */
  app.get(
    '/assignments/:id/submissions',
    {
      schema: {
        params: idParamSchema,
        response: { 200: assignmentSubmissionListSchema },
      },
      preHandler: authorize('submission:read', (request) =>
        assignmentService.loadAssignmentClassSubject(idOf(request)),
      ),
    },
    async (request) => assignmentService.listSubmissions(request.params.id),
  );

  /*
   * A hand-in. The gate is `assignment:read` against the TASK, which is the student
   * half of this feature and is exactly `enrolledApproved`: a student with no APPROVED
   * seat is refused here, and so is one whose request is still PENDING.
   *
   * A TEACHER passes this gate — `ownsCourse` — and is then refused by the service,
   * because `seatForHandIn` looks for an APPROVED seat THEY hold and there is none. That
   * is a data fact rather than a permission, and it is why the service owns it: the
   * alternative was a fifth action for `submission:create`, whose STUDENT cell would
   * have had to be a second spelling of `enrolledApproved` and whose TEACHER cell a
   * flat `deny` — a rule this repository does not have, and would have to invent to
   * say something a 409 already says truthfully.
   */
  app.post(
    '/assignments/:id/submissions',
    {
      schema: {
        params: idParamSchema,
        body: handInBodySchema,
        response: { 201: submissionSchema },
      },
      preHandler: authorize('assignment:read', (request) =>
        assignmentService.loadAssignmentSubject(idOf(request), request.actor),
      ),
    },
    // The path owns the assignment, so the body is `{ uploadId }` and NOTHING else: a
    // second source for the same id is a second thing that can disagree, and the id the
    // policy just decided on is the one the row must carry. The body is REQUIRED here
    // (not `.nullish()`) because a hand-in without a file is not a hand-in —
    // `Submission.uploadId` is a non-nullable relation for the same reason.
    async (request, reply) =>
      reply.status(201).send(
        await assignmentService.createSubmission(requireActor(request), {
          assignmentId: request.params.id,
          uploadId: request.body.uploadId,
        }),
      ),
  );

  /*
   * PATCH and DELETE ride `assignment:create`, and the argument for collapsing three
   * verbs onto one is written out at the rule itself: the authority to SET work on an
   * intake is the authority to correct it and to withdraw it.
   */
  app.patch(
    '/assignments/:id',
    {
      schema: {
        params: idParamSchema,
        body: updateAssignmentSchema.nullish(),
        response: { 200: assignmentSchema },
      },
      preHandler: authorize('assignment:create', (request) =>
        assignmentService.loadAssignmentSubject(idOf(request), request.actor),
      ),
    },
    async (request) =>
      assignmentService.update(
        requireActor(request),
        request.params.id,
        parseBody(updateAssignmentSchema, request.body),
      ),
  );

  /*
   * SOFT delete — the service stamps `deletedAt` and every read in it filters the
   * column. A hard delete would cascade the hand-ins away, and a class's graded work
   * outlives the task that collected it.
   */
  app.delete(
    '/assignments/:id',
    {
      schema: { params: idParamSchema },
      preHandler: authorize('assignment:create', (request) =>
        assignmentService.loadAssignmentSubject(idOf(request), request.actor),
      ),
    },
    async (request, reply) => {
      await assignmentService.remove(request.params.id);
      return reply.status(204).send();
    },
  );

  /*
   * Grading and returning. Two URLs, one action, and the reason is the rule quoted at
   * `enrollment:withdraw` — "separate verb, separate audit action". A status column
   * written by two different URLs carries one audit action, so the trail could not
   * distinguish "I marked this" from "I sent this back" and a reader would be left
   * diffing two JSON blobs.
   *
   * `gradeSubmissionSchema` carries BOTH shapes: a null score with mandatory feedback
   * IS the return, and the schema is the single place that says so. `/return` binds the
   * narrower schema anyway, because the SPA's return control must not be able to send a
   * mark, and a client that could is a client that will.
   */
  app.post(
    '/submissions/:id/grade',
    {
      schema: {
        params: idParamSchema,
        body: gradeSubmissionSchema.nullish(),
        response: { 200: submissionSchema },
      },
      preHandler: authorize('submission:grade', (request) =>
        assignmentService.loadSubmissionSubject(idOf(request)),
      ),
    },
    async (request) =>
      assignmentService.grade(
        requireActor(request),
        request.params.id,
        parseBody(gradeSubmissionSchema, request.body),
      ),
  );

  app.post(
    '/submissions/:id/return',
    {
      schema: {
        params: idParamSchema,
        body: returnSubmissionSchema.nullish(),
        response: { 200: submissionSchema },
      },
      preHandler: authorize('submission:grade', (request) =>
        assignmentService.loadSubmissionSubject(idOf(request)),
      ),
    },
    async (request) =>
      assignmentService.returnWork(
        requireActor(request),
        request.params.id,
        parseBody(returnSubmissionSchema, request.body),
      ),
  );
};

export default assignmentsRoutes;
