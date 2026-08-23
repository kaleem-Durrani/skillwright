import type { FastifyError, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { Prisma } from '@skillwright/db';
import { API_BASE_PATH, type ErrorCode } from '@skillwright/shared';
import {
  PROBLEM_CONTENT_TYPE,
  problemTypeUri,
  type FieldError,
  type Problem,
} from '@skillwright/shared';
import { AppError, isAppError } from '../lib/errors.js';
// `WEB_DIST_DIR` decides whether an unmatched GET is a 404 or the SPA shell.
import { env } from '../env.js';

function zodFieldErrors(error: ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

/**
 * Fastify's own validation failures arrive as `error.validation`, which is either
 * AJV-shaped or (with fastify-type-provider-zod) carries the original ZodError.
 */
function fastifyValidationErrors(error: FastifyError): FieldError[] {
  const validation = error.validation ?? [];
  return validation.map((item) => {
    /*
     * Strip FIRST, then decide whether anything is left — the two used to happen in
     * the other order, and it made the `(root)` fallback unreachable.
     *
     * A whole-body refinement (`updateResourceSchema`'s "provide at least one field",
     * `updateUserSchema`'s empty-body refusal) has an empty zod path, which
     * fastify-type-provider-zod renders as the instancePath `'/'` — length 1, so the
     * old `instancePath.length > 0` test took the first branch and stripped it to the
     * empty string. `PATCH /resources/:id` with `{}` answered
     * `errors: [{ path: '', … }]`, verified against a running server on 2026-08-23.
     *
     * That made the same failure report two different paths depending on where it was
     * raised: `zodFieldErrors` above says `(root)` for a service-thrown ZodError, this
     * said `''` for the identical refinement on a route schema. Settings.tsx:67-70 is
     * written against `(root)`.
     *
     * The AJV shape is unaffected: a missing required property carries instancePath
     * `''` and the name in `params.missingProperty`, which is still what it falls to.
     */
    const dotted =
      typeof item.instancePath === 'string'
        ? item.instancePath.replace(/^\//, '').replaceAll('/', '.')
        : '';
    const missing = item.params?.['missingProperty'] as string | undefined;

    return {
      path: dotted !== '' ? dotted : (missing ?? '(root)'),
      message: item.message ?? 'Invalid value',
    };
  });
}

function translate(error: unknown): AppError {
  if (isAppError(error)) return error;

  if (error instanceof ZodError) {
    return new AppError('VALIDATION_FAILED', 422, 'Request validation failed', {
      errors: zodFieldErrors(error),
      cause: error,
    });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002':
        return new AppError('CONFLICT', 409, 'Conflicting state', {
          detail: 'A record with these unique values already exists',
          cause: error,
        });
      case 'P2025':
        return new AppError('NOT_FOUND', 404, 'Resource not found', { cause: error });
      case 'P2003':
        return new AppError('CONFLICT', 409, 'Conflicting state', {
          detail: 'A referenced record is missing or still referenced elsewhere',
          cause: error,
        });
      default:
        return new AppError('INTERNAL', 500, 'Internal server error', { cause: error });
    }
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    return new AppError('INTERNAL', 500, 'Internal server error', { cause: error });
  }

  // Narrowing by shape: Fastify's own errors are plain Errors carrying `code`,
  // `statusCode` and sometimes `validation`, with no class to instanceof against.
  const fastifyError = error as Partial<FastifyError>;

  if (fastifyError.validation) {
    return new AppError('VALIDATION_FAILED', 422, 'Request validation failed', {
      errors: fastifyValidationErrors(fastifyError as FastifyError),
      cause: error,
    });
  }

  switch (fastifyError.code) {
    case 'FST_ERR_CTP_BODY_TOO_LARGE':
    case 'FST_REQ_FILE_TOO_LARGE':
      return new AppError('PAYLOAD_TOO_LARGE', 413, 'Payload too large', { cause: error });
    case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
    case 'FST_ERR_CTP_EMPTY_JSON_BODY':
      return new AppError('UNSUPPORTED_MEDIA_TYPE', 415, 'Unsupported media type', {
        cause: error,
      });
    case 'FST_ERR_CTP_INVALID_JSON_BODY':
      return new AppError('VALIDATION_FAILED', 422, 'Request validation failed', {
        detail: 'Request body is not valid JSON',
        cause: error,
      });
    default:
      break;
  }

  const status = typeof fastifyError.statusCode === 'number' ? fastifyError.statusCode : 500;
  if (status === 429) {
    return new AppError('RATE_LIMITED', 429, 'Too many requests', { cause: error });
  }
  if (status === 404) {
    return new AppError('NOT_FOUND', 404, 'Resource not found', { cause: error });
  }
  /*
   * A thrown 4xx keeps its own status and gets the code that matches it.
   *
   * This used to collapse EVERY 4xx that was not 404 or 429 into
   * `VALIDATION_FAILED` 422 — so a plugin throwing 401, 403 or 409 told the client its
   * request had failed validation, at the wrong status, with nothing naming the real
   * reason. Found when @fastify/static threw a 403 from inside its send stream and the
   * response came back `{"code":"VALIDATION_FAILED","status":422}` for `GET /`.
   *
   * Anything outside this map keeps 422: the ErrorCode union is closed and shared with
   * the SPA (problem.ts's ERROR_COPY renders by code), so inventing a code here would
   * mean a string no client can render. 405 and 406 have no honest member yet, and a
   * wrong-but-renderable answer beats an unrenderable one.
   */
  const CODE_FOR_STATUS = {
    401: 'UNAUTHENTICATED',
    403: 'FORBIDDEN',
    409: 'CONFLICT',
    413: 'PAYLOAD_TOO_LARGE',
    415: 'UNSUPPORTED_MEDIA_TYPE',
  } as const satisfies Partial<Record<number, ErrorCode>>;

  if (Object.prototype.hasOwnProperty.call(CODE_FOR_STATUS, status)) {
    const code = CODE_FOR_STATUS[status as keyof typeof CODE_FOR_STATUS];
    return new AppError(code, status, 'Request refused', { cause: error });
  }
  if (status >= 400 && status < 500) {
    return new AppError('VALIDATION_FAILED', 422, 'Request validation failed', { cause: error });
  }
  return new AppError('INTERNAL', 500, 'Internal server error', { cause: error });
}

/**
 * Single exit point for every failure. Stack traces are never serialised — not in
 * development either, because "it only leaks in dev" is how a debug flag ends up in
 * production. The stack goes to the log, where the requestId ties it back.
 */
const errorsPlugin: FastifyPluginAsync = async (app) => {
  app.setErrorHandler((error: unknown, request: FastifyRequest, reply: FastifyReply) => {
    const appError = translate(error);
    const logPayload = { err: error, code: appError.code, status: appError.status };

    if (appError.status >= 500) {
      request.log.error(logPayload, 'request failed');
    } else {
      request.log.warn(logPayload, 'request rejected');
    }

    const problem: Problem = {
      type: problemTypeUri(appError.code),
      title: appError.message,
      status: appError.status,
      code: appError.code,
      instance: request.url,
      requestId: request.id,
      ...(appError.detail ? { detail: appError.detail } : {}),
      ...(appError.errors?.length ? { errors: appError.errors } : {}),
    };

    if (appError.headers) {
      for (const [name, value] of Object.entries(appError.headers)) reply.header(name, value);
    }

    return reply.status(appError.status).type(PROBLEM_CONTENT_TYPE).send(problem);
  });

  /*
   * ONE not-found handler, because Fastify allows exactly one per prefix — a second
   * `setNotFoundHandler` at '/' throws at boot, which is how the SPA fallback first
   * tried to live in app.ts and stopped the container from starting at all.
   *
   * So this handler answers both questions, and the order matters:
   *
   *   /api/v1/* and /assets/*  -> a real 404, as problem+json. Answering an unmatched
   *                              API path with HTML hands a document to a `fetch`
   *                              expecting JSON, and the client reports a parse error
   *                              instead of "that endpoint does not exist". A missing
   *                              asset is the same trap: a 200 of HTML at
   *                              /assets/index-abc123.js is a broken page that looks
   *                              like a working one.
   *   anything else            -> index.html, when this process is serving the SPA.
   *                              A browser asking for /courses/01J… directly — a
   *                              refresh, a bookmark, a pasted link — must reach the
   *                              client router rather than this handler's opinion.
   *
   * `env.WEB_DIST_DIR` is set only by the production image. In development Vite serves
   * the SPA and proxies /api here, so every path this process does not recognise is a
   * genuine 404 and the second branch never runs.
   */
  app.setNotFoundHandler((request, reply) => {
    const servingSpa = env.WEB_DIST_DIR !== undefined;
    const wantsApi = request.url.startsWith(API_BASE_PATH) || request.url.startsWith('/assets/');

    if (servingSpa && !wantsApi && request.method === 'GET') {
      return (
        reply
          .status(200)
          .type('text/html; charset=utf-8')
          // The HTML must never be cached: a deploy would otherwise leave browsers
          // holding a document that references chunks which no longer exist. The
          // fingerprinted assets it points at are cached for a year, by the static
          // plugin in app.ts.
          .header('cache-control', 'no-cache')
          // `cacheControl: false`, or the registration's maxAge/immutable — correct for
          // fingerprinted assets — overwrite the header above and the shell goes out
          // cached for a year. Measured on the running image before this was added.
          .sendFile('index.html', { cacheControl: false })
      );
    }

    const problem: Problem = {
      type: problemTypeUri('NOT_FOUND'),
      title: 'Route not found',
      status: 404,
      code: 'NOT_FOUND',
      instance: request.url,
      requestId: request.id,
    };
    return reply.status(404).type(PROBLEM_CONTENT_TYPE).send(problem);
  });
};

export default fp(errorsPlugin, { name: 'errors' });
