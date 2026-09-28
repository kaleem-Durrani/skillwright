-- The product a vocational school exists to produce.
--
-- `docs/roadmap/00-FEATURE-PLAN.md:44` cut certificates on purpose, alongside assessment,
-- on the reasoning "Pick realtime OR assessment, not both." `10-FEATURE-PLAN.md` reverses
-- that cut and this migration is the last link in the chain it opens:
--
--     seat -> attend -> submit -> be assessed -> complete -> qualify -> verify
--     (0004)          (0010)                  (0009)     HERE      HERE
--
-- Everything up to `COMPLETED` shipped in migration 0009 and has been reachable since
-- commit d6327cd. What there was no way to do was record the outcome of a completion —
-- which is the only reason a training provider exists, and the reason this repository
-- held 0009's terminal state with nothing downstream of it for a phase.
--
-- THE SEED LISTS QUALIFICATIONS AND MODELS NONE OF THEM.
--
-- `packages/db/prisma/seed.ts:386-393` holds six real strings the school HOSTS:
--
--     City & Guilds Level 3 Diploma
--     NVQ Level 4 in Engineering Maintenance
--     BEng (Hons) Mechanical Engineering
--     CSWIP 3.1 Welding Inspector
--     HND Electrical & Electronic Engineering
--     F-Gas Category I Certification
--
-- and the ONLY place any of them is stored is `TeacherProfile.qualification`, a single
-- free-text `String` on the staff profile (schema.prisma:248). A teacher's own paper
-- qualification and a qualification AWARDED to a student were the same column, in the
-- same table, in the wrong direction: nothing about a student, nothing a body could be
-- checked against, and nothing an employer could ask to see. The school teaches to
-- externally awarded standards and stores the standards as prose in a staff profile.
--
-- This migration starts making that real. `Qualification` is the catalogue those six
-- become — a code, a name, a level and an awarding body, because "CSWIP 3.1" is a
-- standard number an employer looks up and "Welding Inspector" is the name a human
-- reads, and collapsing them into one column loses the half that gets verified.
-- `TeacherProfile.qualification` is deliberately NOT migrated or replaced: it is
-- staff data, a teacher's own record of their own training, and rewriting it is a data
-- migration with a judgement call in it that no reviewer of a schema diff can check.
-- It stays until somebody decides.
--
-- FOUR SHAPES ARGUED RATHER THAN REACHED FOR
--
--   1. `StudentQualification.reference` is `@unique`, and it is the only UNIQUE column
--      in the table. It is the thing an employer checks, so its entire value is that
--      there is exactly one of it: two rows answering to the same reference would mean
--      a verification page that cannot say which qualification it is talking about.
--      It is 26 Crockford base32 characters over 16 CSPRNG bytes (128 bits), generated
--      server-side. The floor of 16 characters is a CHECK below, because a reference an
--      operator can type by hand is a reference somebody can guess, and the whole
--      design of `GET /certificates/verify/:reference` rests on the space being
--      unsearchable.
--
--   2. `artifactUploadId` is `@unique` and `onDelete: RESTRICT`, the treatment
--      migration 0003 gave `Resource.uploadId` and migration 0010 gave
--      `Submission.uploadId`. A certificate IS its artefact — there is no row that
--      means anything without the PDF an employer downloads — so the bytes are
--      protected in the database exactly as assessment evidence is, and the reasoning
--      is the same one: deleting the file under a live claim destroys the only copy of
--      the thing being claimed. `SetNull` would have degraded quietly to "a certificate
--      with no certificate", which is a worse state than a refused DELETE.
--
--   3. NO `@@unique([studentId, qualificationId])`. Every other pair of "this person and
--      this thing" in this schema is unique — `Enrollment`, `AttendanceRecord`,
--      `ConversationParticipant` — and this one deliberately is not, because a
--      re-sit after a revocation is a REAL event and it must leave both rows standing.
--      `Submission`'s unique triple is the precedent for exactly this shape (migration
--      0010, point 3): hand in twice is two facts rather than one corrected one, and a
--      certificate that was revoked and then re-awarded is two certificates, the first
--      of which must keep saying so. Overwriting it would make a revocation
--      unrepresentable and leave the public verify route with nothing honest to say.
--
--   4. `qualificationId` is `onDelete: RESTRICT` while `studentId` is `CASCADE`, and the
--      asymmetry is the point rather than an inconsistency. A catalogue entry nobody has
--      been awarded may go; one somebody holds may not, because deleting it would
--      orphan a real qualification — and the catalogue is soft-deleted anyway, which is
--      the only path application code takes. The holder side cascades because Phase 6
--      made account deletion SOFT: `User.deletedAt` is what a deletion request writes,
--      and the row survives with it. The cascade exists so the test fixture's
--      `user.deleteMany` works, and it says so rather than pretending to be a policy.
--
-- THREE FIELDS THE PLAN'S LIST DOES NOT NAME, and why each is here anyway
--
--   `issuedById`   `SetNull`, matching `Enrollment.completedById` and
--                  `Submission.gradedById`. A certificate with no issuer is the failure
--                  mode the whole audit extension exists to prevent: schema.prisma:505
--                  states it outright for the completion it is the counterpart of ("an
--                  audit trail with an actor is what the whole extension exists to
--                  produce, and a teacher who later leaves must not take the
--                  qualification they signed for with them"). Same rule, same action.
--
--   `enrollmentId` `SetNull`, and this is the link that makes the chain an audit trail
--                  rather than a coincidence. Without it the certificate floats free of
--                  the register: nothing on the row says which seat, in which intake,
--                  of which course it came from, and a student who took the same course
--                  twice produces two certificates that are indistinguishable. The
--                  issue route refuses an enrolment that is not COMPLETED, so the row
--                  this points at always said COMPLETED at the moment it was written.
--                  `SetNull` and not `Cascade`: retiring an intake or deleting its
--                  course must not take a student's qualification with it, which is the
--                  same reasoning migration 0009 gave `Enrollment.completedAt` the right
--                  to outlive the course that produced it.
--
--   `revokedReason` Required by the API whenever `revokedAt` is written. A revocation
--                  that records when and by whom but not why is the shape an employer
--                  asks about most often and the one nobody can answer; the two existing
--                  columns are the audit half and this is the human half. It is NOT part
--                  of the public verify response, which reports `revoked: true` and
--                  nothing more — a revocation is a public fact, its grounds are not.
--
-- `Qualification` is soft-deleted (schema rule 3) and both reads filter `deletedAt`; a
-- retired standard stays on the certificate that names it, because "we no longer offer
-- Level 3" is a statement about the catalogue and not about the people who hold one.
--
-- `NotificationType` gains `CERTIFICATE_ISSUED` and `CERTIFICATE_REVOKED`, which close
-- the one thing Phase 2 recorded as deliberately unfinished: a graded hand-in sends no
-- notification because adding a member needs a migration nobody asked for. This is that
-- migration. `ADD VALUE` is metadata-only in Postgres — no table rewrite, no row
-- touched.
--
-- TWO MEMBERS AND NOT ONE, because the notifications page filters by type
-- (`listNotificationsQuerySchema.type`) and a withdrawal filed under "issued" would
-- show a student a revocation when they asked what had been awarded to them. The two
-- events are opposite sentences about the same object.
ALTER TYPE "NotificationType" ADD VALUE 'CERTIFICATE_ISSUED';
ALTER TYPE "NotificationType" ADD VALUE 'CERTIFICATE_REVOKED';

-- CreateTable
CREATE TABLE "Qualification" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "awardingBody" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Qualification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentQualification" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "qualificationId" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" TEXT,
    "enrollmentId" TEXT,
    "reference" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revokedReason" TEXT,
    "artifactUploadId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentQualification_pkey" PRIMARY KEY ("id"),
    -- The entropy floor, held by the database because nothing else can be trusted to
    -- hold it. `GET /certificates/verify/:reference` is the one unauthenticated route
    -- this plan adds and its entire security argument is that the space is
    -- unsearchable, so a reference an operator can shorten by hand must not be
    -- storable. The generator emits 26 characters; 16 is the floor below which a
    -- space of 2^80 stops being one.
    CONSTRAINT "student_qualification_reference_long" CHECK (length("reference") >= 16)
);

-- CreateIndex
CREATE UNIQUE INDEX "Qualification_code_key" ON "Qualification"("code");

-- CreateIndex
CREATE INDEX "Qualification_deletedAt_idx" ON "Qualification"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StudentQualification_reference_key" ON "StudentQualification"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "StudentQualification_artifactUploadId_key" ON "StudentQualification"("artifactUploadId");

-- The student's own list, newest first, which is every read of a holder's record.
CREATE INDEX "StudentQualification_studentId_issuedAt_idx" ON "StudentQualification"("studentId", "issuedAt");

-- The catalogue's holders, for "who has this standard" — which is the question a
-- verifying employer asks after the reference route answers.
CREATE INDEX "StudentQualification_qualificationId_idx" ON "StudentQualification"("qualificationId");

-- The chain back to the register, and the two attribution columns, per schema rule 4.
CREATE INDEX "StudentQualification_enrollmentId_idx" ON "StudentQualification"("enrollmentId");

CREATE INDEX "StudentQualification_issuedById_idx" ON "StudentQualification"("issuedById");

CREATE INDEX "StudentQualification_revokedById_idx" ON "StudentQualification"("revokedById");

-- Serves no query today. It is here because a revocation is the one column on this
-- table whose rows get rarer over time, which is exactly the shape that makes a
-- future "every certificate revoked in a window" report cheap to add and expensive not
-- to — and a commented-out index is the same omission as 0010's resource rule, found
-- after the first query that needed it.
CREATE INDEX "StudentQualification_revokedAt_idx" ON "StudentQualification"("revokedAt");

-- AddForeignKey
ALTER TABLE "StudentQualification" ADD CONSTRAINT "StudentQualification_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StudentQualification" ADD CONSTRAINT "StudentQualification_qualificationId_fkey" FOREIGN KEY ("qualificationId") REFERENCES "Qualification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StudentQualification" ADD CONSTRAINT "StudentQualification_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StudentQualification" ADD CONSTRAINT "StudentQualification_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StudentQualification" ADD CONSTRAINT "StudentQualification_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StudentQualification" ADD CONSTRAINT "StudentQualification_artifactUploadId_fkey" FOREIGN KEY ("artifactUploadId") REFERENCES "Upload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Migrations are APPLIED, never pushed: `prisma migrate deploy` replays this file, so
-- the SQL above is the only description of the change that has to stay true.
