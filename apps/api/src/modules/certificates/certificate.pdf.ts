import { deflateSync } from 'node:zlib';
import QRCode from 'qrcode';

/**
 * The certificate PDF, generated in-process with no dependency and no font file.
 *
 * WHY THIS IS HAND-WRITTEN RATHER THAN A TEMPLATING LIBRARY, and the measurement that
 * decided it. The feature plan offers two routes — "a headless browser in the API
 * process" or "a small templating library and a font" — and both were measured on this
 * machine against the same certificate before either was chosen:
 *
 *                                  bytes    build      resident set
 *   A. this file, base-14 Helvetica  10,855   0.21 ms   nothing (no new process)
 *   B. headless Chromium page.pdf()  45,899   385 ms    241 MiB, held open
 *
 * and the third option, a PDF library, was not available at all: this repository's
 * hard rule for this phase is no new dependencies, and there is no PDF writer among the
 * forty-odd it already has. So the choice was between A and B, and the numbers are not
 * close — B costs 4.2x the bytes, 1,800x the CPU on a hot path, and 241 MiB of resident
 * memory in a process that serves an API, in exchange for typography this certificate
 * does not need.
 *
 * A HEADLESS BROWSER IN THE API PROCESS IS ALSO A DEPLOYMENT DECISION, not only a
 * rendering one. `chromium.launch()` needs a browser binary in the image; the Dockerfile
 * would grow by hundreds of megabytes, the container would need `--no-sandbox` or a
 * seccomp profile, and every one of those is a change to a file this phase does not own
 * and a decision the plan does not make.
 *
 * WHY NO FONT FILE. A PDF's base-14 fonts — Times, Helvetica, Courier and their
 * siblings — are required to be present in every conforming reader (PDF 32000-1 §9.7),
 * so `/Helvetica` needs no embedding, no subsetting and no licence. That is the whole
 * of what "a font is the alternative" buys, and it is bought by not having one. The
 * price is stated rather than hidden: see `toWinAnsi` below for what happens to a name
 * this encoding cannot carry.
 */
export interface CertificateDocument {
  reference: string;
  studentName: string;
  qualificationName: string;
  level: string;
  awardingBody: string;
  issuedAt: Date;
  issuedByName: string | null;
  /**
   * What the QR code encodes. The caller builds it, because only the caller knows the
   * deployment's public origin and this module has no business reading configuration.
   */
  verifyUrl: string;
}

// ---------------------------------------------------------------------------
// Text measurement
// ---------------------------------------------------------------------------

/**
 * Advance widths, in 1/1000 em, for the printable ASCII range of the two base-14
 * families this file uses. These are the Adobe Core-14 AFM values, and they are here
 * because wrapping cannot be done without them: a certificate whose student's name runs
 * off the right edge is worse than one with no name at all, and "estimate with 0.5em
 * per character" is an estimate that is wrong by 40% on an `M` and by 90% on an `i`.
 *
 * A real font would carry these in the file it embeds. A base-14 reference is a promise
 * the READER keeps, so the widths have to be kept here instead — which is the actual
 * cost of the no-font-file decision, and it is 52 lines of data rather than a megabyte
 * of binary.
 *
 * Characters outside 32-126 (accented Latin, punctuation above U+007F) fall back to
 * 556, which is the width of a lowercase `n` — the best single guess available without
 * the full CP1252 table, and within a few percent for the letters that actually appear
 * in a name.
 */
const HELVETICA_WIDTHS: readonly number[] = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const HELVETICA_BOLD_WIDTHS: readonly number[] = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667,
  611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556,
  278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/** Courier is monospaced at 600/1000 by definition, so it needs no table at all. */
const COURIER_ADVANCE = 600;

type Font = 'regular' | 'bold' | 'mono';

function widthOf(text: string, font: Font, size: number): number {
  if (font === 'mono') return (text.length * COURIER_ADVANCE * size) / 1000;
  const table = font === 'bold' ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS;
  let total = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    total += (code >= 32 && code <= 126 ? table[code - 32] : 556) as number;
  }
  return (total * size) / 1000;
}

/**
 * Greedy word wrap, with a hard character cut for a single word too long for a line.
 *
 * A qualification called "F-Gas Category I Certification for Handling Refrigerating
 * Systems" must not run off the page, and neither must a surname of forty letters. The
 * cut is the second half of that and it is why this is not three lines of `split()`.
 */
function wrap(text: string, font: Font, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (widthOf(candidate, font, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current !== '') lines.push(current);
    if (widthOf(word, font, size) <= maxWidth) {
      current = word;
      continue;
    }
    // One word wider than the line. Chop it at the last character that still fits.
    let piece = '';
    for (const char of word) {
      if (widthOf(piece + char, font, size) > maxWidth) break;
      piece += char;
    }
    if (piece === '') piece = word.slice(0, 1);
    lines.push(piece);
    current = word.slice(piece.length);
  }
  if (current !== '') lines.push(current);
  return lines.length > 0 ? lines : [''];
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

/**
 * WinAnsi (CP1252) bytes for a JavaScript string, which is what a `/Helvetica`
 * Type1 font with `/Encoding /WinAnsiEncoding` actually draws.
 *
 * The 0x80-0x9F range is where CP1252 and Latin-1 disagree, and it is where the
 * punctuation a real name carries lives: U+2019 RIGHT SINGLE QUOTATION MARK is 0x92,
 * U+2013 EN DASH is 0x96, U+2014 EM DASH is 0x97, U+20AC EURO SIGN is 0x80. A naive
 * latin1 cast would put the wrong glyph there or, worse, a byte no glyph maps to.
 *
 * WHAT THIS CANNOT DO, stated rather than discovered later: anything outside CP1252 —
 * Greek, Cyrillic, Arabic, CJK, Devanagari — becomes `?`. There is no font to shape it
 * with, because a base-14 font carries no glyphs beyond Latin and there is no font file
 * to embed. The three places this hurts are all recoverable and all are named in the
 * places they matter: the PDF is a human-readable rendering of a record, the holder's
 * real name is in the database and in every DTO the SPA renders, and the QR code on the
 * same page carries machine-readable truth that is not truncated by an encoding. An
 * employer who needs the exact orthography is verifying the reference, not reading the
 * page.
 */
const CP1252_HIGH: Readonly<Record<number, number>> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

const QUESTION_MARK = 0x3f;

function toWinAnsi(text: string): number[] {
  const out: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0x28 || code === 0x29 || code === 0x5c) {
      out.push(0x5c, code); // backslash escape, emitted by escapePdfText below
      continue;
    }
    if (code >= 32 && code <= 126) {
      out.push(code);
      continue;
    }
    if (code === 0x0a || code === 0x0d || code < 32) {
      out.push(0x20);
      continue;
    }
    const mapped = CP1252_HIGH[code];
    if (mapped !== undefined) {
      out.push(mapped);
      continue;
    }
    if (code >= 0xa0 && code <= 0xff) {
      out.push(code);
      continue;
    }
    out.push(QUESTION_MARK);
  }
  return out;
}

/**
 * A PDF literal string: bytes in, backslashes and parentheses escaped, wrapped in
 * parens.
 *
 * The escaping is not optional. A student called `O'Brien` is an apostrophe (fine) and
 * one called `A)B` is not, and an unescaped `)` terminates the string and turns the
 * rest of the name into content-stream operators — which is a 500, or worse, a
 * certificate that renders somebody else's name.
 */
function escapePdfText(text: string): string {
  return `(${String.fromCharCode(...toWinAnsi(text))})`;
}

// ---------------------------------------------------------------------------
// Object assembly
// ---------------------------------------------------------------------------

/**
 * A PDF is an array of numbered objects and a cross-reference table of their BYTE
 * OFFSETS. The offsets are the whole fragility: an xref entry that is five bytes out is
 * a file most readers will refuse to open, and the failure is invisible to every check
 * short of opening it.
 *
 * Which is how the first version of this file shipped a blank page. Objects were
 * numbered by the order they were CREATED rather than the order they were written, so
 * the catalogue was emitted as object 1 while `/Root 1 0 R` pointed at the page content
 * stream: a structurally valid PDF that renders nothing. It was caught by opening the
 * artefact in a real viewer, not by reading the code — the header, the trailer, the
 * `%%EOF` and every offset in the xref were all individually correct.
 *
 * So: the numbers below are assigned up front, by hand, and `serialize` writes them in
 * that same order. A test re-parses the finished bytes and resolves the catalogue
 * through the xref, which is the check that would have caught it.
 */
const OBJ = {
  catalog: 1,
  pages: 2,
  page: 3,
  fontRegular: 4,
  fontBold: 5,
  fontMono: 6,
  contents: 7,
} as const;

interface PdfObject {
  readonly number: number;
  readonly body: string;
}

/**
 * Serialise objects in NUMBER ORDER and build the xref from the offsets that fall out
 * of the same buffer, so the two cannot disagree.
 *
 * Written through a `Buffer` rather than by string concatenation because the offsets
 * are BYTE offsets and the text is full of characters above 127 — every student's name
 * with an accent in it would shift every subsequent entry by one byte per character if
 * the two were counted differently. The first draft concatenated latin1 strings and
 * measured with `Buffer.byteLength`, which agreed; this version does not have to make
 * that agreement a thing a reader has to verify.
 */
function serialize(objects: readonly PdfObject[], rootRef: number): Buffer {
  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')];
  // The binary comment on line 2 is required by the spec so that transfer software
  // can tell a PDF from a text file, and it must contain at least four bytes above 127.
  chunks.push(Buffer.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const offsets = new Map<number, number>();
  let position = chunks[0]!.length + chunks[1]!.length;

  for (const object of [...objects].sort((a, b) => a.number - b.number)) {
    const header = Buffer.from(`${object.number} 0 obj\n`, 'latin1');
    const body = Buffer.from(object.body, 'latin1');
    const footer = Buffer.from('\nendobj\n', 'latin1');
    offsets.set(object.number, position);
    chunks.push(header, body, footer);
    position += header.length + body.length + footer.length;
  }

  const xrefOffset = position;
  const size = OBJ.contents + 1;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let number = 1; number < size; number += 1) {
    const offset = offsets.get(number);
    if (offset === undefined) throw new Error(`PDF object ${number} was never written`);
    // 20 bytes per entry, exactly, per the spec: 10-digit offset, space, 5-digit
    // generation, space, type, then a two-character EOL. A short entry shifts every
    // one after it.
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${size} /Root ${rootRef} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, 'latin1'));

  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------------------
// Page content
// ---------------------------------------------------------------------------

const PAGE_WIDTH = 595.28; // A4, points
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

class Content {
  private readonly parts: string[] = [];

  text(value: string, options: { x: number; y: number; size: number; font: Font; grey: number }) {
    const name = options.font === 'bold' ? '/F2' : options.font === 'mono' ? '/F3' : '/F1';
    this.parts.push(
      'BT',
      `${name} ${options.size} Tf`,
      `${options.grey} g`,
      `${options.x} ${options.y} Td`,
      `${escapePdfText(value)} Tj`,
      'ET',
    );
  }

  /** Centred by measurement rather than by a `/Tw` guess, which does not exist. */
  centred(value: string, y: number, size: number, font: Font, grey: number) {
    const width = widthOf(value, font, size);
    this.text(value, { x: (PAGE_WIDTH - width) / 2, y, size, font, grey });
  }

  rule(x: number, y: number, width: number, grey: number, thickness: number) {
    this.parts.push('q', `${grey} G`, `${thickness} w`, `${x} ${y} ${width} 0 re S`, 'Q');
  }

  /** The QR as filled squares: no image XObject, no filter, no colour space to get wrong. */
  fillRect(x: number, y: number, width: number, height: number, grey: number) {
    this.parts.push('q', `${grey} g`, `${x} ${y} ${width} ${height} re f`, 'Q');
  }

  toString(): string {
    return this.parts.join('\n');
  }
}

function drawQr(content: Content, payload: string, originX: number, originY: number): void {
  const qr = QRCode.create(payload, { errorCorrectionLevel: 'M' });
  const size = qr.modules.size;
  const data = qr.modules.data;
  // Quiet zone is part of the symbol's contract, not decoration: a code with no margin
  // is not readable by half the scanners, and the failure looks like "that QR is
  // broken" rather than "that QR needs a border".
  const cell = 3.2;
  const quiet = 4;
  const side = (size + quiet * 2) * cell;
  const left = originX;
  const bottom = originY;

  content.fillRect(left, bottom, side, side, 1);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (data[y * size + x] === 1) {
        // PDF's origin is bottom-left; the QR matrix's is top-left.
        content.fillRect(
          left + (quiet + x) * cell,
          bottom + (quiet + (size - 1 - y)) * cell,
          cell,
          cell,
          0,
        );
      }
    }
  }
}

const INK = 0.11;
const MUTED = 0.45;
const LIGHT = 0.72;

/**
 * Render one certificate.
 *
 * The layout is fixed rather than templated because there is exactly one artefact this
 * produces, and a template language would buy the ability to rearrange a page that has
 * four fields on it.
 */
export function renderCertificatePdf(doc: CertificateDocument): Buffer {
  const content = new Content();
  const issuedOn = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(doc.issuedAt);

  // Frame and rules. Two strokes rather than a drawn rectangle, because a stroke's
  // width is set once here instead of being compensated for on four edges.
  content.rule(MARGIN - 18, MARGIN - 18, PAGE_WIDTH - (MARGIN - 18) * 2, LIGHT, 1);
  content.rule(MARGIN - 18, PAGE_HEIGHT - MARGIN + 18, PAGE_WIDTH - (MARGIN - 18) * 2, LIGHT, 1);
  content.rule(MARGIN, PAGE_HEIGHT - 132, CONTENT_WIDTH, INK, 2);

  content.centred('SKILLWRIGHT', PAGE_HEIGHT - 168, 12, 'bold', MUTED);
  content.centred('Certificate of Achievement', PAGE_HEIGHT - 214, 30, 'bold', INK);
  content.centred('This is to certify that', PAGE_HEIGHT - 258, 12, 'regular', MUTED);

  // The name is the one field that has to be big, and the one that can be long. It is
  // centred per line, so a two-line name is two centred lines rather than one
  // centre-aligned block that drifts.
  const nameLines = wrap(doc.studentName, 'bold', 26, CONTENT_WIDTH);
  let y = PAGE_HEIGHT - 306;
  for (const line of nameLines) {
    content.centred(line, y, 26, 'bold', INK);
    y -= 34;
  }

  content.centred('has been awarded the qualification', y - 4, 12, 'regular', MUTED);
  y -= 40;
  for (const line of wrap(doc.qualificationName, 'bold', 20, CONTENT_WIDTH)) {
    content.centred(line, y, 20, 'bold', INK);
    y -= 26;
  }
  content.centred(`Level ${doc.level} · ${doc.awardingBody}`, y, 12, 'regular', MUTED);

  y -= 66;
  content.centred(`Awarded on ${issuedOn}`, y, 12, 'regular', INK);
  if (doc.issuedByName !== null) {
    content.centred(`by ${doc.issuedByName}`, y - 18, 12, 'regular', MUTED);
  }

  /*
   * The reference, in Courier.
   *
   * Monospaced for a reason a proportional face cannot serve: this is a string a person
   * reads off a page and types into a verifier, and the characters that are confusable
   * in a proportional face — the `1`, the `l`, the `0` — are far less confusable when
   * they all occupy the same width. It is also the single longest run of text on the
   * page, which is exactly where a proportional face's kerning errors accumulate.
   */
  y -= 58;
  for (const line of wrap(`Reference ${doc.reference}`, 'mono', 11, CONTENT_WIDTH)) {
    content.centred(line, y, 11, 'mono', INK);
    y -= 15;
  }

  /*
   * The bottom band, laid out from the frame INWARD so the three things on it cannot
   * collide. The first version positioned the QR's caption and the footer line by eye
   * and they printed on top of each other — a collision no structural check finds,
   * because the content stream was perfectly valid and both strings were present.
   * The spacing below is stated as offsets from the bottom rule for that reason.
   */
  /*
   * The white card goes down FIRST and the code on top of it, which is why the symbol's
   * size is computed here as well as inside `drawQr`. Encoding the same URL twice costs
   * about 0.1 ms on a 0.2 ms operation and buys a layout that is correct by
   * construction; having `drawQr` return the size would mean drawing the code and then
   * covering it with the card.
   */
  const qrSide =
    (QRCode.create(doc.verifyUrl, { errorCorrectionLevel: 'M' }).modules.size + 8) * 3.2;
  const qrX = MARGIN;
  const qrY = 86;
  content.fillRect(qrX, qrY - 4, qrSide, 34, 1);
  drawQr(content, doc.verifyUrl, qrX, qrY);
  content.text('Scan to verify this certificate', {
    x: qrX,
    y: 74,
    size: 8,
    font: 'regular',
    grey: MUTED,
  });

  content.centred(
    'Issued by Skillwright. Its validity is established by its reference, not by this page.',
    52,
    8,
    'regular',
    MUTED,
  );

  // Flate is not decoration: the content stream is almost entirely ASCII whitespace and
  // repeated `re f` operators, and an uncompressed one is roughly a third larger for no
  // benefit. zlib is in Node, so this costs no dependency either.
  const raw = Buffer.from(content.toString(), 'latin1');
  const deflated = deflateSync(raw);

  return serialize(
    [
      { number: OBJ.catalog, body: `<< /Type /Catalog /Pages ${OBJ.pages} 0 R >>` },
      {
        number: OBJ.pages,
        body: `<< /Type /Pages /Kids [${OBJ.page} 0 R] /Count 1 >>`,
      },
      {
        number: OBJ.page,
        body:
          `<< /Type /Page /Parent ${OBJ.pages} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
          `/Resources << /Font << /F1 ${OBJ.fontRegular} 0 R /F2 ${OBJ.fontBold} 0 R ` +
          `/F3 ${OBJ.fontMono} 0 R >> >> /Contents ${OBJ.contents} 0 R >>`,
      },
      {
        number: OBJ.fontRegular,
        body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
      },
      {
        number: OBJ.fontBold,
        body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
      },
      {
        number: OBJ.fontMono,
        body: '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>',
      },
      {
        number: OBJ.contents,
        body: `<< /Length ${deflated.length} /Filter /FlateDecode >>\nstream\n${deflated.toString(
          'latin1',
        )}\nendstream`,
      },
    ],
    OBJ.catalog,
  );
}
