import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma, type Session, type SessionProvenance, type User } from '@skillwright/db';
import { env } from '../../env.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { getRequestContext } from '../../lib/logger.js';

/** Sliding window: how long an idle session stays usable. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Hard ceiling. Never extended, so a stolen cookie always dies. */
export const SESSION_ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** A password-accepted-but-TOTP-outstanding session is worthless after a few minutes. */
export const MFA_PENDING_TTL_MS = 5 * 60 * 1000;
/** Only re-write expiresAt once the session is this close to lapsing (one write/day, not one/request). */
const SLIDE_THRESHOLD_MS = SESSION_TTL_MS / 2;

/**
 * `__Host-` requires Secure. Local plain-HTTP development is the one case where that
 * is impossible, and it is only reachable by renaming the cookie deliberately.
 */
const cookieIsSecure = env.SESSION_COOKIE_NAME.startsWith('__Host-') || env.DEPLOY_ENV !== 'local';

export interface IssuedSession {
  session: Session;
  /** Raw cookie value. Exists only in this function's return — the row stores its SHA-256. */
  token: string;
}

/** Creates a session row and returns the raw token exactly once. */
export async function createSession(
  userId: string,
  provenance: SessionProvenance,
  request: FastifyRequest,
): Promise<IssuedSession> {
  const token = randomToken();
  const now = Date.now();
  const ttl = provenance === 'MFA_PENDING' ? MFA_PENDING_TTL_MS : SESSION_TTL_MS;

  const session = await prisma.session.create({
    data: {
      tokenHash: sha256(token),
      userId,
      provenance,
      expiresAt: new Date(now + ttl),
      absoluteExpiresAt: new Date(now + Math.max(ttl, SESSION_ABSOLUTE_TTL_MS)),
      ip: request.ip ?? null,
      userAgent: request.headers['user-agent']?.slice(0, 512) ?? null,
    },
  });

  return { session, token };
}

export type SessionWithUser = Session & { user: User };

/** Returns the session only if the cookie matches a row that is live on both clocks. */
export async function findLiveSession(token: string): Promise<SessionWithUser | null> {
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  });
  if (!session) return null;

  /*
   * The lazy finaliser for a due account deletion (Phase 6), and this is the only
   * call site on purpose. `findLiveSession` is where every authenticated request in
   * the system enters, so a deletion whose cool-off has passed takes effect on the
   * account's own next request and no request can reach the account before it does.
   * The alternative — a background sweeper — is Phase 7's work and is deliberately
   * not built here; see `finaliseDueDeletions`'s own comment for the gap that
   * leaves (an account whose owner never returns is never finalised, and the
   * consequence is disk rather than access).
   *
   * GATED ON `deletionEffectiveFor` BEING NON-NULL, which is free: the user row is
   * ALREADY loaded above, so the check reads a column that crossed the wire anyway.
   * The ungated version cost an extra indexed SELECT on EVERY authenticated request
   * in the system to discover that almost every account has no pending deletion —
   * a real per-request tax, paid by every user, to serve a feature one of them
   * asked for. The gate is not an optimisation that can drift out of sync with the
   * sweeper's predicate: both key on the same column, and a null there means there
   * is nothing to finalise by definition.
   *
   * LAZY IMPORT, not a top-level one: `users.lifecycle.service` imports
   * `destroyAllSessions` from THIS file, so a static import back would be a cycle
   * through the auth module — the module every request depends on. A cycle in ESM
   * usually resolves, which is exactly what makes it a bad thing to ship into a
   * module this central.
   */
  if (session.user.deletionEffectiveFor !== null) {
    /*
     * ATTRIBUTE THE WRITE BEFORE MAKING IT, not after. `auth.plugin` sets the
     * ambient `ctx.actorId` a few lines further down — but this finalisation runs
     * FIRST, so without setting it here the `DELETE` audit row the extension writes
     * would carry a null actor, and the one row in this whole feature that says the
     * account ended would be the one row that cannot say who ended it.
     *
     * The actor is the person themselves, which is the truth: nobody else did this
     * to them, and they proved it by holding a password for thirty days. A
     * system-initiated deletion (which is what a future sweeper would be) happens
     * outside any request scope, where `getRequestContext()` is undefined and the
     * row correctly carries a null actor.
     */
    const ctx = getRequestContext();
    if (ctx) ctx.actorId = session.userId;

    const { finaliseDueDeletions } = await import('../users/users.lifecycle.service.js');
    if (await finaliseDueDeletions(session.userId)) {
      // Soft-deleted now. Returning null refuses the CURRENT request too, rather
      // than letting this one — the one that happened to trigger the finalisation —
      // be the single request that reaches the account after its deletion landed.
      await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
      return null;
    }
  }

  const now = new Date();
  if (session.expiresAt <= now || session.absoluteExpiresAt <= now || session.user.deletedAt) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  return session;
}

/** Extends the sliding window, capped by the absolute ceiling. No-op when far from expiry. */
export async function slideSession(session: Session): Promise<void> {
  // An MFA_PENDING session must expire on its own short clock; sliding it would hand
  // a password-only attacker a week-long half-authenticated session.
  if (session.provenance === 'MFA_PENDING') return;

  const now = Date.now();
  if (session.expiresAt.getTime() - now > SLIDE_THRESHOLD_MS) return;

  const next = Math.min(now + SESSION_TTL_MS, session.absoluteExpiresAt.getTime());
  await prisma.session.update({
    where: { id: session.id },
    data: { expiresAt: new Date(next), lastUsedAt: new Date(now) },
  });
}

/**
 * Promotes an MFA_PENDING session to a full one AND rotates its token, because
 * keeping the pre-authentication identifier alive after a privilege change is the
 * textbook session-fixation hole.
 */
export async function upgradeSessionToPassword(
  sessionId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const now = Date.now();
  const expiresAt = new Date(now + SESSION_TTL_MS);
  await prisma.session.update({
    where: { id: sessionId },
    data: {
      tokenHash: sha256(token),
      provenance: 'PASSWORD',
      expiresAt,
      absoluteExpiresAt: new Date(now + SESSION_ABSOLUTE_TTL_MS),
      lastUsedAt: new Date(now),
    },
  });
  return { token, expiresAt };
}

export async function destroySession(sessionId: string): Promise<void> {
  await prisma.session.delete({ where: { id: sessionId } }).catch(() => undefined);
}

/** Used by logout-all, password reset, MFA disable and admin suspension. */
export async function destroyAllSessions(userId: string): Promise<number> {
  const { count } = await prisma.session.deleteMany({ where: { userId } });
  return count;
}

export function readSessionCookie(request: FastifyRequest): string | null {
  const raw = request.cookies[env.SESSION_COOKIE_NAME];
  return raw && raw.length > 0 ? raw : null;
}

export function setSessionCookie(reply: FastifyReply, token: string, maxAgeMs: number): void {
  reply.setCookie(env.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: cookieIsSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(maxAgeMs / 1000),
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(env.SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: cookieIsSecure,
    sameSite: 'lax',
    path: '/',
  });
}
