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
import resourcesRoutes from './modules/resources/resources.routes.js';
import announcementsRoutes from './modules/announcements/announcements.routes.js';
import commentsRoutes from './modules/comments/comments.routes.js';
import uploadsRoutes from './modules/uploads/uploads.routes.js';
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
  await app.register(resourcesRoutes, { prefix: `${API_PREFIX}/resources` });
  await app.register(announcementsRoutes, { prefix: `${API_PREFIX}/announcements` });
  await app.register(commentsRoutes, { prefix: `${API_PREFIX}/comments` });
  await app.register(uploadsRoutes, { prefix: `${API_PREFIX}/uploads` });
  await app.register(usersRoutes, { prefix: `${API_PREFIX}/users` });
  await app.register(conversationsRoutes, { prefix: `${API_PREFIX}/conversations` });
  await app.register(notificationsRoutes, { prefix: `${API_PREFIX}/notifications` });
  await app.register(dashboardRoutes, { prefix: `${API_PREFIX}/dashboard` });
  await app.register(adminRoutes, { prefix: `${API_PREFIX}/admin` });
  // `audit-events`, not `audit`: that is the path AdminOverview.tsx already calls.
  await app.register(auditRoutes, { prefix: `${API_PREFIX}/audit-events` });

  /*
   * The SPA, served by this same process — LAST, and only when WEB_DIST_DIR is set.
   *
   * Order is the whole design. Every API route above is registered first, so a request
   * for /api/v1/anything is matched by a real handler and never by the catch-all below.
   * The catch-all exists because a client-side router owns paths this server has never
   * heard of: a browser asked for /courses/01J… directly — a refresh, a bookmark, a
   * pasted link — must receive index.html and let the router resolve it, not a 404.
   *
   * Absent WEB_DIST_DIR this registers nothing at all. In development Vite serves the
   * SPA on :5173 and proxies /api here, so a static handler in this process would only
   * be able to serve a stale build.
   *
   * This is why the image built the SPA, copied it to /app/public, set WEB_DIST_DIR,
   * and still answered `/` with a 404: nothing had ever read the variable.
   */
  if (env.WEB_DIST_DIR) {
    const { default: fastifyStatic } = await import('@fastify/static');
    await app.register(fastifyStatic, {
      root: env.WEB_DIST_DIR,
      // The SPA's asset URLs are absolute already; a prefix would double them.
      prefix: '/',
      /*
       * `index: false` so this plugin NEVER serves index.html — not at `/`, not
       * anywhere. Every HTML response then comes from the one handler below, which is
       * what lets the caching rule be stated once instead of split between a plugin
       * option and a fallback.
       *
       * Vite fingerprints everything it emits under /assets, so those are safe to cache
       * for a year. The HTML must not be, or a deploy leaves browsers holding a document
       * that references chunks which no longer exist.
       */
      index: false,
      /*
       * `redirect: false` with `index: false`, or `/` is a 500 dressed as something
       * else. With index serving off, the plugin treats a bare `/` as a DIRECTORY and
       * tries to redirect to a trailing slash; @fastify/send refuses that and throws a
       * ForbiddenError from inside the send stream, which the error translator then
       * reported as a 422. Measured: `/courses` served index.html correctly while `/`
       * — the one URL everybody types — answered
       * `{"code":"VALIDATION_FAILED","status":422}`.
       *
       * With redirects off, `/` simply does not match a file, falls through to the
       * not-found handler, and gets the SPA shell like every other client-router path.
       */
      redirect: false,
      maxAge: '1y',
      immutable: true,
    });
    /*
     * `/` gets its own route, because the static plugin cannot serve it.
     *
     * With `index: false` the bare root is a DIRECTORY as far as @fastify/send is
     * concerned, and it refuses to serve one: `redirect: false` stops the
     * trailing-slash redirect but the request still ends in a thrown Forbidden. So the
     * one URL everybody types answered 403 while `/courses` and `/login` were already
     * serving the shell correctly.
     *
     * A declared route matches before the plugin's wildcard, so this takes `/` out of
     * the directory path entirely and states the root's meaning once: it is the SPA
     * shell, uncached, exactly like every other client-router path.
     */
    app.get('/', (_request, reply) =>
      /*
       * `cacheControl: false` per call, or the plugin wins.
       *
       * `maxAge: '1y', immutable: true` are set on the registration for the
       * fingerprinted assets, and `sendFile` applies those same options — so a
       * `.header('cache-control', …)` set beforehand was overwritten and the SHELL went
       * out with `max-age=31536000, immutable`. Measured on the running image: `/`
       * answered 200 with a one-year immutable cache, which is the exact failure the
       * split exists to avoid — a deploy would leave browsers holding a document
       * pointing at chunks that no longer exist, with no way to recover but a hard
       * refresh most people do not know about.
       */
      reply
        .type('text/html; charset=utf-8')
        .header('cache-control', 'no-cache')
        .sendFile('index.html', { cacheControl: false }),
    );

    // Every OTHER client-router path reaches the shell through the not-found handler in
    // errors.plugin.ts: Fastify permits one per prefix and that plugin already owns it.
  }

  await app.ready();
  return app;
}
