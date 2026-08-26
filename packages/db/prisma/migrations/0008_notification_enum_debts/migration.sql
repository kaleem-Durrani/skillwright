-- The three notification debts Phase 1 recorded, paid.
--
-- NotificationType has named events since the notifications module shipped, but three
-- of the actions it describes had no member to announce them, so the writers stayed
-- silent and said so in their own comments:
--
--   * a student WITHDRAWING an approved seat — enrollments.service.ts's settle()
--     documented the gap as "a withdrawal announces nothing because no enum member
--     names that event yet" (docs/roadmap/00-FEATURE-PLAN.md:111 recorded the debt);
--   * a course going LIVE — Phase 2 made `POST /courses/:id/publish` reachable and
--     its approved students have heard nothing since;
--   * a TOP-LEVEL comment — COMMENT_REPLIED covers replies only, so the author of a
--     resource or announcement was never told someone started a thread on it.
--
-- Each is one enum value plus one notify() call at the writer; this migration is the
-- part that needs the database. Values are ADDED only: no row is rewritten, no column
-- changes, and every previously-written notification keeps its type. Adding to an enum
-- is metadata-only in Postgres (no table rewrite), so this runs instantly on a
-- populated database.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'ENROLLMENT_WITHDRAWN';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'COURSE_PUBLISHED';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'COMMENT_POSTED';
