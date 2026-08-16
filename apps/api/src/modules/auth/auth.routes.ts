import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requireSession } from '../../plugins/auth.plugin.js';
import { authIpRateLimit, perAccountRateLimit } from '../../plugins/ratelimit.plugin.js';
import {
  demoLoginSchema,
  forgotPasswordSchema,
  loginSchema,
  mfaConfirmSchema,
  mfaDisableSchema,
  mfaVerifySchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from './auth.schema.js';
import * as authService from './auth.service.js';
import { ACK } from './auth.service.js';

/** Pulls the account dimension out of a body that has already been validated. */
function emailOf(request: FastifyRequest): string | undefined {
  const body = request.body;
  if (body && typeof body === 'object' && 'email' in body) {
    const value = (body as { email?: unknown }).email;
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
}

const authRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    '/register',
    {
      config: authIpRateLimit,
      schema: { body: registerSchema },
      preHandler: perAccountRateLimit('register', emailOf, 5),
    },
    async (request, reply) => {
      await authService.register(request.body);
      return reply.status(202).send(ACK);
    },
  );

  app.post(
    '/verify-email',
    {
      config: authIpRateLimit,
      schema: { body: verifyEmailSchema },
      preHandler: perAccountRateLimit('verify-email', emailOf),
    },
    async (request) => {
      await authService.verifyEmail(request.body);
      return ACK;
    },
  );

  app.post(
    '/resend-verification',
    {
      config: authIpRateLimit,
      schema: { body: resendVerificationSchema },
      preHandler: perAccountRateLimit('resend', emailOf, 5),
    },
    async (request, reply) => {
      await authService.resendVerification(request.body.email);
      return reply.status(202).send(ACK);
    },
  );

  app.post(
    '/login',
    {
      config: authIpRateLimit,
      schema: { body: loginSchema },
      preHandler: perAccountRateLimit('login', emailOf),
    },
    async (request, reply) => authService.login(request.body, request, reply),
  );

  app.post('/logout', async (request, reply) => {
    await authService.logout(request, reply);
    return reply.status(204).send();
  });

  app.post('/logout-all', async (request, reply) => {
    const session = requireSession(request);
    return authService.logoutAll(session, request, reply);
  });

  app.post(
    '/forgot-password',
    {
      config: authIpRateLimit,
      schema: { body: forgotPasswordSchema },
      preHandler: perAccountRateLimit('forgot', emailOf, 5),
    },
    async (request, reply) => {
      await authService.forgotPassword(request.body.email);
      return reply.status(202).send(ACK);
    },
  );

  app.post(
    '/reset-password',
    {
      config: authIpRateLimit,
      schema: { body: resetPasswordSchema },
      preHandler: perAccountRateLimit('reset', emailOf),
    },
    async (request) => {
      await authService.resetPassword(request.body);
      return ACK;
    },
  );

  app.get('/me', async (request) => authService.currentSession(requireSession(request)));

  app.post('/demo', { schema: { body: demoLoginSchema } }, async (request, reply) =>
    authService.demoLogin(request.body, request, reply),
  );

  // --- TOTP ---------------------------------------------------------------

  app.post('/mfa/enroll', { config: authIpRateLimit }, async (request) =>
    authService.mfaEnroll(requireSession(request)),
  );

  app.post(
    '/mfa/activate',
    { config: authIpRateLimit, schema: { body: mfaConfirmSchema } },
    async (request) => authService.mfaActivate(requireSession(request), request.body.code, request),
  );

  app.post(
    '/mfa/verify',
    {
      config: authIpRateLimit,
      schema: { body: mfaVerifySchema },
      preHandler: perAccountRateLimit('mfa-verify', (request) => request.session?.userId),
    },
    async (request, reply) =>
      authService.mfaVerify(requireSession(request), request.body, request, reply),
  );

  app.delete(
    '/mfa',
    { config: authIpRateLimit, schema: { body: mfaDisableSchema } },
    async (request, reply) => {
      await authService.mfaDisable(requireSession(request), request.body, request);
      return reply.status(204).send();
    },
  );
};

export default authRoutes;
