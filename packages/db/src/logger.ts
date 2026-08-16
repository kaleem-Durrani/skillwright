/**
 * A dependency-free structured logger.
 *
 * The data layer must be loadable by the API, by the Prisma CLI (seed, studio) and by
 * test runners, so it cannot import the API's logger without creating a cycle. Lines are
 * JSON so they survive `docker logs | jq` unchanged.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * The API validates LOG_LEVEL against pino's vocabulary, which is wider than the four
 * levels above. Every accepted value is mapped here rather than ignored: `silent` used
 * to miss the lookup and fall through to the default, so asking for no output produced
 * the noisiest output there is. An unknown value still falls through — but only values
 * `env.ts` already rejects can get that far.
 */
const SILENT = Number.POSITIVE_INFINITY;
const THRESHOLDS: Record<string, number> = {
  trace: LEVEL_ORDER.debug,
  debug: LEVEL_ORDER.debug,
  info: LEVEL_ORDER.info,
  warn: LEVEL_ORDER.warn,
  error: LEVEL_ORDER.error,
  fatal: LEVEL_ORDER.error,
  silent: SILENT,
};

function thresholdFromEnv(): number {
  const configured = process.env.LOG_LEVEL?.toLowerCase();
  const mapped = configured === undefined ? undefined : THRESHOLDS[configured];
  if (mapped !== undefined) return mapped;
  return process.env.NODE_ENV === 'production' ? LEVEL_ORDER.info : LEVEL_ORDER.debug;
}

/** BigInt is unrepresentable in JSON; a log line must never be the thing that throws. */
function replacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Error)
    return { name: value.name, message: value.message, stack: value.stack };
  return value;
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < thresholdFromEnv()) return;
  const line = JSON.stringify(
    { level, time: new Date().toISOString(), pkg: '@skillwright/db', msg, ...fields },
    replacer,
  );
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit('error', msg, fields),
};

/**
 * Unformatted stdout, for the seed's credential banner only.
 *
 * That banner is a human-facing artefact of an interactive command, not telemetry, so
 * wrapping it in JSON would make it strictly worse to read.
 */
export function writeBanner(text: string): void {
  process.stdout.write(`${text}\n`);
}
