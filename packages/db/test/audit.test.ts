import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { AUDITED_MODELS, getAuditContext, withAuditContext } from '../src/audit.js';

/**
 * The two properties of the audit extension that can be pinned without a database.
 *
 * Everything else in audit.ts — the redaction pass, the diff, the action inference,
 * the interceptors — needs a Prisma client, and apps/api/test/audit.test.ts already
 * drives all of it against real Postgres. Duplicating that here with a fake client
 * would test the fake. What apps/api structurally CANNOT reach is below.
 */

const here = dirname(fileURLToPath(import.meta.url));

describe('the ambient actor context', () => {
  test('does not leak between concurrent scopes', async () => {
    /**
     * The whole design rests on this. `withAuditContext` exists so that thirty call
     * sites do not each have to remember to pass an actor — the API sets it once per
     * request, in a hook, and every write underneath inherits it.
     *
     * The plausible regression is someone replacing AsyncLocalStorage with a
     * module-level variable, which is simpler, reads correctly, and passes any
     * sequential test. It fails only when two requests overlap — and then every
     * audit row names whichever request set the variable last. An append-only trail
     * that attributes an action to the wrong person is worse than one with a gap,
     * because nothing downstream can tell that it is wrong.
     *
     * So the assertion has to interleave: each scope reads its actor AFTER awaiting,
     * with the delays arranged so the two scopes are provably in flight together.
     */
    const order: string[] = [];

    async function scope(actorId: string, delayMs: number): Promise<string | null | undefined> {
      return withAuditContext({ actorId }, async () => {
        order.push(`enter:${actorId}`);
        await new Promise((r) => setTimeout(r, delayMs));
        order.push(`resume:${actorId}`);
        return getAuditContext()?.actorId;
      });
    }

    const [first, second] = await Promise.all([scope('admin-1', 20), scope('teacher-2', 5)]);

    assert.equal(first, 'admin-1');
    assert.equal(second, 'teacher-2');
    // Proves the two scopes actually overlapped rather than running back to back; a
    // sequential run would read enter/resume/enter/resume and prove nothing.
    assert.deepEqual(order, [
      'enter:admin-1',
      'enter:teacher-2',
      'resume:teacher-2',
      'resume:admin-1',
    ]);
  });

  test('is undefined outside a scope, so system work is recorded as system work', () => {
    // The seed, the upload sweeper and any future cron job write with no actor. The
    // contract is `undefined` here and `actorId: null` on the row — not a stale actor
    // left behind by the last request that happened to run on this process.
    assert.equal(getAuditContext(), undefined);
  });
});

describe('AUDITED_MODELS', () => {
  test('names only models that exist in schema.prisma', () => {
    /**
     * `delegateFor()` turns a model name into a client property — `'User'` becomes
     * `base.user` — and returns `undefined` for anything that is not a delegate. The
     * failure is completely silent: `before` becomes `null`, and `deriveUpdateAction`
     * returns a bare `'UPDATE'` for every mutation because SUSPEND, REINSTATE,
     * MFA_ENABLE, MFA_DISABLE, APPROVE, REJECT, PUBLISH, DELETE and RESTORE all
     * require a before-image to be inferred. So a typo, or a model renamed in
     * schema.prisma without this set being updated, does not throw and does not log —
     * the audit trail just quietly stops recording WHAT changed for that model.
     *
     * Checked against schema.prisma rather than against `Prisma.dmmf`, because the
     * generated client can be stale and the schema is what a migration actually
     * renames. A stale client would let a dmmf check agree with itself.
     */
    const schema = readFileSync(resolve(here, '../prisma/schema.prisma'), 'utf8');
    const declared = new Set<string>();
    for (const match of schema.matchAll(/^model\s+(\w+)\s*\{/gm)) {
      if (match[1] !== undefined) declared.add(match[1]);
    }

    assert.ok(declared.size > 0, 'parsed no models out of schema.prisma — the regex is wrong');

    const undeclared = [...AUDITED_MODELS].filter((model) => !declared.has(model));
    assert.deepEqual(
      undeclared,
      [],
      `AUDITED_MODELS names ${undeclared.join(', ')}, which schema.prisma does not declare`,
    );
  });
});
