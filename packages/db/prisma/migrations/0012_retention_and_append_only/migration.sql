-- Phase 7 and 8: retention, sweeping, and making the append-only claim true.
--
-- Migrations are APPLIED, never pushed: `prisma migrate deploy` replays this file, so the
-- SQL below is the only description of the change that has to stay true. Everything here
-- is deliberately NOT representable in schema.prisma — a trigger and a function are, by
-- definition, outside that language — and nothing here touches a column, a row or a
-- constraint, so it runs instantly against a populated database and a partially-applied
-- replay is a no-op.
--
-- ===========================================================================
-- 1. The append-only audit trail, for real
-- ===========================================================================
--
-- `SECURITY.md` claimed the audit log was append-only because migration 0002 revoked
-- UPDATE and DELETE from the application role. That REVOKE is COMMENTED OUT at
-- 0002_constraints/migration.sql:107-110, and it was commented out for a sound reason
-- that also means it would not have worked here:
--
--   0002 lines 99-101: the statements "must run as the *owner* of the table against the
--   *application* role, and in local development both are the same role ("skillwright")".
--
-- Measured against the compose Postgres, `SELECT current_user, rolsuper` from the
-- connection the API actually uses returns:
--
--   current_user | rolsuper | pg_get_userbyid(relowner of "AuditEvent")
--   -------------+----------+-------------------------------------------
--   skillwright  | t        | skillwright
--
-- Every privilege check is therefore a no-op: a REVOKE from a superuser is not a
-- restriction, and the application role is also the table's OWNER, so it would hold
-- every privilege regardless of what the grant table says. Executing 0002's block
-- verbatim would have produced a migration that succeeds, changes nothing, and leaves
-- SECURITY.md's claim exactly as false as it was today. A guarantee that survives
-- review only because nobody re-ran the query is the lesson this migration exists to end.
--
-- A TRIGGER is not role-dependent, so it is the mechanism that actually binds here: it
-- fires for the owner, for a superuser, for a role created next year, and for raw SQL
-- issued by anything holding a connection to this database. What it does NOT survive is
-- a deliberate `ALTER TABLE ... DISABLE TRIGGER` or a `DROP`, both of which require
-- table ownership. That is the honest boundary of the guarantee, and SECURITY.md now
-- states it rather than implying a stronger one.
--
-- TWO EXCEPTIONS, both deliberate, both narrow:
--
-- (a) The referential action. `AuditEvent.actorId` is `onDelete: SetNull`
--     (the `actor` relation on `AuditEvent`), and Postgres implements that as a literal
--     `UPDATE ONLY "public"."AuditEvent" SET "actorId" = NULL WHERE ...` issued from
--     inside the AFTER-DELETE trigger on "User". Measured: a BEFORE UPDATE trigger that
--     raises unconditionally makes EVERY `DELETE FROM "User"` fail with
--     'AuditEvent is append-only; UPDATE is not permitted', which would have taken out
--     `prisma.user.deleteMany` in `resetDatabase` (apps/api/test/setup.ts) — the fixture every suite
--     runs — along with every real user deletion and the admin paths built on it.
--     Nulling a foreign key is the database maintaining its own integrity, not an
--     application rewriting history, so it is allowed through: `pg_trigger_depth() > 1`
--     is true for any UPDATE issued from within another trigger, which is precisely the
--     referential-action machinery. A direct UPDATE from application SQL runs at depth 1
--     and is still refused, and the test proves both halves.
--
-- (b) Retention pruning. Phase 7's audit pruner deletes rows that have outlived the
--     configured window, and a table that refuses every DELETE cannot be pruned at all —
--     the mechanism and the guarantee have to be reconciled rather than one cancelled.
--     The escape hatch is a session flag, `skillwright.audit_prune`, so the ONLY way to
--     delete an audit row is inside a transaction that has explicitly declared itself a
--     retention prune. Ordinary DML cannot reach it, and the declaration is greppable in
--     the pruner that sets it. TRUNCATE is NOT given the flag: truncating the whole table
--     is not retention, because retention deletes the rows past a cutoff and truncation
--     deletes all of them.
--
-- REVERSIBILITY, documented because it was asked for: this is fully reversible with
--
--     DROP TRIGGER audit_event_append_only ON "AuditEvent";
--     DROP TRIGGER audit_event_no_truncate ON "AuditEvent";
--     DROP FUNCTION skillwright_audit_append_only();
--
-- and it is NOT reversible by a REVOKE, which is the point — there is no grant left to
-- give back. The trigger is created without IF NOT EXISTS deliberately: a name collision
-- is a migration that has already diverged, and failing loudly beats silently adopting
-- someone else's trigger. Dropping the triggers restores exactly the pre-0012
-- behaviour, which is to say: none at all.
-- ===========================================================================

CREATE FUNCTION skillwright_audit_append_only() RETURNS trigger AS $$
BEGIN
    -- (b) An explicit retention prune. See the header.
    IF TG_OP = 'DELETE' AND current_setting('skillwright.audit_prune', true) = 'on' THEN
        RETURN OLD;
    END IF;

    -- (a) The referential action, which is a trigger-issued UPDATE. Note this is checked
    -- BEFORE the raise and cannot be reached by TRUNCATE, which is statement-level and
    -- has no OLD row: a truncating session is refused whatever it set the flag to.
    IF TG_OP = 'UPDATE' AND pg_trigger_depth() > 1 THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'AuditEvent is append-only; % is not permitted', TG_OP
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_event_append_only
    BEFORE UPDATE OR DELETE ON "AuditEvent"
    FOR EACH ROW EXECUTE FUNCTION skillwright_audit_append_only();

CREATE TRIGGER audit_event_no_truncate
    BEFORE TRUNCATE ON "AuditEvent"
    FOR EACH STATEMENT EXECUTE FUNCTION skillwright_audit_append_only();

-- The claim the 0002 COMMENT made, restated as the table's own description, and
-- corrected: it now names a trigger that exists rather than a REVOKE that does not.
COMMENT ON TABLE "AuditEvent" IS
    'Append-only, enforced by trigger: UPDATE, DELETE and TRUNCATE are refused. See migration 0012.';

-- ===========================================================================
-- 2. Retention
-- ===========================================================================
--
-- No schema change accompanies the retention work, and that is the point worth writing
-- down: the retention WINDOW for "AuditEvent" is a policy decision that this repository
-- has not made. Phase 7 of docs/roadmap/10-FEATURE-PLAN.md says so in as many words —
-- "it is the compliance record, so its retention is a policy question, not a technical
-- one. Do not invent a number." So no number is invented here.
--
-- The mechanism ships (packages/db/src/retention/sweepers.ts, configured from
-- AUDIT_RETENTION_DAYS in apps/api/src/env.ts) and the window DEFAULTS TO KEEPING
-- EVERYTHING: unset, or set to 0, means the pruner deletes nothing and says so in the log
-- on every boot. A compliance record is never silently trimmed by a default, because the
-- failure is invisible for as long as nobody needs a row from four years ago, which is
-- the exact moment it cannot be recovered.
--
-- The Session, Verification and RecoveryCode sweepers need no window of this kind: they
-- select on EXPIRY, which the rows themselves carry, and their retention age is a
-- technical consequence of that rather than a policy choice.
