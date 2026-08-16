#!/usr/bin/env tsx
/**
 * Regenerates `docs/permissions.md` from the policy module itself.
 *
 * WHY: authorization documentation written by hand is wrong within a month, and a
 * wrong permission table is worse than none — it tells a reviewer the rules are
 * one thing while the code does another. This generator makes the document a
 * projection of the policy rather than a description of it, and `--check` wires
 * that projection into CI. Documentation that cannot go stale.
 *
 * Usage:
 *   pnpm docs:permissions              # write docs/permissions.md
 *   pnpm docs:permissions -- --check   # exit 1 if the checked-in file is stale
 *
 * The role matrix is read straight out of `POLICY` — every cell is the
 * `ruleName` the policy itself carries, so no interpretation happens here. The
 * state matrix below it is EVALUATED through `can()`, because the status and
 * provenance gates live in `can()` rather than in the table, and evaluating them
 * is the only honest way to document them.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ACTIONS, POLICY, can } from '@skillwright/shared/policy';
import type { Action, Actor, Role, Subject } from '@skillwright/shared/policy';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const OUTPUT = path.join(REPO_ROOT, 'docs', 'permissions.md');

const ROLES = ['STUDENT', 'TEACHER', 'ADMIN'] as const satisfies readonly Role[];

const ALLOW = '✓';
const DENY = '✗';
const ACTOR_ID = 'usr_actor';

/**
 * A subject that satisfies every positive rule at once: the actor owns it, wrote
 * it, is enrolled in it, participates in it, and it is public and published.
 *
 * That is deliberate. In the state matrix a denial against THIS subject cannot be
 * blamed on the subject, so every ✗ there is attributable to account status or
 * session provenance alone — which is exactly the invariant the table exists to
 * demonstrate.
 */
const PERMISSIVE_SUBJECT: Subject = {
  id: 'sub_1',
  userId: ACTOR_ID,
  authorId: ACTOR_ID,
  courseId: 'crs_1',
  courseTeacherId: ACTOR_ID,
  studentId: ACTOR_ID,
  enrollmentStatus: 'APPROVED',
  isPublic: true,
  publishedAt: new Date('2026-01-01T00:00:00.000Z'),
  deletedAt: null,
  departmentId: 'dep_1',
  participantIds: [ACTOR_ID],
  senderId: ACTOR_ID,
};

/** Terminal rules get a glyph; conditional rules speak for themselves. */
function renderRuleName(ruleName: string): string {
  if (ruleName === 'allow') return `${ALLOW} allow`;
  if (ruleName === 'deny') return `${DENY} deny`;
  return `\`${ruleName}\``;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|');
}

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  return [
    `| ${header.map(escapeCell).join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((cells) => `| ${cells.map(escapeCell).join(' | ')} |`),
  ].join('\n');
}

const sortedActions: readonly Action[] = [...ACTIONS].sort();

/** Rows = actions, columns = caller class, cells = the rule name. Read, not evaluated. */
function roleMatrix(): string {
  const header = ['Action', 'Anonymous', 'Student', 'Teacher', 'Admin'];
  const rows = sortedActions.map((action) => {
    const entry = POLICY[action];
    return [
      `\`${action}\``,
      renderRuleName(entry.anonymous.ruleName),
      ...ROLES.map((role) => renderRuleName(entry[role].ruleName)),
    ];
  });
  return table(header, rows);
}

interface StateVariant {
  label: string;
  actor: Actor;
}

const STATE_VARIANTS: readonly StateVariant[] = [
  {
    label: 'ACTIVE / PASSWORD',
    actor: { id: ACTOR_ID, role: 'TEACHER', status: 'ACTIVE', provenance: 'PASSWORD' },
  },
  {
    label: 'PENDING_VERIFICATION',
    actor: {
      id: ACTOR_ID,
      role: 'TEACHER',
      status: 'PENDING_VERIFICATION',
      provenance: 'PASSWORD',
    },
  },
  {
    label: 'SUSPENDED',
    actor: { id: ACTOR_ID, role: 'TEACHER', status: 'SUSPENDED', provenance: 'PASSWORD' },
  },
  {
    label: 'MFA_PENDING',
    actor: { id: ACTOR_ID, role: 'TEACHER', status: 'ACTIVE', provenance: 'MFA_PENDING' },
  },
  {
    label: 'DEMO',
    actor: { id: ACTOR_ID, role: 'TEACHER', status: 'ACTIVE', provenance: 'DEMO' },
  },
];

/** Evaluated, because these gates live in `can()` and not in the table. */
function stateMatrix(): string {
  const header = ['Action', ...STATE_VARIANTS.map((v) => `\`${v.label}\``)];
  const rows = sortedActions.map((action) => [
    `\`${action}\``,
    ...STATE_VARIANTS.map((variant) => {
      const result = can(variant.actor, action, PERMISSIVE_SUBJECT);
      return result.allowed ? ALLOW : `${DENY} \`${result.rule}\``;
    }),
  ]);
  return table(header, rows);
}

/** Counts that make the coverage claim checkable rather than rhetorical. */
function counts(): { actions: number; cells: number; stateCells: number } {
  return {
    actions: ACTIONS.length,
    cells: ACTIONS.length * (ROLES.length + 1),
    stateCells: ACTIONS.length * STATE_VARIANTS.length,
  };
}

function render(): string {
  const { actions, cells, stateCells } = counts();
  return `<!-- GENERATED FILE — DO NOT EDIT BY HAND.
     Produced by scripts/generate-permissions-doc.ts from @skillwright/shared/policy.
     Regenerate with \`pnpm docs:permissions\`. CI runs it with --check and fails
     the build when this file and the policy disagree. -->

# Permission matrix

Every cell below comes from the policy module in \`packages/shared/src/policy\`. The
role matrix is read directly out of \`POLICY\`; the state matrix is produced by
calling \`can()\`. Nothing here was written by hand, which is why it cannot
disagree with the code — and if it ever did, the \`permissions-doc\` job in CI
would fail before the change could merge.

- **${actions}** actions, derived from the policy object's own keys
- **${cells}** cells in the role matrix
- **${stateCells}** cells in the state matrix
- Asserted independently in \`packages/shared/test/policy-matrix.test.ts\`

## Reading a cell

| Cell | Meaning |
| --- | --- |
| \`${ALLOW} allow\` | Permitted unconditionally for that caller class. |
| \`${DENY} deny\` | Refused unconditionally. |
| \`ruleName\` | Permitted only when that named rule holds for the subject. |
| \`${DENY} rule\` | In the state matrix: refused, and the rule that refused. |

Rule names are the identifiers exported from \`policy/combinators.ts\`. A composed
rule reports its composition — \`or(isPublic, enrolledApproved)\` — so the table
says what the code says, in the code's own words.

## Role matrix

The subject is whatever the caller loaded. \`allow\` needs nothing; every other
rule reads named fields off \`Subject\` and denies when they are absent.

${roleMatrix()}

## Account status and session provenance

Status and provenance are checked in \`can()\` **before** any role rule runs, so no
permissive role rule can be reached by a caller who should not be there.

Every column below is the same \`TEACHER\` actor, evaluated against a subject that
satisfies every positive rule at once — it is owned, authored, enrolled and
published. Any \`${DENY}\` in this table is therefore caused by the actor's state
alone, never by the subject.

Three invariants are visible in it, and each is what the column is for:

1. **\`SUSPENDED\` denies everything.** No exceptions, including \`mfa:verify\`.
2. **\`PENDING_VERIFICATION\` denies everything except \`mfa:verify\`.** An
   unverified account can finish authenticating and nothing else.
3. **\`MFA_PENDING\` denies everything except \`mfa:verify\`.** A session that has
   passed a password check but not a second factor can only complete its login.

The \`DEMO\` column shows the read-everything / destroy-nothing shape of the public
demo: reads and ordinary mutations pass, deletions and suspensions do not.

${stateMatrix()}
`;
}

function main(): number {
  const check = process.argv.includes('--check');
  const generated = render();

  if (!check) {
    mkdirSync(path.dirname(OUTPUT), { recursive: true });
    writeFileSync(OUTPUT, generated, 'utf8');
    process.stdout.write(
      `generate-permissions-doc: wrote docs/permissions.md (${ACTIONS.length} actions)\n`,
    );
    return 0;
  }

  let existing: string;
  try {
    existing = readFileSync(OUTPUT, 'utf8');
  } catch {
    process.stderr.write('generate-permissions-doc: docs/permissions.md is missing.\n');
    process.stderr.write('Run `pnpm docs:permissions` and commit the result.\n');
    return 1;
  }

  if (existing.replace(/\r\n/g, '\n') === generated) {
    process.stdout.write('generate-permissions-doc: docs/permissions.md is current\n');
    return 0;
  }

  process.stderr.write(
    'generate-permissions-doc: docs/permissions.md is STALE.\n\n' +
      'The policy and its documentation disagree. That is the failure this job exists\n' +
      'to catch. Run `pnpm docs:permissions` and commit the regenerated file.\n',
  );
  return 1;
}

process.exit(main());
