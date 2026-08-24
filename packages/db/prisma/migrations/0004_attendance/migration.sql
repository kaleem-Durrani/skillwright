-- Attendance: the compliance record the schema could not hear. The seed already
-- says "two students still need PPE sign-off"; nothing answered "was this student
-- here". A register row is a satellite on Enrollment — presence only means
-- something about a seat someone actually holds.
--
-- CAVEAT, recorded here because this is where a future reader will look first:
-- enrollment rows are reused forever on re-application (Enrollment's unique pair
-- carries no deletedAt), so history keyed to enrollmentId spans a student's
-- SEPARATE intakes of the same course in one thread. Register semantics are
-- deliberately DATE-SCOPED against that: "who was present on day D for course C"
-- reads the current APPROVED roster, and re-application does not disturb what an
-- instructor already marked. Intake-separated history arrives with Phase 9's
-- template/offering split; it is not smuggled in here.
--
-- The unique pair is what makes marking twice a CORRECTION rather than a
-- duplicate, mirroring Enrollment @@unique([studentId, courseId]).

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE');

-- CreateTable
CREATE TABLE "AttendanceRecord" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "sessionDate" DATE NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "markedById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRecord_enrollmentId_sessionDate_key" ON "AttendanceRecord"("enrollmentId", "sessionDate");

-- CreateIndex
CREATE INDEX "AttendanceRecord_sessionDate_idx" ON "AttendanceRecord"("sessionDate");

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_markedById_fkey" FOREIGN KEY ("markedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
