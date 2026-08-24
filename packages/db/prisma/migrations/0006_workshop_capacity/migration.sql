-- Workshop capacity: a second guarded number on the SAME seat counter.
--
-- A CNC course is capped at 10 by admissions because that is the cohort policy,
-- but seats only 5 because there are five working lathes. Phase 7 adds that
-- second bound as one nullable column — nullable means unbound, so a lecture
-- course with no workshop carries no number at all rather than a fake zero.
-- It is deliberately NOT an equipment inventory: no serial numbers, no
-- maintenance schedules, no asset tracking. One guarded number, nothing else.
--
-- There is no workshopApprovedCount. The column bounds the SAME approvedCount
-- that `capacity` does, so approval seats only while BOTH hold — ADR 0006's
-- conditional atomic increment with a second term in the same WHERE
-- (enrollments.service.ts, approve()). The row lock that UPDATE takes still
-- serializes concurrent approvals on the course; the extra term cannot weaken
-- that.
--
-- The CHECK follows migration 0002's style: a rule the database holds is a rule
-- no code path can route around. IS NULL OR > 0 keeps "unbound" distinct from
-- "full" — a workshop of zero seats is not a thing; clearing the bound is what
-- null is for.

-- AlterTable
ALTER TABLE "Course" ADD COLUMN "workshopCapacity" INTEGER;

ALTER TABLE "Course"
    ADD CONSTRAINT course_workshop_capacity_sane
    CHECK ("workshopCapacity" IS NULL OR "workshopCapacity" > 0);
