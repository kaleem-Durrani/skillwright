import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { env } from '../env.js';
import { forbidden } from '../lib/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * ADR: no CSRF token, by design.
 *
 * The session cookie is SameSite=Lax, so a cross-site POST never carries it in any
 * browser we support. This hook is the belt to that suspenders: it refuses any
 * state-changing request that is not provably same-origin. Because production serves
 * the SPA and the API from ONE origin, a token scheme would add a synchroniser, a
 * rotation story, and a class of "session expired" bugs to defend against an attack
 * two independent mechanisms already stop. Tokens earn their place when third-party
 * origins must legitimately POST here — that is explicitly not this system.
 */
const csrfPlugin: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (request) => {
    if (SAFE_METHODS.has(request.method)) return;

    const fetchSite = request.headers['sec-fetch-site'];
    if (fetchSite === 'same-origin' || fetchSite === 'none') return;

    const origin = request.headers.origin?.replace(/\/$/, '');
    if (!origin || !env.ALLOWED_ORIGINS.includes(origin)) {
      throw forbidden('Cross-origin state change refused', 'csrf.sameOrigin');
    }
  });
};

export default fp(csrfPlugin, { name: 'csrf' });
