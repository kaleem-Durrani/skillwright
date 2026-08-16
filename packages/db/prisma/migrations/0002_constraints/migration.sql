-- Invariants and search structures that the Prisma schema language cannot express.
--
-- Everything in this file is deliberately *not* representable in schema.prisma. That is the
-- point: a rule the database holds is a rule no code path can route around, including the
-- code paths written next year by someone who never read this file.

-- ---------------------------------------------------------------------------
-- CHECK constraints
-- ---------------------------------------------------------------------------

-- A course cannot oversell. The approval transaction increments approvedCount and inserts
-- the enrollment together; if application logic is ever wrong about capacity, the INSERT
-- fails instead of quietly seating a 31st student in a 30-seat welding bay.
ALTER TABLE "Course"
    ADD CONSTRAINT course_capacity_sane
    CHECK ("approvedCount" >= 0 AND "approvedCount" <= "capacity");

-- One comment table serves resources and announcements, so exactly one parent column must
-- be set. Without this, a comment attached to neither (or both) is a legal row and every
-- read path needs a defensive branch.
ALTER TABLE "Comment"
    ADD CONSTRAINT comment_exactly_one_parent
    CHECK (num_nonnulls("resourceId", "announcementId") = 1);

-- A resource is either a stored object or a link, never both and never neither. "Neither"
-- is what produced the previous system's resources that rendered as a download button
-- pointing at undefined.
ALTER TABLE "Resource"
    ADD CONSTRAINT resource_exactly_one_source
    CHECK (num_nonnulls("uploadId", "externalUrl") = 1);

-- A course that ends before it begins is a data-entry error, not a business case.
ALTER TABLE "Course"
    ADD CONSTRAINT course_dates_ordered
    CHECK ("endDate" IS NULL OR "startDate" IS NULL OR "endDate" > "startDate");

-- ---------------------------------------------------------------------------
-- Full-text search
--
-- Generated columns rather than triggers: a STORED generated column cannot drift from its
-- source columns, because Postgres recomputes it on every write. A trigger can be dropped,
-- disabled, or bypassed by a bulk load, and then search silently stops finding new rows.
--
-- to_tsvector(regconfig, text) is IMMUTABLE only in its two-argument form with a literal
-- configuration, which is why 'english' is spelled out rather than relying on
-- default_text_search_config.
--
-- NOTE for future migrations: these columns are intentionally absent from schema.prisma
-- (Prisma has no tsvector type). `prisma migrate dev` will report them as drift. Either
-- keep using `prisma migrate diff --from-migrations`, or declare them in the schema as
-- `searchVector Unsupported("tsvector")?` when the schema is next allowed to change.
-- ---------------------------------------------------------------------------

ALTER TABLE "Course"
    ADD COLUMN "searchVector" tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce("name", '')), 'A') ||
        setweight(to_tsvector('english', coalesce("code", '')), 'A') ||
        setweight(to_tsvector('english', coalesce("description", '')), 'B')
    ) STORED;

CREATE INDEX "Course_searchVector_idx" ON "Course" USING GIN ("searchVector");

ALTER TABLE "Resource"
    ADD COLUMN "searchVector" tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
        setweight(to_tsvector('english', coalesce("description", '')), 'B')
    ) STORED;

CREATE INDEX "Resource_searchVector_idx" ON "Resource" USING GIN ("searchVector");

ALTER TABLE "Announcement"
    ADD COLUMN "searchVector" tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
        setweight(to_tsvector('english', coalesce("content", '')), 'B')
    ) STORED;

CREATE INDEX "Announcement_searchVector_idx" ON "Announcement" USING GIN ("searchVector");

-- Trigram indexes complement the tsvector ones: full-text search stems whole words, so it
-- cannot match a partial code like "WELD-2" or a misspelt name typed into a filter box.
CREATE INDEX "Course_name_trgm_idx" ON "Course" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "Course_code_trgm_idx" ON "Course" USING GIN ("code" gin_trgm_ops);
CREATE INDEX "Resource_title_trgm_idx" ON "Resource" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "Announcement_title_trgm_idx" ON "Announcement" USING GIN ("title" gin_trgm_ops);
-- User search in the admin console is name/email substring matching, not stemming.
CREATE INDEX "User_name_trgm_idx" ON "User" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "User_email_trgm_idx" ON "User" USING GIN (("email"::text) gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Append-only audit trail
--
-- The Prisma client extension in src/audit.ts guarantees that an audit row is *written*.
-- It cannot guarantee that one is never rewritten, because it runs with the same database
-- role as the rest of the application. Only the grant system can do that.
--
-- The statements below are left commented because they must run as the *owner* of the
-- table against the *application* role, and in local development both are the same role
-- ("skillwright") — running them here would lock the seed out of its own database.
--
-- In production the deploy pipeline runs migrations as an owner/DDL role and the API
-- connects as a separate, less privileged role. Execute these once, as the owner, after
-- this migration has been applied, substituting the real application role name:
--
--   REVOKE UPDATE, DELETE, TRUNCATE ON "AuditEvent" FROM skillwright_app;
--   GRANT  SELECT, INSERT            ON "AuditEvent" TO   skillwright_app;
--   -- and stop future migrations from silently handing the privilege back:
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE UPDATE, DELETE ON TABLES FROM skillwright_app;
--
-- After that, "append-only" is a property of Postgres rather than a property of everyone
-- remembering not to write an UPDATE.
-- ---------------------------------------------------------------------------

COMMENT ON TABLE "AuditEvent" IS
    'Append-only. UPDATE and DELETE must be revoked from the application role in production; see migration 0002.';
