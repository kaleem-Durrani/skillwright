import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { withAuditContext } from '@skillwright/db';
import { env } from '../env.js';
import {
  baseLogger,
  getRequestContext,
  runWithRequestContext,
  type RequestContext,
} from '../lib/logger.js';

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
        // The ROUTE PATTERN, not the URL. `/api/v1/courses/:courseId` is the unit an
        // operator aggregates on and the unit a slow query is attributable to;
        // `request.url` produces one distinct string per row id, so a 200-response
        // log cannot be counted, grouped or alerted on at all.
        route: request.routeOptions?.url ?? 'unmatched',
        // The PATH, with the query string dropped. `?q=` carries whatever the user
        // typed into a search box and other endpoints take identifiers in it, so the
        // old line wrote user content into the log stream 300 times a minute; the
        // route pattern above is what you actually search by, and a body/query that
        // matters is in the handler's own line.
        path: request.url.split('?')[0],
        statusCode: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
        actorId: getRequestContext()?.actorId ?? undefined,
      },
      'request completed',
    );
    done();
  });

  /*
   * Who is speaking.
   *
   * Phase 9 added this because the answer to "which process wrote this" is otherwise
   * a guess: several containers write to one log stream, `pnpm dev` runs two, and
   * nothing in the payload distinguishes them — `service` and `deployEnv` are the same
   * on all of them (`base` in logger.ts). A PID, the port and the Node version are the
   * three facts that make a stack trace from a crashed worker matchable to a restart,
   * and they are known once per process rather than once per request.
   */
  app.log.info(
    {
      pid: process.pid,
      nodeVersion: process.version,
      port: env.PORT,
      host: env.HOST,
      nodeEnv: env.NODE_ENV,
      deployEnv: env.DEPLOY_ENV,
      logLevel: env.LOG_LEVEL,
    },
    'api process starting',
  );
};

export default fp(loggerPlugin, { name: 'logger' });
