/**
 * The wire shapes this app reads — every one of them inferred from the zod schema
 * the API validates its own responses against.
 *
 * NOTHING IS DECLARED IN THIS FILE except `DashboardStats`, and that exception is
 * argued at the bottom. Everything else is a re-export from
 * `packages/shared/src/schema/*.ts`, so a renamed or re-nested field is a compile
 * error in the SPA in the same commit that changes it on the server.
 *
 * WHY the file was rewritten. It used to hand-declare `UserSummary`,
 * `CourseSummary`, `EnrollmentSummary`, `ConversationSummary`, `MessageRecord` and
 * the rest as flat interfaces. They were guesses, written before the API modules
 * existed, and they were wrong in the way a hand-written type is always wrong: the
 * compiler agreed with them. `message.senderId`, `message.senderName`,
 * `conversation.lastMessagePreview`, `conversation.participants[0].name`,
 * `course.departmentName`, `enrollment.studentName` and a ten-field `UserSummary`
 * all type-checked perfectly while no endpoint had ever served any of them, so the
 * failure surfaced as a blank screen at runtime instead of a red squiggle.
 * CONTRIBUTING.md:51 names this exactly: "A type hand-written on the client that
 * the schema already describes" is an automatic send-back.
 *
 * The import specifier is `@skillwright/shared/schema`, the subpath declared in
 * `packages/shared/package.json`. These are `export type` re-exports, so the whole
 * file erases at build time and pulls no zod into the bundle. Import the schema
 * VALUES (e.g. `sendMessageSchema`) straight from the same specifier at the point
 * of use; re-exporting them through here would turn a type barrel into a runtime
 * module.
 *
 * TWO PROPERTIES OF EVERY SHAPE BELOW, restated because they are what people guess
 * wrong when they read a field name and assume a JS type:
 *
 *   - Dates are ISO-8601 STRINGS, never `Date`. `isoDateTimeSchema` normalises the
 *     server's Prisma `Date` to a string on the way out (common.ts:42-48).
 *   - `seq` and `lastReadSeq` are Postgres `bigint` columns and arrive as STRINGS
 *     (`bigIntStringSchema`, common.ts:51-53). Compare them with `BigInt()`, never
 *     as `Number` — a conversation past 2^53 messages would silently tie.
 */

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/**
 * `UserSummary` is FOUR fields — `{ id, name, role, avatarUrl }` (user.ts:22-27).
 * It is the safe public rendering of a person: enough to draw an avatar beside a
 * message or a comment, and deliberately no email, status, department or login
 * timestamp, because it is embedded in payloads other students can read.
 *
 * The old local `UserSummary` had ten fields and was used as the admin table row.
 * That is `UserDetail` (user.ts:52-66) — the full record `GET /users` and
 * `GET /users/:id` actually serve, and the only DTO that carries `email`,
 * `status`, `lastLoginAt` and the profiles. Department is NOT a top-level field on
 * it: it hangs off `teacherProfile` or `studentProfile`, either of which is null.
 */
export type {
  RoleValue,
  StudentProfileDto,
  TeacherProfileDto,
  UserDetail,
  UserStatusValue,
  UserSummary,
} from '@skillwright/shared/schema';

// ---------------------------------------------------------------------------
// Departments and courses
// ---------------------------------------------------------------------------

/**
 * `DepartmentSummary` is `{ id, name, slug }`. The counts a directory page wants —
 * `courseCount`, `teacherCount`, `studentCount` — are on `DepartmentDetail`, which
 * only `GET /departments/:id` serves.
 *
 * `CourseSummary` NESTS what the old local type flattened. There is no
 * `departmentName`, `teacherName`, `durationValue` or `durationUnit`: it carries
 * `department: DepartmentSummary`, `teacher: UserSummary` and
 * `duration: { value, unit }`. It also ships `seatsRemaining` and `isFull`
 * pre-computed, so no screen redoes capacity arithmetic and drifts from the
 * server's answer.
 *
 * `description`, `startDate`, `endDate` and `viewerEnrollmentStatus` are on
 * `CourseDetail`, not on the summary — `GET /courses` returns summaries and
 * `GET /courses/:id` returns the detail (courses.routes.ts:49, :68).
 */
export type {
  CourseDetail,
  CourseListItem,
  CourseSummary,
  DepartmentDetail,
  DepartmentSummary,
  Duration,
  DurationUnitValue,
} from '@skillwright/shared/schema';

// ---------------------------------------------------------------------------
// Enrollments
// ---------------------------------------------------------------------------

/**
 * `EnrollmentDto` is the shape every enrollment endpoint returns
 * (enrollments.routes.ts:46, :71, :85, :101, :118 and courses.routes.ts:131).
 *
 * It nests: `student: UserSummary`, `course: CourseSummary`,
 * `decidedBy: UserSummary | null`. There is no `studentName`, `studentEmail`,
 * `courseId` or `courseName` — and no `studentEmail` anywhere, because
 * `UserSummary` does not carry an email at all (see above). A screen that wants
 * the student's email is asking for `UserDetail`, which this payload does not
 * include and `enrollment:read` does not entitle it to.
 */
export type { EnrollmentDto, EnrollmentStatusValue } from '@skillwright/shared/schema';

// ---------------------------------------------------------------------------
// Resources, announcements
// ---------------------------------------------------------------------------

/**
 * `ResourceDto` nests `author: UserSummary` rather than carrying `authorId` /
 * `authorName`, and adds `courseName`, `uploadId`, `contentType` and
 * `commentCount`.
 *
 * `AnnouncementSummary` carries an `excerpt` built server-side, not the full
 * `content` — the body is on `AnnouncementDetail`, so list pages never ship
 * 50KB posts.
 */
export type {
  AnnouncementDetail,
  AnnouncementSummary,
  AnnouncementTypeValue,
  ResourceDto,
  ResourceTypeValue,
} from '@skillwright/shared/schema';

// ---------------------------------------------------------------------------
// Conversations and messages
// ---------------------------------------------------------------------------

/**
 * `ConversationDto.participants` is `ParticipantDto[]`, and a participant is the
 * MEMBERSHIP row, not the person: `{ user, lastReadSeq, lastReadAt, joinedAt,
 * leftAt }`. The person is one level down, at `participants[i].user`.
 *
 * There is no `lastMessagePreview`. The conversation ships the whole last message
 * as `lastMessage: MessageDto | null`, so a list row renders
 * `lastMessage?.content` and gets the sender and timestamp for free.
 *
 * `MessageDto` nests `sender: UserSummary`. There is no `senderId` and no
 * `senderName`; "is this mine" is `message.sender.id === user.id`.
 *
 * `SendMessageInput` is the POST body, and its `clientMsgId` is CONSTRAINED:
 * `/^[0-9A-HJKMNP-TV-Z]{26}$/`, a 26-character uppercase Crockford ULID
 * (message.ts:31-37). It is the idempotency key that makes a retry after a
 * timeout return the original message instead of double-posting, and it is
 * UNIQUE per sender in the database. Mint it with `ulid()` from the `ulid`
 * package — anything home-rolled out of `Date.now()` and `Math.random()` is a
 * 422 on every single send.
 */
export type {
  ConversationDto,
  MessageDto,
  ParticipantDto,
  SendMessageInput,
} from '@skillwright/shared/schema';

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/**
 * The payload is denormalised on write, so rendering a notification never joins to
 * a row that may since have been deleted. `payload.title` and `payload.body` are
 * guaranteed; everything else on it is type-specific and typed `unknown`.
 */
export type {
  NotificationDto,
  NotificationPayload,
  NotificationTypeValue,
} from '@skillwright/shared/schema';

// ---------------------------------------------------------------------------
// SPA-local — the one shape with no shared schema behind it
// ---------------------------------------------------------------------------

/**
 * The four dashboard counters. THE ONE HAND-WRITTEN SHAPE IN THIS FILE, and it is
 * here under protest.
 *
 * `@skillwright/shared/schema` has no dashboard or stats module — its index
 * exports errors, common, pagination, user, department, course, enrollment,
 * upload, resource, announcement, comment, message, conversation, notification and
 * auth, and nothing else. The API is in the same position and says so at length:
 * `apps/api/src/modules/dashboard/dashboard.schema.ts:1-22` declares
 * `dashboardStatsSchema` locally for exactly this reason, and records the
 * obligation this comment repeats from the other side.
 *
 * The SPA cannot import that declaration either — `apps/api` is a private
 * application, not a package this app depends on, and reaching into it would make
 * the browser bundle depend on the server's source tree.
 *
 * So the four numbers are declared twice, once per side, which is the drift risk
 * the rest of this file exists to eliminate. THE FIX IS ONE COMMIT: add
 * `dashboardStatsSchema` to `packages/shared/src/schema/`, export it from that
 * index, then delete BOTH this interface and the API's copy and re-export the
 * shared type in their place. Until someone does that, the key names are fixed by
 * the contract and are not renamed on either side.
 */
export interface DashboardStats {
  courses: number;
  pendingEnrollments: number;
  unreadMessages: number;
  resources: number;
}
