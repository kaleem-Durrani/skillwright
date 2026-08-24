-- Prerequisites: the catalogue has always been a level ladder by design —
-- 101 -> 201/202 -> 301 in every department — but the ladder lived only in the
-- names. Nothing answered "must this course come after another?", so a teacher
-- who spotted a gap by eye typed a rejection note by hand.
--
-- One optional pointer on Course itself. A course has at most one direct
-- prerequisite; longer chains fall out of pointing each rung at the one below
-- it. Enforcement lives in policy (`hasCompletedPrerequisite` on
-- `enrollment:request`) — the database carries the fact, not the rule.
--
-- onDelete: SetNull, not Restrict or Cascade. Retiring the prerequisite must not
-- delete (or strand) every course that pointed at it: Cascade would destroy real
-- courses because their ladder rung went away, Restrict would make the rung
-- undeletable forever. Clearing the pointer degrades honestly to "no
-- prerequisite".
--
-- The index serves the catalogue read, which now resolves one prerequisite per
-- row of GET /courses.

-- AlterTable
ALTER TABLE "Course" ADD COLUMN "prerequisiteCourseId" TEXT;

-- CreateIndex
CREATE INDEX "Course_prerequisiteCourseId_idx" ON "Course"("prerequisiteCourseId");

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_prerequisiteCourseId_fkey" FOREIGN KEY ("prerequisiteCourseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;
