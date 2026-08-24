/**
 * A minimal RFC 4180 CSV writer that STREAMS.
 *
 * Phase 8's exports ride the plan line "Streamed, not buffered: a register for a
 * full intake should not be assembled in memory." So this module never holds more
 * than one batch of formatted rows: callers hand over an async generator of row
 * arrays (each generator itself queries Prisma in bounded batches), and the returned
 * `Readable` pulls from it only as Fastify drains it towards the socket. There is no
 * `Buffer.concat`, no array accumulation and no dependency — nothing in package.json
 * writes CSV, and adding a library for two functions would have been the heavier
 * change.
 *
 * Encoding follows RFC 4180 exactly: comma separators, fields quoted only when they
 * contain a quote, comma, CR or LF, inner quotes doubled, CRLF between records.
 * Excel and every CSV reader the accreditor is likely to file the register with
 * accept precisely this shape.
 */
import { Readable } from 'node:stream';

/** Everything a register cell can hold. `null`/`undefined` render as empty fields. */
export type CsvCell = string | number | boolean | null | undefined | Date;

/**
 * Quotes one already-stringified field when — and only when — RFC 4180 requires it.
 * The regex tests rather than scans-and-rebuilds, so the common case (a name, an id,
 * a date) pays one character-class test and no allocation beyond the join.
 */
function escapeField(field: string): string {
  return /[",\r\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field;
}

/** Stringifies one cell: dates cross as ISO (the wire convention everywhere else). */
export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/** One RFC 4180 record, newline NOT included. */
export function csvRow(cells: readonly CsvCell[]): string {
  return cells.map((cell) => escapeField(csvCell(cell))).join(',');
}

/**
 * How many source rows one `read()` formats into a single push. One row per read
 * means one TextEncoder call and one chunk object per record; a batch amortises both
 * while keeping the working set fixed regardless of register size.
 */
const ROWS_PER_PULL = 200;

/**
 * Bridges an async generator of rows onto a Node Readable, pulling lazily.
 *
 * The generator is consumed with `.next()` inside `read()` so back-pressure is
 * honest: when Fastify stops draining (a slow client on a big export), the socket's
 * buffer fills, `push()` returns false and Node stops calling `read()` until it has
 * drained — the awaits stop, and the database query loop parks mid-register.
 * `destroy` closes the generator so a client who cancels a download does not leave a
 * half-finished Prisma cursor waiting for the next read that never comes.
 */
export function csvStream(rows: AsyncIterable<readonly CsvCell[]>): Readable {
  const encoder = new TextEncoder();
  const source = rows[Symbol.asyncIterator]();

  return new Readable({
    // Node never calls `read` again before a push (or null) resolves the previous
    // one, so sequential batches here cannot overlap.
    async read(this: Readable) {
      try {
        let chunk = '';
        for (let i = 0; i < ROWS_PER_PULL; i += 1) {
          const next = await source.next();
          if (next.done) break;
          // CRLF is the RFC 4180 record separator, not a Windows affectation.
          chunk += `${csvRow(next.value)}\r\n`;
        }
        this.push(chunk === '' ? null : encoder.encode(chunk));
      } catch (error) {
        // A failed query mid-register must surface as a broken stream, not as an
        // empty file that looks like "no rows".
        this.destroy(error instanceof Error ? error : new Error(String(error)));
      }
    },
    async destroy(this: Readable, error, callback) {
      try {
        await source.return?.(undefined);
      } catch {
        // A generator that throws while being closed must not mask the stream's own error.
      } finally {
        callback(error);
      }
    },
  });
}
