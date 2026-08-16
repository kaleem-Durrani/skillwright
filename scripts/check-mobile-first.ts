#!/usr/bin/env tsx
/**
 * Mobile-first enforcement.
 *
 * WHY: "mobile-first" is a claim every project makes and almost none can prove.
 * A constraint that is not mechanically enforced is a preference, and preferences
 * decay. This script is the enforcement. It reads `apps/web/src` and fails the
 * build on the seven patterns that are only ever written by someone designing at
 * 1440px and shrinking afterwards.
 *
 * Escape hatch: a line containing `mobile-first-ignore` is skipped. Use it with a
 * reason on the same line; a reviewer will read it.
 *
 * Exit 0 = clean, exit 1 = violations, exit 2 = the check could not run.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const SCAN_ROOT = path.join(REPO_ROOT, 'apps', 'web', 'src');

const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.css', '.scss', '.html']);
const IGNORE_MARKER = 'mobile-first-ignore';

/** Tailwind's stock palette. Using it directly means the design tokens were bypassed. */
const DEFAULT_PALETTE = [
  'slate',
  'gray',
  'zinc',
  'neutral',
  'stone',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
].join('|');

const COLOR_UTILITIES = [
  'bg',
  'text',
  'border',
  'ring',
  'divide',
  'outline',
  'from',
  'via',
  'to',
  'fill',
  'stroke',
  'accent',
  'caret',
  'decoration',
  'placeholder',
  'shadow',
].join('|');

/**
 * The one file allowed to contain colour literals — the palette itself has to be
 * written down somewhere. Exactly the same shape as the brand rule: one source of
 * truth, and a check that keeps it the only one.
 */
const PALETTE_SOURCE = /^apps\/web\/src\/styles\/tokens\.css$/;

interface Rule {
  id: string;
  /** One line, printed next to every hit. Says what to do instead. */
  why: string;
  pattern: RegExp;
  /** Restrict to certain extensions; omitted means all scanned extensions. */
  extensions?: ReadonlySet<string>;
  /** Repo-relative paths this rule does not apply to. */
  exempt?: RegExp;
}

const RULES: readonly Rule[] = [
  {
    id: 'max-width-media-query',
    why: 'Breakpoints may only ADD via min-width. A max-width query is desktop-first by definition.',
    pattern: /@media[^{;]*max-width/gi,
  },
  {
    id: 'tailwind-max-variant',
    why: "Tailwind's max-* variants are max-width queries wearing a hat. Style the small viewport as the base instead.",
    pattern: /\bmax-(sm|md|lg|xl|2xl)\s*:/g,
  },
  {
    id: 'full-viewport-width',
    why: '100vw ignores the scrollbar gutter and produces horizontal overflow. Use 100% or a max-width container.',
    pattern: /\b100vw\b/g,
  },
  {
    id: 'bare-vh-unit',
    why: 'Bare vh is wrong the moment a mobile URL bar moves. Use dvh, svh or lvh.',
    pattern: /\d(?:\.\d+)?vh\b/g,
  },
  {
    id: 'raw-hex-colour',
    why: 'Colour is declared once, in styles/tokens.css. A hex literal anywhere else cannot follow the theme.',
    pattern: /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/g,
    exempt: PALETTE_SOURCE,
  },
  {
    id: 'default-tailwind-palette',
    why: 'Stock Tailwind palette classes bypass the design tokens and will not respond to a theme change.',
    pattern: new RegExp(
      `\\b(?:${COLOR_UTILITIES})-(?:${DEFAULT_PALETTE})-(?:50|100|200|300|400|500|600|700|800|900|950)\\b`,
      'g',
    ),
  },
  {
    id: 'inline-colour-style',
    why: 'Inline colour styles are invisible to the token system, the theme switch and the dark-mode audit.',
    // Matches a style={{ ... }} block (up to 400 chars) that mentions colour or background.
    pattern:
      /style=\{\{(?:(?!\}\})[\s\S]){0,400}?\b(?:color|background|backgroundColor|backgroundImage)\b/g,
  },
];

interface Violation {
  file: string;
  line: number;
  column: number;
  rule: string;
  why: string;
  excerpt: string;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '.turbo') continue;
      out.push(...walk(full));
      continue;
    }
    if (SCAN_EXTENSIONS.has(path.extname(entry))) out.push(full);
  }
  return out;
}

/** Byte offset -> 1-indexed line/column, so whole-file regexes can report a location. */
function locate(content: string, index: number): { line: number; column: number } {
  let line = 1;
  let lastNewline = -1;
  for (let i = 0; i < index; i += 1) {
    if (content.charCodeAt(i) === 10) {
      line += 1;
      lastNewline = i;
    }
  }
  return { line, column: index - lastNewline };
}

function checkFile(absolute: string): Violation[] {
  const relative = path.relative(REPO_ROOT, absolute).split(path.sep).join('/');
  const content = readFileSync(absolute, 'utf8');
  const lines = content.split(/\r?\n/);
  const extension = path.extname(absolute);
  const violations: Violation[] = [];

  for (const rule of RULES) {
    if (rule.extensions && !rule.extensions.has(extension)) continue;
    if (rule.exempt?.test(relative)) continue;
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    let match: RegExpExecArray | null = re.exec(content);
    while (match !== null) {
      const { line, column } = locate(content, match.index);
      const sourceLine = lines[line - 1] ?? '';
      if (!sourceLine.includes(IGNORE_MARKER)) {
        violations.push({
          file: relative,
          line,
          column,
          rule: rule.id,
          why: rule.why,
          excerpt: match[0].replace(/\s+/g, ' ').slice(0, 90),
        });
      }
      if (match.index === re.lastIndex) re.lastIndex += 1;
      match = re.exec(content);
    }
  }

  return violations;
}

function main(): number {
  if (!existsSync(SCAN_ROOT)) {
    process.stdout.write(
      'check-mobile-first: apps/web/src does not exist yet — nothing to check\n',
    );
    return 0;
  }

  const files = walk(SCAN_ROOT);
  const violations = files.flatMap(checkFile);

  if (violations.length === 0) {
    process.stdout.write(
      `check-mobile-first: clean (${files.length} files, ${RULES.length} rules)\n`,
    );
    return 0;
  }

  violations.sort(
    (a, b) => a.rule.localeCompare(b.rule) || a.file.localeCompare(b.file) || a.line - b.line,
  );

  process.stderr.write(`check-mobile-first: ${violations.length} violation(s)\n\n`);
  let currentRule = '';
  for (const v of violations) {
    if (v.rule !== currentRule) {
      currentRule = v.rule;
      process.stderr.write(`\n[${v.rule}] ${v.why}\n`);
    }
    process.stderr.write(`  ${v.file}:${v.line}:${v.column}  ${v.excerpt}\n`);
  }
  process.stderr.write(
    `\nEvery screen is designed at 375px first. Breakpoints only ever add.\n` +
      `If a hit is genuinely correct, append \`${IGNORE_MARKER}\` and a reason to that line.\n`,
  );
  return 1;
}

process.exit(main());
