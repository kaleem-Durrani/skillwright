import { AsyncLocalStorage } from 'node:async_hooks';
import { pino, type Logger } from 'pino';
import { env, isTest } from '../env.js';

/**
 * Structurally a superset of `AuditContext` from @skillwright/db, so the same object
 * can be handed to `withAuditContext` and every audit row inherits the request's
 * actor, IP and requestId without a service ever passing them.
 */
export interface RequestContext {
  requestId: string;
  /** Filled in by auth.plugin once the session resolves; mutated in place on purpose. */
  actorId: string | null;
  ip: string | null;
  userAgent: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Request scope for everything downstream of the HTTP hook chain. Queue workers and
 * service functions read it rather than threading a requestId through 40 signatures.
 */
export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Anything matching these paths is replaced before serialisation. The list is
 * deliberately over-broad: a redacted field costs a debugging round-trip, a leaked
 * session cookie costs an incident.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.token',
  '*.code',
  '*.email',
  'password',
  'token',
  'email',
  'body.password',
  'body.email',
  'body.token',
  'body.code',
  'totpSecret',
  'passwordHash',
];

export const baseLogger: Logger = pino({
  level: isTest ? 'silent' : env.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  base: { service: 'api', deployEnv: env.DEPLOY_ENV },
  // Bind the ambient requestId onto every line, including lines emitted by code that
  // has no access to the Fastify request object.
  mixin() {
    const ctx = storage.getStore();
    return ctx ? { requestId: ctx.requestId, actorId: ctx.actorId ?? undefined } : {};
  },
  ...(env.NODE_ENV === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l' },
        },
      }
    : {}),
});
