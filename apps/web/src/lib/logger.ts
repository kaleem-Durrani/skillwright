type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const MIN_LEVEL: Level = import.meta.env.DEV ? 'debug' : 'warn';

/**
 * The app's only output channel.
 *
 * WHY not console.log directly: log lines need a level so production can drop
 * the noise, and a single choke point is where a Sentry/OTel transport gets
 * added later without touching sixty call sites. The console methods below are
 * the transport, not the interface.
 */
function write(level: Level, message: string, context?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[MIN_LEVEL]) return;
  const payload = context ? [message, context] : [message];
  // This function IS the console boundary; eslint.config.js turns `no-console`
  // off for this file, so no inline directive is needed (and an unused one warns).
  const sink = level === 'debug' ? console.debug : console[level];
  sink(`[skillwright] ${payload[0] as string}`, ...payload.slice(1));
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => write('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => write('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => write('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => write('error', message, context),
};
