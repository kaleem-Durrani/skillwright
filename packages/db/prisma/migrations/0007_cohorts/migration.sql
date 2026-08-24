-- Cohorts and intakes: the Phase 9 data-model correction.
--
-- `Course` carried one startDate/endDate/capacity/workshopCapacity, so it modelled a
-- single term's offering. Trade schools run repeating intakes, and the product's own
-- copy already assumed them ("apply again for the spring cohort", "Spring intake
-- applications now open") without anything backing either sentence.
--
-- The split: `Course` becomes the repeatable TEMPLATE (identity, ladder, materials,
-- publication); the new `CourseOffering` carries everything that belongs to ONE run —
-- dates and the guarded seat numbers (ADR 0006). Enrolments repoint at the offering,
-- so seats are sold per intake and a student may hold histories in several intakes of
-- the same course. Attendance rides Enrollment, so intake-separated history falls out
-- of this split rather than being smuggled in (migration 0004's recorded caveat).
--
-- This migration is DATA-CARRYING, in the style of 0001's bulk inserts: every existing
-- Course becomes exactly one Offering that inherits its dates/capacities/counter, and
-- every existing Enrollment repoints onto its course's offering with no loss. On a
-- populated database the row counts before and after match exactly.

-- ---------------------------------------------------------------------------
-- 1. The new table
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "CourseOffering" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "workshopCapacity" INTEGER,
    "approvedCount" INTEGER NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CourseOffering_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- 2. The data carry — one offering per existing course
-- ---------------------------------------------------------------------------
--
-- Deterministic id (`'of_' || id`) so the mapping Course -> Offering is stable and
-- reproducible; nothing downstream ever parses it. createdAt/updatedAt are inherited
-- so audit-adjacent timestamps do not jump to the migration instant.

INSERT INTO "CourseOffering" ("id", "courseId", "capacity", "workshopCapacity", "approvedCount", "startDate", "endDate", "createdAt", "updatedAt")
SELECT 'of_' || c."id",
       c."id",
       c."capacity",
       c."workshopCapacity",
       c."approvedCount",
       c."startDate",
       c."endDate",
       c."createdAt",
       c."updatedAt"
  FROM "Course" c;

-- ---------------------------------------------------------------------------
-- 3. Repoint enrolments onto offerings
-- ---------------------------------------------------------------------------

ALTER TABLE "Enrollment" ADD COLUMN "offeringId" TEXT;

-- Correlated subquery, not a join-update: each enrollment's course has exactly one
-- offering at this point (the INSERT above created one per course), so the subquery
-- yields exactly one row or the FK below refuses the NULL.
UPDATE "Enrollment" e
   SET "offeringId" = (SELECT o."id" FROM "CourseOffering" o WHERE o."courseId" = e."courseId");

ALTER TABLE "Enrollment" ALTER COLUMN "offeringId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Enrollment_studentId_offeringId_key" ON "Enrollment"("studentId", "offeringId");

-- CreateIndex
CREATE INDEX "Enrollment_offeringId_status_idx" ON "Enrollment"("offeringId", "status");

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "CourseOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The old column and its company go only AFTER the new path is complete.
DROP INDEX IF EXISTS "Enrollment_studentId_courseId_key";
DROP INDEX IF EXISTS "Enrollment_courseId_status_idx";
ALTER TABLE "Enrollment" DROP CONSTRAINT "Enrollment_courseId_fkey";
ALTER TABLE "Enrollment" DROP COLUMN "courseId";

-- ---------------------------------------------------------------------------
-- 4. Foreign key from the offering to its course
-- ---------------------------------------------------------------------------

-- AddForeignKey
ALTER TABLE "CourseOffering" ADD CONSTRAINT "CourseOffering_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "CourseOffering_courseId_idx" ON "CourseOffering"("courseId");

-- CreateIndex
CREATE INDEX "CourseOffering_deletedAt_idx" ON "CourseOffering"("deletedAt");

-- ---------------------------------------------------------------------------
-- 5. Move the invariants with the numbers they guard
-- ---------------------------------------------------------------------------

-- ADR 0006's CHECKs bounded Course.approvedCount; the counter now lives on
-- CourseOffering, so the bounds follow it. Names carry the table they protect so a
-- violation message names the right model. Constraint names are unique PER TABLE in
-- Postgres, but distinct names keep pg_constraint queries unambiguous.

ALTER TABLE "Course" DROP CONSTRAINT IF EXISTS course_capacity_sane;
ALTER TABLE "Course" DROP CONSTRAINT IF EXISTS course_workshop_capacity_sane;
ALTER TABLE "Course" DROP CONSTRAINT IF EXISTS course_dates_ordered;

ALTER TABLE "CourseOffering"
    ADD CONSTRAINT course_offering_capacity_sane
    CHECK ("approvedCount" >= 0 AND "approvedCount" <= "capacity");

ALTER TABLE "CourseOffering"
    ADD CONSTRAINT course_offering_workshop_capacity_sane
    CHECK ("workshopCapacity" IS NULL OR "workshopCapacity" > 0);

-- An intake that ends before it begins is still a data-entry error.
ALTER TABLE "CourseOffering"
    ADD CONSTRAINT course_offering_dates_ordered
    CHECK ("endDate" IS NULL OR "startDate" IS NULL OR "endDate" > "startDate");

-- ---------------------------------------------------------------------------
-- 6. Strip the term-scoped columns from the template
-- ---------------------------------------------------------------------------

ALTER TABLE "Course" DROP COLUMN "capacity";
ALTER TABLE "Course" DROP COLUMN "approvedCount";
ALTER TABLE "Course" DROP COLUMN "workshopCapacity";
ALTER TABLE "Course" DROP COLUMN "startDate";
ALTER TABLE "Course" DROP COLUMN "endDate";

-- Left deliberately untouched:
--   * Course.searchVector and the trgm indexes (0002) — generated from name/code/
--     description, which all stay on the template, so ranked search keeps working
--     against Course without a join or a rebuild;
--   * Course.publishedAt — publication is a property of the thing the catalogue
--     lists; an offering's openness is expressed by its dates;
--   * AuditEvent rows — every entityType='Course' entityId still resolves (courses
--     kept their ids), and enrolment ids did not change either. New offering writes
--     log entityType='CourseOffering' through the extension once the model joins
--     AUDITED_MODELS.
