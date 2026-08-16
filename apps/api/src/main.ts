import { buildApp } from './app.js';
import { env } from './env.js';
import { baseLogger } from './lib/logger.js';
import { closeMailer } from './lib/mailer.js';

/** After this, in-flight work is presumed hung and the process is killed regardless. */
const FORCED_EXIT_MS = 15_000;

const log = baseLogger.child({ module: 'main' });

async function start(): Promise<void> {
  const app = await buildApp();

  await app.listen({ port: env.PORT, host: env.HOST });
  log.info({ port: env.PORT, host: env.HOST, deployEnv: env.DEPLOY_ENV }, 'api listening');

  let shuttingDown = false;

  /**
   * Ordered teardown. `app.close()` stops accepting new connections first, then runs
   * onClose hooks in reverse registration order — socket.io and the queue workers
   * before Redis and Prisma, which is exactly the order their dependencies require.
   */
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'shutdown started');

    const forced = setTimeout(() => {
      log.fatal({ signal }, 'graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, FORCED_EXIT_MS);
    forced.unref();

    try {
      await app.close();
      await closeMailer();
      clearTimeout(forced);
      log.info('shutdown complete');
      process.exit(0);
    } catch (error) {
      log.error({ err: error }, 'shutdown failed');
      process.exit(1);
    }
  }

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }

  process.on('unhandledRejection', (reason) => {
    // A rejection nobody handled means state we cannot reason about. Log it, then
    // leave via the same door as a clean shutdown so load balancers are told.
    log.fatal({ err: reason }, 'unhandled rejection');
    void shutdown('unhandledRejection');
  });

  process.on('uncaughtException', (error) => {
    log.fatal({ err: error }, 'uncaught exception');
    void shutdown('uncaughtException');
  });
}

start().catch((error: unknown) => {
  log.fatal({ err: error }, 'failed to start');
  process.exit(1);
});
