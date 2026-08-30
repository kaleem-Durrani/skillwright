import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { logger } from '../src/logger.js';

/**
 * The LOG_LEVEL vocabulary table, which is the fix for lesson 8.
 *
 * `LOG_LEVEL=silent` once produced strictly MORE output than any other setting:
 * `logger.ts` knew only `debug|info|warn|error`, `silent` missed the lookup, and the
 * fallback outside production is `debug`. Asking for no output selected the noisiest
 * output there is, and buried sixteen test results under several thousand Prisma
 * query lines. `apps/api/test/setup.ts` still sets `LOG_LEVEL=silent` for the whole
 * integration suite on exactly that reasoning — so a regression here re-buries 486
 * test results, and nothing in the repository would name the cause.
 *
 * Every case below captures BOTH streams. Capturing only stdout would let a change
 * that routes everything to stderr pass the silence assertions while writing just as
 * much output as before.
 */

const ORIGINAL_LOG_LEVEL = process.env.LOG_LEVEL;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

after(() => {
  if (ORIGINAL_LOG_LEVEL === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = ORIGINAL_LOG_LEVEL;
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

interface Captured {
  out: string;
  err: string;
}

/**
 * `thresholdFromEnv()` re-reads process.env on every emit, so the level under test is
 * set per call rather than per module load — there is no import cache to defeat.
 */
function capture(level: string | undefined, emit: () => void): Captured {
  if (level === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = level;

  const out: string[] = [];
  const err: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);

  // The signature is `write(chunk, encoding?, cb?)`; only the chunk is ever inspected
  // here, and `true` is what a non-backpressured write returns.
  process.stdout.write = ((chunk: unknown) => {
    out.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown) => {
    err.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;

  try {
    emit();
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
  }

  return { out: out.join(''), err: err.join('') };
}

function emitAllFour(): void {
  logger.debug('d');
  logger.info('i');
  logger.warn('w');
  logger.error('e');
}

describe('LOG_LEVEL', () => {
  test('silent writes nothing, on either stream, at any level', () => {
    const { out, err } = capture('silent', emitAllFour);
    assert.equal(out, '', 'silent emitted on stdout');
    assert.equal(err, '', 'silent emitted on stderr');
  });

  test("maps pino's wider vocabulary rather than falling through to the default", () => {
    // `fatal` is not one of the four internal levels. If it stops being mapped it
    // misses the table and inherits `debug` — the setting that asks for the least
    // becomes the setting that produces the most.
    const fatal = capture('fatal', emitAllFour);
    assert.equal(fatal.out, '', 'fatal should suppress debug and info');
    assert.ok(!fatal.err.includes('"msg":"w"'), 'fatal should suppress warn');
    assert.ok(fatal.err.includes('"msg":"e"'), 'fatal should still emit error');

    // `trace` is below debug in pino, so it must let everything through.
    const trace = capture('trace', emitAllFour);
    assert.ok(trace.out.includes('"msg":"d"'), 'trace should emit debug');
    assert.ok(trace.out.includes('"msg":"i"'), 'trace should emit info');

    // Warnings and errors go to stderr, everything else to stdout. The seed writes a
    // human-readable credential banner to stdout with `writeBanner`, and every other
    // stdout line is JSON so `docker logs | jq` works on it unchanged.
    assert.ok(trace.err.includes('"msg":"w"'), 'warn belongs on stderr');
    assert.ok(trace.err.includes('"msg":"e"'), 'error belongs on stderr');
    assert.ok(!trace.out.includes('"msg":"e"'), 'error must not also reach stdout');
  });

  test('an absent LOG_LEVEL is quiet in production, not verbose', () => {
    // The Prisma CLI paths — seed, studio, migrate — load this package with whatever
    // environment the operator has, which in a container is frequently none. Lesson
    // 8's rule is that the fallback must be the quiet branch; `info` is that branch,
    // and `debug` is where `logger.debug('prisma.query', …)` lives in client.ts.
    process.env.NODE_ENV = 'production';
    const { out } = capture(undefined, emitAllFour);
    assert.ok(!out.includes('"msg":"d"'), 'production default must suppress debug');
    assert.ok(out.includes('"msg":"i"'), 'production default must still emit info');
  });
});

describe('JSON encoding', () => {
  test('serialises an Error and a BigInt instead of throwing or emptying them', () => {
    process.env.NODE_ENV = 'test';

    const { err } = capture('debug', () => {
      // This is the shape audit.ts logs when the append-only trail fails to write:
      // `logger.error('audit.write_failed', { …, error })`, immediately before it
      // rethrows. `JSON.stringify(new Error('boom'))` is `{}` without the replacer,
      // so the one line that explains a 500 over a broken audit trail would carry
      // an empty object and the cause would be unrecoverable from the logs.
      logger.error('audit.write_failed', { error: new Error('boom'), seq: 42n });
    });

    const line: unknown = JSON.parse(err.trim());
    assert.ok(line !== null && typeof line === 'object');
    const fields = line as { error?: { name?: string; message?: string }; seq?: unknown };
    assert.equal(fields.error?.name, 'Error');
    assert.equal(fields.error?.message, 'boom');
    // Four columns in schema.prisma are BigInt (`totpLastUsedCounter`, `nextSeq`,
    // `lastReadSeq`, `seq`). JSON.stringify throws outright on one, and a log line
    // must never be the thing that throws — least of all the line reporting a failure.
    assert.equal(fields.seq, '42');
  });
});
