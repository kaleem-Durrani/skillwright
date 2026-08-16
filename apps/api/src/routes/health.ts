import type { FastifyPluginAsync } from 'fastify';

/**
 * Two probes, because they answer different questions. `/healthz` asks "is this
 * process wedged?" — a failing answer means restart me. `/readyz` asks "can I serve
 * traffic right now?" — a failing answer means take me out of the load balancer but
 * do NOT restart me, because the thing that is broken is downstream.
 */
const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/healthz', { config: { rateLimit: false }, logLevel: 'silent' }, async () => ({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
  }));

  app.get(
    '/readyz',
    { config: { rateLimit: false }, logLevel: 'silent' },
    async (_request, reply) => {
      const checks: Record<string, 'ok' | 'fail'> = { database: 'fail', redis: 'fail' };

      const [database, redis] = await Promise.allSettled([
        app.prisma.$queryRaw`SELECT 1`,
        app.redis.ping(),
      ]);

      if (database.status === 'fulfilled') checks.database = 'ok';
      if (redis.status === 'fulfilled' && redis.value === 'PONG') checks.redis = 'ok';

      const ready = Object.values(checks).every((value) => value === 'ok');
      return reply.status(ready ? 200 : 503).send({ status: ready ? 'ready' : 'degraded', checks });
    },
  );
};

export default healthRoutes;
