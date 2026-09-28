-- The terminal state, made reachable.
--
-- `EnrollmentStatus.COMPLETED` has been in the enum since the first migration, marked
-- terminal, given a status-chip colour in the SPA, and named by two Zod enums — and no
-- code anywhere wrote it. A vocational school exists to issue a qualification, and this
-- database could not record that a student finished one. The service said so itself:
-- "COMPLETED is terminal and has no endpoint in this module's contract — it is left
-- unreachable rather than given an unspecified verb."
--
-- What a certificate hangs on is the ENROLLMENT, not the offering. `CourseOffering` is
-- deliberately untouched: an intake is a calendar entry with a seat count, and when its
-- last cohort finished is a reporting nicety that can be derived from the enrollments
-- that name COMPLETED. Putting it on the offering would have meant a second, per-intake
-- counter to keep honest alongside the one above, for a number nobody registers against.
--
-- `onDelete: SetNull` on the new foreign key is not a default — it is the same
-- deliberate choice as `Enrollment.decidedById`, and for the same reason: the record of
-- WHO signed a qualification has to outlive the account, and the schema's design rule 2
-- requires an explicit action on every relation rather than an implicit one.
--
-- Both enum changes are ADD-only, and adding to an enum is metadata-only in Postgres —
-- no table rewrite, no row touched, every previously-written notification and audit
-- event keeps the value it was written with. This runs instantly on a populated
-- database.
--
-- Migrations are APPLIED, never pushed: `prisma migrate deploy` replays this file, so
-- the SQL below is the only description of the change that has to stay true.

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'COMPLETE';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'ENROLLMENT_COMPLETED';

-- AlterTable
ALTER TABLE "Enrollment" ADD COLUMN     "completedAt" TIMESTAMP(3),
                            ADD COLUMN     "completedById" TEXT;

-- CreateIndex
CREATE INDEX "Enrollment_completedById_idx" ON "Enrollment"("completedById");

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
