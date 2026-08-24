/**
 * The DTO fragments more than one module serialises.
 *
 * `UserSummary`, `DepartmentSummary` and `CourseSummary` are nested pieces of several
 * top-level DTOs rather than any one module's entity — a course embeds a department
 * and a teacher, an enrollment embeds a whole course — so courses, departments and
 * enrollments each grew a private copy of the same three functions. Three copies of
 * the `seatsRemaining` arithmetic is three chances for one screen to disagree with
 * another about how many seats are left, and nothing would fail until it shipped.
 *
 * They live here instead: one home, one derivation. This module is deliberately
 * dependency-free apart from Prisma row types and the shared schemas — it holds no
 * queries, no policy and no `Actor`, so any module may import it without importing
 * another module's behaviour.
 *
 * The return types are the shared schemas' inferred OUTPUT types (user.ts:28,
 * department.ts:10, course.ts:42), never hand-written mirrors, so a renamed field in
 * `@skillwright/shared` is a compile error here rather than a response-validation 500
 * at runtime.
 */
import { avatarUrlFor, type Department, type Prisma, type User } from '@skillwright/db';
import type { CourseSummary, DepartmentSummary, UserSummary } from '@skillwright/shared';

/**
 * The relations `toCourseSummary` reads, as one include every caller spreads into its
 * own query. A caller that forgets it gets a type error at the call site rather than
 * an `undefined.name` at runtime.
 *
 * `as const` matters: Prisma derives the payload type from the literal shape, and
 * without it `CourseGetPayload` widens to `boolean` and the mapper stops being checked
 * against the columns it reads.
 */
export const COURSE_SUMMARY_INCLUDE = { department: true, teacher: true } as const;

/**
 * A course row loaded with everything `toCourseSummary` needs. A richer payload — the
 * detail include, or an enrollment's nested course — satisfies it too, because extra
 * relations are extra properties.
 */
export type CourseWithSummaryRelations = Prisma.CourseGetPayload<{
  include: typeof COURSE_SUMMARY_INCLUDE;
}>;

/**
 * Exactly the columns `toUserSummary` reads, as a `select` a caller can hand to Prisma.
 *
 * `include: { user: true }` selects every User scalar, which pulls `passwordHash`,
 * `totpSecret` and `totpLastUsedCounter` into the process for every row of every page —
 * a conversation list would load a page of Argon2id digests and TOTP ciphertext to
 * render three fields. The mapper keeps them off the wire today, but credential material
 * that is never loaded cannot be leaked by a future `return row` or a stray log line,
 * and it stays out of every heap dump the process produces. Eleven endpoints in the old
 * codebase returned password hashes for precisely this reason.
 */
export const USER_SUMMARY_SELECT = { id: true, name: true, role: true } as const;

/** What `toUserSummary` actually needs, so a narrowing `select` still typechecks. */
export type UserSummarySource = Pick<User, 'id' | 'name' | 'role'>;

/**
 * The smallest safe rendering of a person (user.ts:18-21): enough to draw a name and
 * an avatar in a list, and nothing that leaks contact details to other students.
 *
 * Takes the three columns it reads rather than the whole model, so a caller may pass a
 * `select`ed row. A full `User` satisfies it structurally, so existing callers are
 * unaffected.
 */
export function toUserSummary(user: UserSummarySource): UserSummary {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    /*
     * The derived fallback, deliberately. Preferring an uploaded avatar needs the
     * user's upload relation AND an await (presigning is async); every summary here is
     * embedded synchronously inside mappers whose loaders live in other modules, so
     * threading the relation through means touching every module that renders a face.
     * The users module does that work for the DETAIL shape it owns
     * (users.service.ts `withAvatarUrl`); summaries follow when their loaders do.
     */
    avatarUrl: avatarUrlFor(user.id),
  };
}

/** The three fields the summary carries. `courseCount` is a DETAIL field only. */
export function toDepartmentSummary(department: Department): DepartmentSummary {
  return {
    id: department.id,
    name: department.name,
    slug: department.slug,
  };
}

/**
 * The ONLY shape a course is serialised as in a list, and the ONLY place
 * `seatsRemaining`, `isFull` and `workshopSeatsRemaining` are derived
 * (course.ts:37-44). The SPA never recomputes
 * capacity arithmetic, so it can never drift from the server's answer — which is only
 * true while this function is the single definition of it.
 *
 * `Math.max(0, …)` because `approvedCount` is maintained by the raw counter updates in
 * enrollments.service.ts and a negative remainder must render as full, not as a
 * negative seat count.
 *
 * Dates are stringified even though the response schema would normalise a `Date` on
 * its own: the return type is the shared `CourseSummary`, whose `publishedAt` is a
 * string, so the conversion is what makes a binding mistake a compile error rather
 * than a runtime surprise.
 */
export function toCourseSummary(course: CourseWithSummaryRelations): CourseSummary {
  const seatsRemaining = Math.max(0, course.capacity - course.approvedCount);
  // Null stays null — "unbound" must not render as a seat count. The same
  // Math.max(0, …) guard as the admissions bound above, against the same raw
  // counter updates.
  const workshopSeatsRemaining =
    course.workshopCapacity === null
      ? null
      : Math.max(0, course.workshopCapacity - course.approvedCount);
  return {
    id: course.id,
    code: course.code,
    slug: course.slug,
    name: course.name,
    department: toDepartmentSummary(course.department),
    teacher: toUserSummary(course.teacher),
    duration: { value: course.durationValue, unit: course.durationUnit },
    capacity: course.capacity,
    approvedCount: course.approvedCount,
    workshopCapacity: course.workshopCapacity,
    seatsRemaining,
    isFull: seatsRemaining === 0,
    workshopSeatsRemaining,
    publishedAt: course.publishedAt?.toISOString() ?? null,
  };
}
