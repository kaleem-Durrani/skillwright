import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { Redis } from 'ioredis';
import { env } from '../env.js';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
  }
}

/**
 * One shared client for rate limiting and counters. Pub/sub (socket.io adapter) must
 * duplicate() this rather than reuse it — a subscribed connection cannot run commands.
 */
const redisPlugin: FastifyPluginAsync = async (app) => {
  const client = new Redis(env.REDIS_URL, {
    // Fail fast instead of queueing forever behind a dead Redis; /readyz should go red.
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });

  client.on('error', (error: Error) => {
    app.log.error({ err: error }, 'redis client error');
  });

  app.decorate('redis', client);

  app.addHook('onClose', async () => {
    await client.quit().catch(() => client.disconnect());
  });
};

export default fp(redisPlugin, { name: 'redis' });
