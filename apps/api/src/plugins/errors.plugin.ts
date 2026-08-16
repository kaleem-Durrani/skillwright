import type { FastifyError, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { Prisma } from '@skillwright/db';
import {
  PROBLEM_CONTENT_TYPE,
  problemTypeUri,
  type FieldError,
  type Problem,
} from '@skillwright/shared';
import { AppError, isAppError } from '../lib/errors.js';

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
  return validation.map((item) => ({
    path:
      typeof item.instancePath === 'string' && item.instancePath.length > 0
        ? item.instancePath.replace(/^\//, '').replaceAll('/', '.')
        : ((item.params?.['missingProperty'] as string | undefined) ?? '(root)'),
    message: item.message ?? 'Invalid value',
  }));
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

  app.setNotFoundHandler((request, reply) => {
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
