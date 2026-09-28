-- The training itself.
--
-- `docs/roadmap/00-FEATURE-PLAN.md:44-45` cut certificates and assessment on purpose,
-- on the reasoning "Pick realtime OR assessment, not both." Round one then built
-- everything AROUND the missing half: a student can be seated (0004's register), can
-- be marked present, can be issued published course material, and — since migration
-- 0009 — can be recorded COMPLETED. What they cannot do is hand anything in, and
-- nothing can be marked. A vocational school exists to issue a qualification, and a
-- qualification with no grade behind it is a completion date.
--
-- `docs/roadmap/10-FEATURE-PLAN.md` reverses that cut and this migration is the debt
-- being paid. Four shapes were argued rather than reached for:
--
--   1. `Assignment.offeringId`, NOT `courseId`. A deadline belongs to an intake. A
--      template that is re-run five times a year has five different deadlines, five
--      different briefs and five different sets of hand-ins, and the register, the
--      seats and the exports are all already per-intake since migration 0007. An
--      assignment hung off the template would have put a single March deadline on
--      the autumn cohort as well, which is the bug 0007 exists to end.
--
--   2. `Submission.enrollmentId`, NOT `studentId`. A seat is required before a hand-in
--      — a submission from somebody who was never seated is a row nobody can
--      reconcile against a register. `Enrollment` is already "this student holds this
--      seat in this intake", it is the row the register rides (migration 0004), and
--      the policy layer already has the `enrolledApproved` combinator to gate on. A
--      `studentId` here would have been a second, parallel way to say who a student
--      is, and the two could disagree.
--
--   3. `@@unique([assignmentId, enrollmentId, attempt])`. A resubmission is a NEW ROW
--      and the history survives. Overwriting the first hand-in would destroy the only
--      record of what a student turned in before their teacher read it, and a grader
--      who reconsiders would silently rewrite the evidence. The same discipline as
--      `AttendanceRecord @@unique([enrollmentId, sessionDate])` (migration 0004),
--      where marking twice CORRECTS; here, hand-in twice is two facts rather than one
--      corrected one.
--
--   4. `Submission.score` is a `Decimal(10,2)`, not an integer. Grades out of 100 hide
--      a half mark; a trade assessment is frequently recorded as a percentage, and a
--      column that cannot hold 62.5 makes the teacher round it in their head before
--      writing it down.
--
-- `ResourceType` gains `ASSIGNMENT`, which REVERSES a deliberate refusal recorded at
-- `enum ResourceType` in schema.prisma — "ASSIGNMENT and QUIZ are deliberately
-- absent: the assessment
-- engine is out of scope, and a reserved enum value is an invitation to build it."
-- The reservation was correct while there was no engine. It is wrong now, for the
-- reason the comment itself names: an assignment's brief is a document a school
-- already files as course material — the welding procedure, the drawing, the
-- candidate guidance — and the alternative was a second attachment mechanism for
-- bytes this one already stores, with its own presign/commit path and its own
-- visibility rules. `resourceId` is therefore a REAL Resource row, not an Upload:
-- the brief is course material that already has an author, a public flag and a
-- course-scoped visibility answer, and re-deciding those here would be a second
-- policy mirror (LESSONS-LEARNED #28).
--
-- `onDelete` is explicit on every relation, per schema design rule 2. Two of them are
-- worth reading rather than skimming:
--
--   - `Assignment.resourceId` is `SetNull`. A brief is attached material, and deleting
--     the RESOURCE must not delete the assignment — an assessment whose text has been
--     superseded still has a deadline and still has hand-ins against it. Clearing the
--     pointer degrades honestly to "no uploaded brief".
--   - `Submission.uploadId` is `Restrict`, the action migration 0003 gave
--     `Resource.uploadId` for the same reason. The bytes ARE the hand-in; deleting
--     them under a live submission would destroy assessment evidence, and
--     `Submission.uploadId` is `@unique` precisely so one upload backs exactly one
--     submission. The counterpart of a soft-deleted Submission is therefore
--     `deletedAt`, which is what every read filters.
--
-- `gradedById` is `SetNull`, matching `Enrollment.decidedById` and
-- `Enrollment.completedById`: who signed the record has to outlive their account, and
-- a teacher who later leaves must not take the grades they gave with them.
--
-- Both CHECK constraints are the database holding an invariant the application also
-- checks, in the spirit of schema design rule 5: a task worth zero points, and a
-- negative mark, are both data-entry accidents rather than intentions, and the
-- certificate in Phase 3 will divide a total by `maxScore`.
--
-- `ADD VALUE` on `ResourceType` is metadata-only in Postgres — no table rewrite, no
-- row touched, every existing resource keeps the value it was written with.
--
-- Migrations are APPLIED, never pushed: `prisma migrate deploy` replays this file, so
-- the SQL below is the only description of the change that has to stay true.

-- AlterEnum
ALTER TYPE "ResourceType" ADD VALUE 'ASSIGNMENT';

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('SUBMITTED', 'GRADED', 'RETURNED');

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "brief" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "maxScore" DECIMAL(10,2) NOT NULL,
    "resourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "assignment_max_score_positive" CHECK ("maxScore" > 0)
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "score" DECIMAL(10,2),
    "feedback" TEXT,
    "gradedById" TEXT,
    "gradedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "submission_attempt_positive" CHECK ("attempt" > 0),
    CONSTRAINT "submission_score_not_negative" CHECK ("score" IS NULL OR "score" >= 0)
);

-- CreateIndex
CREATE INDEX "Assignment_offeringId_dueAt_idx" ON "Assignment"("offeringId", "dueAt");

-- CreateIndex
CREATE INDEX "Assignment_resourceId_idx" ON "Assignment"("resourceId");

-- CreateIndex
CREATE INDEX "Assignment_deletedAt_idx" ON "Assignment"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_assignmentId_enrollmentId_attempt_key" ON "Submission"("assignmentId", "enrollmentId", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_uploadId_key" ON "Submission"("uploadId");

-- CreateIndex
CREATE INDEX "Submission_assignmentId_status_idx" ON "Submission"("assignmentId", "status");

-- CreateIndex
CREATE INDEX "Submission_enrollmentId_idx" ON "Submission"("enrollmentId");

-- CreateIndex
CREATE INDEX "Submission_gradedById_idx" ON "Submission"("gradedById");

-- CreateIndex
CREATE INDEX "Submission_deletedAt_idx" ON "Submission"("deletedAt");

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "CourseOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_gradedById_fkey" FOREIGN KEY ("gradedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
