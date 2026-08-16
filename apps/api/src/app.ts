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

  await app.ready();
  return app;
}
