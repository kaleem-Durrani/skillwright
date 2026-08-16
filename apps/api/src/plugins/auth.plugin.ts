import type { FastifyPluginAsync, FastifyRequest, preHandlerHookHandler } from 'fastify';
import fp from 'fastify-plugin';
import { API_BASE_PATH, can, type Action, type Actor, type Subject } from '@skillwright/shared';
import {
  accountSuspended,
  emailNotVerified,
  forbidden,
  mfaRequired,
  unauthenticated,
} from '../lib/errors.js';
import { getRequestContext } from '../lib/logger.js';
import {
  destroyAllSessions,
  findLiveSession,
  readSessionCookie,
  slideSession,
  type SessionWithUser,
} from '../modules/auth/session.service.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Null for anonymous callers. Policy accepts null and answers for the public surface. */
    actor: Actor | null;
    /** The row behind `actor`, needed by logout and by anything that revokes credentials. */
    session: SessionWithUser | null;
  }
}

/**
 * Routes that must stay reachable while the account is not yet ACTIVE — otherwise a
 * user who cannot verify their email also cannot log out of the session that is
 * blocking them.
 */
const STATUS_EXEMPT_PREFIX = `${API_BASE_PATH}/auth/`;

export function toActor(session: SessionWithUser): Actor {
  return {
    id: session.user.id,
    role: session.user.role,
    status: session.user.status,
    provenance: session.provenance,
  };
}

/**
 * Resolves the opaque session cookie into `request.actor` for every request,
 * authenticated or not. Authorization is a separate decision made per route by
 * `authorize()`; conflating the two is how endpoints end up accidentally public.
 */
const authPlugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest('actor', null);
  app.decorateRequest('session', null);

  app.addHook('onRequest', async (request) => {
    const token = readSessionCookie(request);
    if (!token) return;

    const session = await findLiveSession(token);
    if (!session) return;

    const { user } = session;

    if (user.status === 'SUSPENDED') {
      // Suspension is retroactive: every live session dies the moment one is presented.
      await destroyAllSessions(user.id);
      throw accountSuspended();
    }

    if (user.status !== 'ACTIVE' && !request.url.startsWith(STATUS_EXEMPT_PREFIX)) {
      throw emailNotVerified();
    }

    request.session = session;
    request.actor = toActor(session);

    const ctx = getRequestContext();
    if (ctx) ctx.actorId = user.id;

    await slideSession(session);
  });
};

/** Throws instead of returning null, so handlers stop writing `if (!actor)` by hand. */
export function requireActor(request: FastifyRequest): Actor {
  if (!request.actor) throw unauthenticated();
  return request.actor;
}

export function requireSession(request: FastifyRequest): SessionWithUser {
  if (!request.session) throw unauthenticated();
  return request.session;
}

export type SubjectLoader = (
  request: FastifyRequest,
) => Subject | undefined | Promise<Subject | undefined>;

/**
 * The single bridge between HTTP and the pure policy module. The subject is loaded
 * HERE and handed to `can()` as plain data — the policy never touches the database,
 * which is what makes the permission matrix testable without one.
 */
export function authorize(action: Action, subjectLoader?: SubjectLoader): preHandlerHookHandler {
  return async function authorizeHook(request) {
    const subject = subjectLoader ? await subjectLoader(request) : undefined;
    const result = can(request.actor, action, subject);
    if (result.allowed) return;

    if (!request.actor) throw unauthenticated(`'${action}' requires authentication`);
    if (request.actor.provenance === 'MFA_PENDING') throw mfaRequired();
    if (request.actor.status === 'SUSPENDED') throw accountSuspended();
    if (request.actor.status === 'PENDING_VERIFICATION') throw emailNotVerified();

    throw forbidden(result.reason, result.rule);
  };
}

export default fp(authPlugin, { name: 'auth', dependencies: ['prisma'] });
