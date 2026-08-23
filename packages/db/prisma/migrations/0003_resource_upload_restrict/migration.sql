-- Resource.uploadId stops lying about what happens when an Upload is deleted.
--
-- 0001 made the foreign key ON DELETE SET NULL, and 0002 then added
-- `resource_exactly_one_source`: CHECK (num_nonnulls("uploadId", "externalUrl") = 1).
-- Together those say "clear the column, and also never let it be clear". Deleting an
-- Upload that backs a Resource nulls the column, the CHECK rejects the resulting row,
-- and the DELETE aborts — so SET NULL has always BEHAVED as RESTRICT, while reporting a
-- check-constraint violation about a column the caller never mentioned.
--
-- RESTRICT is what the pair already amounted to, and it says so: the failure names the
-- foreign key, Prisma raises P2003, and errors.plugin.ts:78-82 turns that into a 409
-- "still referenced elsewhere" instead of an untranslated 500.
--
-- The column stays NULLABLE. A LINK resource has no upload at all; what changes is only
-- what the database does when an Upload someone still points at is deleted.
--
-- Ordering, unchanged by this migration but easier to reason about now: delete the
-- Resource, then the Upload. `User` cascades to `Upload`, so deleting a user who owns an
-- upload that still backs a resource fails here rather than three constraints later —
-- which is why apps/api/test/setup.ts clears resources before users.

ALTER TABLE "Resource" DROP CONSTRAINT "Resource_uploadId_fkey";

ALTER TABLE "Resource"
    ADD CONSTRAINT "Resource_uploadId_fkey"
    FOREIGN KEY ("uploadId") REFERENCES "Upload"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
