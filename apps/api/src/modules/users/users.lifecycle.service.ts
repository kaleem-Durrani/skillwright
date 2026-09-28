import { prisma } from '@skillwright/db';
import {
  ACCOUNT_DELETION_COOL_OFF_DAYS,
  notificationPayloadSchema,
  type AccountDeletionStatus,
  type UserExport,
} from '@skillwright/shared';
import { conflict, notFound, validationFailed } from '../../lib/errors.js';
import { baseLogger } from '../../lib/logger.js';
import { destroyAllSessions } from '../auth/session.service.js';

const log = baseLogger.child({ module: 'users.lifecycle' });

/**
 * The one projection from a `User` row's two deletion columns to the wire shape.
 *
 * Every function in this file that has to answer with an `AccountDeletionStatus`
 * calls it rather than writing the four fields itself, and the reason is that
 * `accountDeletionStatusSchema` promises ISO STRINGS (`nullableIsoDateTimeSchema`)
 * while Prisma hands back `Date` objects. Three call sites spelling
 * `deletionRequestedAt: row.deletionRequestedAt` is three opportunities to ship a
 * `Date` where the contract says a string, and the type error is the only thing
 * standing there — which is exactly the situation LESSONS-LEARNED 28 says to
 * resolve by making it structural.
 */
function deletionStatusOf(row: {
  deletionRequestedAt: Date | null;
  deletionEffectiveFor: Date | null;
}): {
  deletionRequestedAt: string | null;
  deletionEffectiveFor: string | null;
  cancellable: boolean;
} {
  const requestedAt = row.deletionRequestedAt?.toISOString() ?? null;
  const effectiveFor = row.deletionEffectiveFor?.toISOString() ?? null;
  return {
    deletionRequestedAt: requestedAt,
    deletionEffectiveFor: effectiveFor,
    // Derived, never stored: "can this still be undone" is a question about the
    // deadline relative to now, and a persisted answer would go stale the moment
    // the clock passed it — a `cancellable` column that said true at request time
    // and false at the deadline with nothing in between is how a person gets told
    // they can cancel and then cannot.
    cancellable:
      row.deletionRequestedAt !== null &&
      row.deletionEffectiveFor !== null &&
      row.deletionEffectiveFor > new Date(),
  };
}

/**
 * The cool-off, in milliseconds. The day count lives in `@skillwright/shared` so the
 * SPA renders the deadline from the same number the server schedules it with — two
 * copies of "30 days" in two packages is the drift lesson 34 is about.
 */
export const ACCOUNT_DELETION_COOL_OFF_MS = ACCOUNT_DELETION_COOL_OFF_DAYS * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Self-service deletion
// ---------------------------------------------------------------------------

/**
 * `POST /users/me/deletion` — schedule this account's own deletion.
 *
 * WHAT IT DOES NOT DO, which is the feature: it does not delete anything. It writes
 * `deletionRequestedAt` and `deletionEffectiveFor`, destroys every session, and
 * answers. `deletedAt` is set by `finaliseDueDeletions` when the window has passed,
 * or lazily by `findLiveSession` on the account's next authenticated request. The
 * gap between the two is the cool-off, and it exists because "delete my account" is
 * a button a person clicks on a bad afternoon, and an instant irreversible delete
 * served over HTTP by a product whose entire job is being the system of record for
 * somebody's qualification is the one endpoint this schema's rule 3 refuses to
 * model. Rule 3 is why `deletedAt` exists at all: anything a human can remove is
 * soft deleted precisely so the removal stays reversible while the record has a
 * reader.
 *
 * SESSIONS ARE DESTROYED IMMEDIATELY, and that is not a contradiction of the
 * cool-off — it is what makes the cool-off mean anything. The window is for the
 * person who asked to undo it; it is emphatically not a window in which anybody
 * else gets to use the account. The requester can still sign back in, because they
 * still hold their password, and that is precisely the undo.
 *
 * The two timestamps are written by ONE `prisma.user.update`, not two. Two would
 * mean a crash between them leaves a row with a request and no deadline — a
 * deletion that can never happen, invisible to every read, which is worse than
 * either state on its own.
 *
 * THE AUDIT ROW is the extension's, derived from the write. It reads as a `User`
 * UPDATE rather than a `DELETE`, because `deletedAt` has not moved yet — which is
 * accurate: at this moment nothing has been deleted. The `DELETE` row is written
 * when the soft delete actually lands, by the same extension, from the same call
 * site in effect. Two rows, two true facts, neither written by hand.
 */
export async function requestDeletion(
  userId: string,
  confirmEmail: string,
): Promise<AccountDeletionStatus> {
  const current = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: {
      id: true,
      email: true,
      deletionRequestedAt: true,
      deletionEffectiveFor: true,
      deletedAt: true,
    },
  });
  if (!current) throw notFound('User');

  /*
   * The confirm-by-typing, enforced on the SERVER and not only in the dialog.
   *
   * A client-side check is a rendering of this rule, and a rendering is something a
   * future client can omit — a second client, a curl, a script. So the rule lives
   * here, against the row's own address rather than anything the caller sent.
   *
   * Compared case-insensitively because `email` is `@db.Citext`: a person who typed
   * their address with different capitalisation HAS typed their address, and
   * refusing them for it would teach people that the confirmation is a trap rather
   * than a check — which is the fastest way to make somebody paste it in without
   * reading it.
   */
  if (confirmEmail.toLowerCase() !== current.email.toLowerCase()) {
    throw validationFailed([
      { path: 'confirmEmail', message: 'Type your full email address to confirm.' },
    ]);
  }

  /*
   * Idempotent, and deliberately NOT a second deadline. A person who clicks twice
   * because the first click seemed not to register must not be able to push their
   * own deletion out by clicking again — that would make the cool-off a function of
   * how anxious they are, which is exactly backwards. The original deadline stands.
   *
   * Re-reading it is also a re-read of whether it is already finalised, which is why
   * the same branch serves the "deletion already happened" case below.
   */
  if (current.deletionRequestedAt !== null && current.deletionEffectiveFor !== null) {
    return deletionStatusOf(current);
  }

  const now = new Date();
  const effectiveFor = new Date(now.getTime() + ACCOUNT_DELETION_COOL_OFF_MS);

  await prisma.user.update({
    where: { id: userId },
    data: { deletionRequestedAt: now, deletionEffectiveFor: effectiveFor },
  });

  /*
   * The same immediacy `suspend` has, and for the same reason: the auth plugin would
   * sweep these on the next presented cookie anyway, and doing it now is what makes
   * the answer "your account is scheduled for deletion" true everywhere at once
   * rather than true on your phone and stale on your laptop.
   */
  const revoked = await destroyAllSessions(userId);

  log.info({ userId, effectiveFor: effectiveFor.toISOString(), revoked }, 'deletion requested');

  return deletionStatusOf({ deletionRequestedAt: now, deletionEffectiveFor: effectiveFor });
}

/**
 * `DELETE /users/me/deletion` — the undo, inside the cool-off.
 *
 * Refused once the window has passed. Not a policy question and not a role question:
 * the deadline is a fact about the row, and the only honest answer after it is that
 * the thing being cancelled has already happened. Saying "cancelled" then would be a
 * lie the person discovers a month later when their history is still missing.
 */
export async function cancelDeletion(userId: string): Promise<AccountDeletionStatus> {
  const current = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, deletionRequestedAt: true, deletionEffectiveFor: true },
  });
  if (!current) throw notFound('User');

  if (current.deletionRequestedAt === null || current.deletionEffectiveFor === null) {
    // Nothing scheduled. A 409 rather than a silent success, because "cancel" on an
    // account with no pending deletion is a question the caller got wrong and an
    // empty 200 reads as "there was one and it is gone".
    throw conflict('There is no pending deletion for this account');
  }

  if (current.deletionEffectiveFor <= new Date()) {
    throw conflict('The cancellation window has passed and this account has been deleted');
  }

  // Both columns in one write, for the reason `requestDeletion` gives.
  await prisma.user.update({
    where: { id: userId },
    data: { deletionRequestedAt: null, deletionEffectiveFor: null },
  });

  return { deletionRequestedAt: null, deletionEffectiveFor: null, cancellable: false };
}

/** What `GET /users/me` tells the SPA about the caller's own pending deletion. */
export async function deletionStatus(userId: string): Promise<AccountDeletionStatus> {
  const row = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { deletionRequestedAt: true, deletionEffectiveFor: true },
  });
  if (!row) throw notFound('User');
  return deletionStatusOf(row);
}

/**
 * Turns a DUE deletion into an actual soft delete. Returns true when it wrote.
 *
 * CALLED FROM `findLiveSession`, which is the only place in the system every
 * authenticated request passes through, and that placement is the design rather than
 * a convenience. A background sweeper would be the tidier shape and it is
 * explicitly NOT what exists yet: `docs/roadmap/10-FEATURE-PLAN.md` Phase 7 owns
 * the sweepers, and three of them (Session, Verification, RecoveryCode) are still
 * unwritten. Building a fourth one here, for one model, would be that phase's work
 * done badly and in the wrong file. What exists instead is correct without a
 * scheduler: the account cannot be USED before this runs, because the only way in
 * is a session cookie, and the only way a session cookie becomes a session is
 * through the function below. So the deletion takes effect on the account's next
 * request and no request can outrun it.
 *
 * What it cannot do is delete an account whose owner never comes back. That is a
 * real gap, it is Phase 7's gap, and it is recorded as one rather than papered over
 * with a half-built sweeper: the row is dormant and unreadable either way, so the
 * consequence is disk, not access.
 *
 * The indexed predicate is `deletionEffectiveFor <= now` with `deletedAt IS NULL`
 * (migration 0011_user_lifecycle's index), and it runs once per authenticated
 * request — cheap because almost every row is null there, and it early-returns on
 * the first thing it finds rather than collecting a list.
 */
export async function finaliseDueDeletions(userId: string): Promise<boolean> {
  const due = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null, deletionEffectiveFor: { lte: new Date() } },
    select: { id: true },
  });
  if (!due) return false;

  // Soft delete, NOT a hard one — the schema's rule 3, and in this case rule 2 as
  // well: `Course.teacherId`, `Resource.authorId` and `Announcement.authorId` are
  // `Restrict`, so a physical delete of any teacher who ever taught would be
  // refused by the database. Enrolments, attendance, grades and the audit trail all
  // survive the person, and that is the decision rather than an oversight: a school
  // that issued a qualification in somebody's name and then deleted the record of
  // them is worse off than one holding a dormant row.
  //
  // The `DELETE` audit row is derived by the extension from exactly this transition
  // (`deriveUpdateAction`: deletedAt null → set), and it is written by the caller —
  // which is this module, on the request the account's own session triggered. The
  // actor is therefore the person themselves, which is the truth: nobody else did
  // this to them.
  await prisma.user.update({ where: { id: due.id }, data: { deletedAt: new Date() } });
  await destroyAllSessions(due.id);

  log.info({ userId: due.id }, 'deletion finalised after the cool-off');
  return true;
}

// ---------------------------------------------------------------------------
// Data export
// ---------------------------------------------------------------------------

/**
 * `Notification.payload` is an unconstrained `Json` column, so it cannot be handed
 * to the envelope as-is.
 *
 * Returns the parsed two-key payload, or `null` to mean DROP THE ROW. Dropping
 * rather than emitting a fallback is deliberate and is the `notificationPayloadSchema`
 * comment's argument applied one step further: a passthrough would serve whatever a
 * future producer denormalised into the column — a colleague's address, a reset
 * link — through a privacy endpoint, and a blank-string fallback is the exact
 * graceful degradation LESSONS-LEARNED 17 describes, where a whole notification list
 * rendered blank and nothing anywhere reported it. A missing row is visible; a blank
 * one is not.
 */
function parseNotificationPayload(payload: unknown): { title: string; body: string } | null {
  const parsed = notificationPayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

/**
 * `GET /users/me/export` — a data-subject access request, answered by the API.
 *
 * A privacy request today is a hand-written database query, and a hand-written query
 * is a query somebody re-derives under time pressure with a `SELECT *`. Every
 * relation below is reached through an EXPLICIT `select` naming the columns that go
 * into the envelope, and the rule this whole function exists to enforce is that no
 * include may reach a SECOND PERSON. Concretely, and each of these was a live
 * possibility rather than a hypothetical:
 *
 *   - `enrollments` → `offering` → `course` is safe (a course is shared academic
 *     content, not personal data) but `course.teacherId` is not, and the
 *     `decidedById`/`completedById` on the enrolment itself are not either. Those
 *     three are why the select stops at `courseCode`/`courseName`.
 *   - `conversations` → `messages` would hand out the OTHER side of every thread.
 *     The messages are filtered to `senderId = viewerId` and projected to three
 *     fields with no `sender` at all — on a direct thread every message the viewer
 *     did not write carries somebody else's name.
 *   - `comments` → `author` is the viewer by construction, but `author` is a
 *     `userSummarySchema` and selecting it would be selecting a user-shaped object
 *     on a relation that happens to point at yourself. Not selected.
 *   - `notifications.payload` is an unconstrained `Json` column written by other
 *     modules' side effects, so it goes through `notificationPayloadSchema` — the
 *     same two-key parse the notifications list uses, for the same stated reason.
 *   - `auditEvents` are NOT exported at all, and that is the omission most worth
 *     naming. An audit row's before/after snapshot is a full copy of whatever was
 *     written, so an admin's export would carry every other user's account they ever
 *     edited. A privacy request about yourself is not a request for a log of what
 *     you did to other people, and a GDPR request that leaks a colleague's data is
 *     worse than one that arrives a day later.
 *
 * NEVER EXPORTED AT ALL, credential-shaped: `passwordHash`, `totpSecret`,
 * `totpLastUsedCounter`, every `codeHash` (Verification, RecoveryCode) and every
 * Session `tokenHash`. A session row is exported — it is the person's own record of
 * where they signed in, which is exactly what a data-subject request is for — with
 * everything that would let it be replayed omitted. `userId` is omitted from the
 * projections too, because the envelope's subject is the person reading it and
 * repeating their own id on every nested row is noise that invites a future editor
 * to relax the filter that keeps it out of somebody else's.
 */
export async function exportMine(viewerId: string): Promise<UserExport> {
  /*
   * READ FIRST, in parallel, and each with its own explicit select. One
   * `prisma.user.findUnique({ include: … })` would be shorter and would be a leak
   * waiting for the next relation somebody adds to the model — the shape of the
   * response would then be decided by the schema rather than reviewed by whoever
   * writes the endpoint, which is precisely the review this endpoint cannot skip.
   */
  const [user, sessions, enrollments, notifications, uploads, comments, conversations] =
    await Promise.all([
      prisma.user.findFirst({
        where: { id: viewerId },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          status: true,
          phoneNumber: true,
          bio: true,
          totpEnabledAt: true,
          lastLoginAt: true,
          createdAt: true,
          updatedAt: true,
          deletedAt: true,
          deletionRequestedAt: true,
          deletionEffectiveFor: true,
          studentProfile: {
            select: {
              departmentId: true,
              // The two columns the shared `studentProfileSchema` requires. Selected
              // rather than derived: writing `enrollmentNo: ''` and passing
              // `createdAt` off as `enrolledOn` would have made the export's profile
              // section parse and be wrong, which is the failure mode an explicit
              // `select` exists to prevent.
              enrollmentNo: true,
              enrolledOn: true,
              department: { select: { name: true } },
            },
          },
          teacherProfile: {
            select: {
              departmentId: true,
              department: { select: { name: true } },
              qualification: true,
              specialization: true,
              staffNo: true,
            },
          },
        },
      }),
      /*
       * Sessions, WITHOUT `tokenHash`. The row is the person's own record of where
       * they have signed in; the hash is a live credential derived from a cookie
       * they hold, and a data export is the one document guaranteed to be forwarded
       * to somebody who is not them.
       */
      prisma.session.findMany({
        where: { userId: viewerId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          provenance: true,
          ip: true,
          userAgent: true,
          createdAt: true,
          lastUsedAt: true,
          expiresAt: true,
          absoluteExpiresAt: true,
        },
      }),
      prisma.enrollment.findMany({
        where: { studentId: viewerId },
        orderBy: { requestedAt: 'desc' },
        select: {
          id: true,
          status: true,
          requestedAt: true,
          decidedAt: true,
          decisionNote: true,
          completedAt: true,
          // `offeringId` and the offering's two dates, and then the course's CODE
          // and NAME — never `decidedById`, `completedById` or `course.teacherId`.
          // See the function comment; those are the three columns that would have
          // turned a privacy request into a directory of colleagues.
          offeringId: true,
          offering: {
            select: {
              startDate: true,
              endDate: true,
              course: { select: { code: true, name: true } },
            },
          },
        },
      }),
      prisma.notification.findMany({
        where: { userId: viewerId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          type: true,
          payload: true,
          linkPath: true,
          readAt: true,
          createdAt: true,
        },
      }),
      prisma.upload.findMany({
        where: { ownerId: viewerId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          originalName: true,
          contentType: true,
          sizeBytes: true,
          status: true,
          createdAt: true,
        },
      }),
      prisma.comment.findMany({
        where: { authorId: viewerId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          content: true,
          resourceId: true,
          announcementId: true,
          createdAt: true,
        },
      }),
      /*
       * Conversations the viewer is IN, via the participant row rather than by
       * scanning every thread — and only their own messages inside each. The
       * `where: { senderId: viewerId }` on the nested select is the load-bearing
       * clause of this whole function: it is a filter, not a projection, so no
       * amount of adding columns to the message select below can widen it.
       */
      prisma.conversationParticipant.findMany({
        where: { userId: viewerId, leftAt: null },
        select: {
          conversation: {
            select: {
              id: true,
              title: true,
              createdAt: true,
              lastMessageAt: true,
              messages: {
                where: { senderId: viewerId, deletedAt: null },
                orderBy: { createdAt: 'asc' },
                select: { id: true, content: true, createdAt: true },
              },
            },
          },
        },
      }),
    ]);

  if (!user) throw notFound('User');

  return {
    generatedAt: new Date().toISOString(),
    account: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      phoneNumber: user.phoneNumber,
      bio: user.bio,
      mfaEnabled: user.totpEnabledAt !== null,
      /*
       * EVERY date is stringified here, and the repetition is the point: Prisma hands
       * back `Date` objects and the wire contract is ISO strings, so each one needs
       * `?.toISOString() ?? null`. Writing it as a spread of the Prisma row, or
       * leaning on the serializer, would have left four `Date` objects where the
       * envelope promises strings — and the type error that produces is the only
       * thing that catches it, which is why this is spelled out rather than mapped.
       */
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      deletedAt: user.deletedAt?.toISOString() ?? null,
      deletionRequestedAt: user.deletionRequestedAt?.toISOString() ?? null,
      deletionEffectiveFor: user.deletionEffectiveFor?.toISOString() ?? null,
    },
    /*
     * Both satellites are projected into the SHARED `studentProfileSchema` /
     * `teacherProfileSchema` shapes, so the export's profile section is the same
     * contract `GET /users/me` serves and the SPA can render it with the components
     * it already has. Built here rather than by spreading the Prisma row because
     * the Prisma row calls the column `department.name` and the DTO calls it
     * `departmentName` — the flat alias the rest of the SPA reads.
     */
    studentProfile:
      user.studentProfile === null
        ? null
        : {
            departmentId: user.studentProfile.departmentId,
            departmentName: user.studentProfile.department.name,
            enrollmentNo: user.studentProfile.enrollmentNo,
            enrolledOn: user.studentProfile.enrolledOn.toISOString(),
          },
    teacherProfile:
      user.teacherProfile === null
        ? null
        : {
            departmentId: user.teacherProfile.departmentId,
            departmentName: user.teacherProfile.department.name,
            qualification: user.teacherProfile.qualification,
            specialization: user.teacherProfile.specialization,
            staffNo: user.teacherProfile.staffNo,
          },
    sessions: sessions.map((row) => ({
      id: row.id,
      provenance: row.provenance,
      ip: row.ip,
      userAgent: row.userAgent,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      absoluteExpiresAt: row.absoluteExpiresAt.toISOString(),
    })),
    enrollments: enrollments.map((row) => ({
      id: row.id,
      status: row.status,
      requestedAt: row.requestedAt.toISOString(),
      decidedAt: row.decidedAt?.toISOString() ?? null,
      decisionNote: row.decisionNote,
      completedAt: row.completedAt?.toISOString() ?? null,
      courseCode: row.offering.course.code,
      courseName: row.offering.course.name,
      offeringId: row.offeringId,
      offeringStartDate: row.offering.startDate?.toISOString() ?? null,
      offeringEndDate: row.offering.endDate?.toISOString() ?? null,
    })),
    /*
     * `.flatMap` rather than `.map` because a row whose payload does not parse is
     * DROPPED — see `parseNotificationPayload`. `flatMap` returning `[]` is the
     * whole mechanism, and it is why the map below cannot be written as a plain
     * `.map`: that would put a `null` where the schema demands a payload object and
     * the response would fail to serialise, turning one malformed row into a 500
     * for the entire export.
     */
    notifications: notifications.flatMap((row) => {
      const payload = parseNotificationPayload(row.payload);
      if (payload === null) return [];
      return [
        {
          id: row.id,
          type: row.type,
          payload,
          linkPath: row.linkPath,
          readAt: row.readAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
        },
      ];
    }),
    uploads: uploads.map((row) => ({
      id: row.id,
      originalName: row.originalName,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    })),
    comments: comments.map((row) => ({
      id: row.id,
      content: row.content,
      resourceId: row.resourceId,
      announcementId: row.announcementId,
      createdAt: row.createdAt.toISOString(),
    })),
    conversations: conversations.map((row) => ({
      id: row.conversation.id,
      title: row.conversation.title,
      createdAt: row.conversation.createdAt.toISOString(),
      lastMessageAt: row.conversation.lastMessageAt.toISOString(),
      messages: row.conversation.messages.map((message) => ({
        id: message.id,
        content: message.content,
        createdAt: message.createdAt.toISOString(),
      })),
    })),
  };
}
