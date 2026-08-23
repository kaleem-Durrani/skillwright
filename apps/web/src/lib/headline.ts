/**
 * Rendering `ts_headline` output safely.
 *
 * The API builds every hit's headline server-side with Postgres `ts_headline`
 * (search.sql.ts), whose defaults wrap each matched term in `<b>…</b>`. The
 * document the fragments are cut from is USER CONTENT, and ts_headline does not
 * escape it — a description containing `<img onerror=…>` would pass through
 * verbatim — so this string must never reach `dangerouslySetInnerHTML`.
 *
 * Instead the marker pair is treated as a delimiter and NOTHING else: the string
 * is split into segments, everything outside `<b>`/`</b>` stays inert text, and
 * the page renders marked segments as React children of a <mark>. A stray or
 * unbalanced marker can only mis-place a highlight, never inject an element,
 * because no markup is ever parsed out of the payload.
 */

export interface HeadlineSegment {
  text: string;
  /** True when ts_headline wrapped this span in its match marker. */
  marked: boolean;
}

/** Exactly the two strings ts_headline emits. No other tag is recognised. */
const MARKER = /<\/?b>/g;

export function splitHeadline(headline: string): HeadlineSegment[] {
  const segments: HeadlineSegment[] = [];
  let marked = false;
  let cursor = 0;
  for (const match of headline.matchAll(MARKER)) {
    const start = match.index ?? 0;
    const text = headline.slice(cursor, start);
    if (text) segments.push({ text, marked });
    // The text BEFORE this marker was governed by the previous state; the text
    // after it is governed by whether this marker opened or closed.
    marked = match[0] === '<b>';
    cursor = start + match[0].length;
  }
  const rest = headline.slice(cursor);
  if (rest) segments.push({ text: rest, marked });
  return segments;
}
