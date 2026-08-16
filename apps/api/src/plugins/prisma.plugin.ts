import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { prisma } from '@skillwright/db';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: typeof prisma;
  }
}

/**
 * The client is a module singleton in @skillwright/db (one connection pool per
 * process). Decorating rather than importing it into every route keeps handlers
 * injectable in tests without module mocking.
 */
const prismaPlugin: FastifyPluginAsync = async (app) => {
  app.decorate('prisma', prisma);

  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });
};

export default fp(prismaPlugin, { name: 'prisma' });
