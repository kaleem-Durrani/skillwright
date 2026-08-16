import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';
import { env } from '../env.js';
import { sha256 } from '../lib/crypto.js';
import { rateLimited } from '../lib/errors.js';

/**
 * Two independent buckets protect the auth routes:
 *
 *  - per IP, which stops one host brute-forcing many accounts;
 *  - per account, which stops a botnet brute-forcing one account from many hosts.
 *
 * Either alone is trivially bypassed by rotating the other dimension.
 */
const ratelimitPlugin: FastifyPluginAsync = async (app) => {
  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_GLOBAL_MAX,
    timeWindow: env.RATE_LIMIT_GLOBAL_WINDOW_MS,
    redis: app.redis,
    nameSpace: 'rl:global:',
    // A Redis outage must degrade to "unlimited", not "everything is a 429".
    skipOnError: true,
    keyGenerator: (request: FastifyRequest) => request.ip,
    addHeadersOnExceeding: { 'x-ratelimit-limit': true, 'x-ratelimit-remaining': true },
  });
};

/** Route-level override: the strict per-IP bucket for credential-handling endpoints. */
export const authIpRateLimit = {
  rateLimit: {
    max: env.RATE_LIMIT_AUTH_IP_MAX,
    timeWindow: env.RATE_LIMIT_AUTH_IP_WINDOW_MS,
  },
} as const;

/**
 * The per-account bucket runs at preHandler, not onRequest, because the account it
 * keys on lives in the parsed body. Implemented directly on Redis rather than via a
 * second rate-limit registration, which Fastify allows only one of per route.
 */
export function perAccountRateLimit(
  bucket: string,
  extractIdentity: (request: FastifyRequest) => string | undefined,
  max: number = env.RATE_LIMIT_AUTH_ACCOUNT_MAX,
  windowMs: number = env.RATE_LIMIT_AUTH_ACCOUNT_WINDOW_MS,
): preHandlerHookHandler {
  const windowSeconds = Math.ceil(windowMs / 1000);

  return async function perAccountRateLimitHook(this: FastifyInstance, request) {
    const identity = extractIdentity(request);
    if (!identity) return;

    const key = `rl:acct:${bucket}:${sha256(identity.toLowerCase())}`;

    let count: number;
    try {
      count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, windowSeconds);
    } catch (error) {
      // A Redis outage must not lock every account out of logging in.
      request.log.warn({ err: error }, 'per-account rate limit unavailable');
      return;
    }

    if (count > max) {
      const ttl = await this.redis.ttl(key).catch(() => windowSeconds);
      throw rateLimited(ttl > 0 ? ttl : windowSeconds, 'Too many attempts for this account');
    }
  };
}

export default fp(ratelimitPlugin, { name: 'ratelimit', dependencies: ['redis'] });
