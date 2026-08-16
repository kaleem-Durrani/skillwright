import type { IncomingMessage, ServerResponse } from 'node:http';
import Fastify, { type FastifyInstance, type RawServerDefault } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import compress from '@fastify/compress';
import multipart from '@fastify/multipart';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { ulid } from 'ulid';
import { API_BASE_PATH } from '@skillwright/shared';
import { env } from './env.js';
import { baseLogger } from './lib/logger.js';
import loggerPlugin from './plugins/logger.plugin.js';
import prismaPlugin from './plugins/prisma.plugin.js';
import redisPlugin from './plugins/redis.plugin.js';
import ratelimitPlugin from './plugins/ratelimit.plugin.js';
import errorsPlugin from './plugins/errors.plugin.js';
import csrfPlugin from './plugins/csrf.plugin.js';
import authPlugin from './plugins/auth.plugin.js';
import healthRoutes from './routes/health.js';
import authRoutes from './modules/auth/auth.routes.js';
import departmentsRoutes from './modules/departments/departments.routes.js';
import coursesRoutes from './modules/courses/courses.routes.js';
import enrollmentsRoutes from './modules/enrollments/enrollments.routes.js';
import usersRoutes from './modules/users/users.routes.js';
import conversationsRoutes from './modules/conversations/conversations.routes.js';
import notificationsRoutes from './modules/notifications/notifications.routes.js';
import dashboardRoutes from './modules/dashboard/dashboard.routes.js';
import adminRoutes from './modules/admin/admin.routes.js';
import auditRoutes from './modules/audit/audit.routes.js';

/** Re-exported so route modules never spell the version prefix themselves. */
export const API_PREFIX = API_BASE_PATH;

const ONE_MEGABYTE = 1024 * 1024;

/**
 * The concrete instance type this app builds.
 *
 * The bare `FastifyInstance` default is NOT this type: passing `loggerInstance`
 * pins the logger generic to pino's `Logger` (which has `msgPrefix`, absent from
 * `FastifyBaseLogger`) and `.withTypeProvider<ZodTypeProvider>()` pins the type
 * provider. Under `exactOptionalPropertyTypes` those two generics are invariant,
 * so annotating the builder as plain `FastifyInstance` is a type error rather
 * than a widening. Anything that holds an instance built here — `main.ts`, the
 * integration tests — should name this type.
 */
export type AppInstance = FastifyInstance<
  RawServerDefault,
  IncomingMessage,
  ServerResponse<IncomingMessage>,
  typeof baseLogger,
  ZodTypeProvider
>;

/**
 * Returns a fully wired but unlistened instance, so integration tests exercise the
 * real hook chain through `app.inject()` instead of a hand-assembled subset of it.
 */
export async function buildApp(): Promise<AppInstance> {
  const app = Fastify({
    loggerInstance: baseLogger,
    // Fastify's built-in per-request log lines are replaced by the pair emitted in
    // logger.plugin, which carry the ULID requestId and the resolved actor.
    disableRequestLogging: true,
    genReqId: () => ulid(),
    trustProxy: env.TRUST_PROXY_HOPS > 0 ? env.TRUST_PROXY_HOPS : false,
    bodyLimit: ONE_MEGABYTE,
    ajv: { customOptions: { removeAdditional: false } },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet, {
    // The API returns JSON; the document CSP belongs to whatever serves index.html.
    // A guessed CSP here would break the SPA in a way that only shows up in prod.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
    hsts: env.DEPLOY_ENV === 'production' ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });

  await app.register(cors, {
    origin: env.ALLOWED_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    maxAge: 600,
  });

  await app.register(compress, { global: true, threshold: 1024, encodings: ['br', 'gzip'] });
  await app.register(cookie, {});
  await app.register(multipart, {
    limits: { fileSize: 50 * ONE_MEGABYTE, files: 1, fields: 20 },
  });

  // Order matters: context first, then infrastructure, then the error handler, then
  // the guards that may throw, then routes.
  await app.register(loggerPlugin);
  await app.register(prismaPlugin);
  await app.register(redisPlugin);
  await app.register(errorsPlugin);
  await app.register(ratelimitPlugin);
  await app.register(csrfPlugin);
  await app.register(authPlugin);

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: `${API_PREFIX}/auth` });
  await app.register(departmentsRoutes, { prefix: `${API_PREFIX}/departments` });
  await app.register(coursesRoutes, { prefix: `${API_PREFIX}/courses` });
  await app.register(enrollmentsRoutes, { prefix: `${API_PREFIX}/enrollments` });
  await app.register(usersRoutes, { prefix: `${API_PREFIX}/users` });
  await app.register(conversationsRoutes, { prefix: `${API_PREFIX}/conversations` });
  await app.register(notificationsRoutes, { prefix: `${API_PREFIX}/notifications` });
  await app.register(dashboardRoutes, { prefix: `${API_PREFIX}/dashboard` });
  await app.register(adminRoutes, { prefix: `${API_PREFIX}/admin` });
  // `audit-events`, not `audit`: that is the path AdminOverview.tsx already calls.
  await app.register(auditRoutes, { prefix: `${API_PREFIX}/audit-events` });

  await app.ready();
  return app;
}
