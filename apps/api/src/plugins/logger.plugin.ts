import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { withAuditContext } from '@skillwright/db';
import { getRequestContext, runWithRequestContext, type RequestContext } from '../lib/logger.js';

/**
 * Establishes the AsyncLocalStorage scope for the whole request, so a log line
 * emitted six awaits deep in a service still carries the requestId, and so the
 * Prisma audit extension can stamp rows without every caller threading the actor
 * through its signature.
 *
 * The wrapping works because `done` is called INSIDE `run`: Fastify continues the
 * hook chain synchronously from that call, so every later hook and the handler
 * itself inherit both stores.
 */
const loggerPlugin: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', (request, reply, done) => {
    const context: RequestContext = {
      requestId: request.id,
      actorId: null,
      ip: request.ip ?? null,
      userAgent: request.headers['user-agent']?.slice(0, 512) ?? null,
    };
    reply.header('x-request-id', context.requestId);

    runWithRequestContext(context, () => {
      withAuditContext(context, done);
    });
  });

  app.addHook('onResponse', (request, reply, done) => {
    request.log.info(
      {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
        actorId: getRequestContext()?.actorId ?? undefined,
      },
      'request completed',
    );
    done();
  });
};

export default fp(loggerPlugin, { name: 'logger' });
