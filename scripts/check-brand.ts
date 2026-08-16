#!/usr/bin/env tsx
/**
 * Brand containment check.
 *
 * WHY: the previous incarnation of this project spelled its own name in 67 places
 * across 8 files, which is why renaming it was a multi-day chore instead of a
 * one-line diff. This script makes that failure mode impossible to reintroduce:
 * the product name may be spelled in exactly one file, and the old name may not
 * be spelled at all.
 *
 * Two independent rules:
 *
 *   1. NEW NAME CONTAINMENT — the literal product name (case-sensitive, because
 *      the lowercase form is the npm scope `@skillwright/*` and appears in every
 *      import) may appear under `apps/<x>/src` and `packages/<x>/src` only inside
 *      the brand module. Everything else imports BRAND.
 *
 *   2. OLD NAME ERADICATION — the previous product name may not appear anywhere
 *      in tracked source, in any casing.
 *
 * Exit 0 = clean, exit 1 = offences found (printed as file:line), exit 2 = the
 * check itself could not run.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

/** The one string that is allowed to exist in exactly one place. */
const PRODUCT_NAME = 'Skillwright';

/**
 * The previous product name. Spelled here and nowhere else — this file is
 * excluded from its own scan for that reason.
 */
const OLD_PRODUCT_NAME = 'millat';

/** The single file permitted to spell the product name. Both layouts accepted. */
const BRAND_MODULE = /^packages\/shared\/src\/brand(\.ts|\/[^/]+\.ts)$/;

/** Source roots the new-name rule applies to. */
const WORKSPACE_SRC = /^(apps|packages)\/[^/]+\/src\//;

/**
 * Legacy trees that are scheduled for deletion. They are still tracked, they are
 * full of the old name, and reformatting or rewriting them would only bury the
 * deletion diff. Their offences are counted and reported as a note, not a
 * failure. DELETE THESE ENTRIES (and the trees) once the rebuild lands.
 */
const PENDING_DELETION = ['backend/', 'frontend/'];

/** Never worth scanning: lockfiles, generated output, planning docs. */
const NEVER_SCAN = [
  'pnpm-lock.yaml',
  'package-lock.json',
  'docs/rebuild/',
  'packages/db/prisma/migrations/',
];

/** This file, relative to the repo root. It must be able to name the old brand. */
const SELF = 'scripts/check-brand.ts';

/**
 * Files whose entire job is to record what happened. The old name is load-bearing in
 * them: the backup bundle, the extracted secrets file and the pre-rewrite repository
 * all carry it in their real on-disk paths, and a log that cannot name the path it is
 * telling you about has stopped being a log.
 *
 * Exempt from the old-name rule ONLY. The product-name rule never reached them anyway,
 * being scoped to workspace `src/` roots.
 */
const HISTORICAL_RECORDS = new Set(['NEXT.md', 'docs/PROGRESS.md', 'docs/LESSONS-LEARNED.md']);

const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.css',
  '.scss',
  '.html',
  '.md',
  '.mdx',
  '.yml',
  '.yaml',
  '.prisma',
  '.sql',
  '.txt',
]);

interface Offence {
  file: string;
  line: number;
  column: number;
  text: string;
  rule: string;
  why: string;
}

/** Tracked files only — untracked scratch never fails a build. */
function trackedFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '-z'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split('\0').filter(Boolean);
}

function isScannable(file: string): boolean {
  if (file === SELF) return false;
  if (NEVER_SCAN.some((prefix) => file === prefix || file.startsWith(prefix))) return false;
  return TEXT_EXTENSIONS.has(path.extname(file));
}

function readLines(file: string): string[] {
  return readFileSync(path.join(REPO_ROOT, file), 'utf8').split(/\r?\n/);
}

/** Collect every match of `pattern` in `file` as an Offence. */
function scan(file: string, pattern: RegExp, rule: string, why: string): Offence[] {
  const found: Offence[] = [];
  const lines = readLines(file);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const re = new RegExp(
      pattern.source,
      pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`,
    );
    let match: RegExpExecArray | null = re.exec(line);
    while (match !== null) {
      found.push({
        file,
        line: i + 1,
        column: match.index + 1,
        text: line.trim().slice(0, 120),
        rule,
        why,
      });
      match = re.exec(line);
    }
  }
  return found;
}

function main(): number {
  let files: string[];
  try {
    files = trackedFiles();
  } catch {
    process.stderr.write('check-brand: not a git repository (or git is unavailable)\n');
    return 2;
  }

  const offences: Offence[] = [];
  let pendingDeletionHits = 0;

  for (const file of files) {
    if (!isScannable(file)) continue;

    const legacy = PENDING_DELETION.some((prefix) => file.startsWith(prefix));

    // Rule 2 — the old name, any casing, anywhere.
    const oldHits = HISTORICAL_RECORDS.has(file)
      ? []
      : scan(
          file,
          new RegExp(OLD_PRODUCT_NAME, 'gi'),
          'old-name',
          'The previous product name must not survive anywhere in tracked source.',
        );
    if (legacy) {
      pendingDeletionHits += oldHits.length;
    } else {
      offences.push(...oldHits);
    }

    if (legacy) continue;

    // Rule 1 — the product name, only in the brand module, only under a src root.
    if (!WORKSPACE_SRC.test(file)) continue;
    if (BRAND_MODULE.test(file)) continue;
    offences.push(
      ...scan(
        file,
        new RegExp(PRODUCT_NAME, 'g'),
        'new-name',
        `Import BRAND from '@skillwright/shared/brand' instead of spelling the product name.`,
      ),
    );
  }

  if (pendingDeletionHits > 0) {
    process.stdout.write(
      `note: ${pendingDeletionHits} occurrence(s) of the old name remain under ` +
        `${PENDING_DELETION.join(', ')} — excluded because those trees are pending deletion.\n\n`,
    );
  }

  if (offences.length === 0) {
    process.stdout.write(`check-brand: clean (${files.length} tracked files considered)\n`);
    return 0;
  }

  process.stderr.write(`check-brand: ${offences.length} offence(s)\n\n`);
  let currentRule = '';
  for (const o of offences) {
    if (o.rule !== currentRule) {
      currentRule = o.rule;
      process.stderr.write(`[${o.rule}] ${o.why}\n`);
    }
    process.stderr.write(`  ${o.file}:${o.line}:${o.column}  ${o.text}\n`);
  }
  process.stderr.write(
    `\nThe product name lives in packages/shared/src/brand.ts and nowhere else.\n`,
  );
  return 1;
}

process.exit(main());
