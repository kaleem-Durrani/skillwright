import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { API_BASE_PATH } from '@skillwright/shared';
import { env } from '../env.js';
import { sha256 } from '../lib/crypto.js';
import { rateLimited } from '../lib/errors.js';
import { baseLogger } from '../lib/logger.js';

const log = baseLogger.child({ module: 'ratelimit' });

/**
 * The two rate-limit knobs this phase added, parsed HERE rather than in `env.ts`.
 *
 * `env.ts` is not this phase's file, and the repo's own convention is that every knob
 * is validated at boot with a list of ALL problems rather than the first. So this
 * follows that convention in miniature instead of quietly reading `process.env` and
 * inheriting a typo as `NaN`: a bad value stops the process here, at module load, with
 * the name of the key. Both defaults are the ones in `.env.example` — 0 there is not
 * "unlimited" for these two, it is a number of requests per window, and the difference
 * between "0 means off" and "0 means nobody may ever make a request" is exactly why the
 * parse is explicit.
 */
export const RATE_LIMIT_BUCKETS = z
  .object({
    RATE_LIMIT_ASSET_MAX: z.coerce.number().int().positive().default(3_000),
    RATE_LIMIT_ASSET_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_API_USER_MAX: z.coerce.number().int().positive().default(600),
    RATE_LIMIT_API_USER_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  })
  .parse(process.env);

/** Which counter a request spends. Chosen ONCE, in `classifyBucket`, and used by key AND max. */
export type RateLimitBucket = 'api:ip' | 'api:user' | 'asset:ip';

export interface BucketDecision {
  bucket: RateLimitBucket;
  key: string;
  max: number;
  timeWindow: number;
}

/**
 * The per-IP trust question, stated once because it decides whether the `api:ip` bucket
 * means anything at all.
 *
 * `TRUST_PROXY_HOPS` is the number of reverse-proxy hops whose `X-Forwarded-For` this
 * process is willing to believe. At 0 — the default in `.env.example`, and the value in
 * every environment that nobody edited — Fastify IGNORES the header and `request.ip` is
 * the TCP peer. Behind any load balancer, a reverse proxy or a container network that
 * peer is the PROXY, so every request from every user in the school shares one counter,
 * and the per-IP bucket stops being a defence and becomes a shared quota that the
 * first busy classroom exhausts for everybody.
 *
 * What setting it does: it makes `request.ip` the address the outermost trusted hop
 * recorded, so the per-IP bucket counts people rather than infrastructure.
 *
 * What setting it does NOT do, which is the part that is easy to assume:
 *
 *  - it authenticates NOTHING. It is a header-trust setting. Every hop counted here is
 *    a header a client could forge if it could reach this process without passing
 *    through them, so the number must equal the REAL hop count and no more. One hop too
 *    many and a caller picks their own rate-limit bucket by sending its own
 *    `X-Forwarded-For`; the limit is enforced against an address the attacker chose.
 *  - it does not make the `api:user` bucket trustworthy, or vice versa. The user bucket
 *    needs no proxy configuration at all, which is the argument for it and the reason
 *    this split is worth having even where `TRUST_PROXY_HOPS` is correct.
 *  - it does not affect `RATE_LIMIT_AUTH_*`, whose `api:ip` key is a brute-force
 *    heuristic and a bad key there costs an extra guess, not a leaked account.
 *
 * The warning below is the point: an operator who has never read this file should not
 * have to guess whether their per-IP bucket is counting people.
 */
function trustProxyIsUnconfigured(): boolean {
  return env.TRUST_PROXY_HOPS === 0;
}

/**
 * The one decision: which counter does this request spend?
 *
 * Exported, and PURE, because the live path can only prove two of the three buckets:
 * this app registers no static plugin, so there is no asset URL for a test to request,
 * and the one a browser really produces is the one worth pinning. The live assertions
 * cover the two API buckets through real requests; this covers all three.
 *
 * Called from BOTH `keyGenerator` and `max`, so the ceiling a request is judged against
 * and the key it is counted under can never come from two different classifications.
 * That is the whole reason this is a function rather than two expressions — the
 * alternative is an `api:user` key judged against the anonymous ceiling, which is a
 * limit that looks configured and is not.
 */
export function classifyBucket(input: {
  url: string;
  ip: string;
  userId: string | undefined;
}): BucketDecision {
  const asset: BucketDecision = {
    bucket: 'asset:ip',
    key: `asset:ip:${input.ip}`,
    max: RATE_LIMIT_BUCKETS.RATE_LIMIT_ASSET_MAX,
    timeWindow: RATE_LIMIT_BUCKETS.RATE_LIMIT_ASSET_WINDOW_MS,
  };

  // Everything the application serves rather than calls: the SPA shell and the
  // fingerprinted bundles under /assets. These were previously counted against the API
  // ceiling, so a single page load — 8 API calls plus every chunk and icon the browser
  // decides it wants — spent a budget the API was supposed to be answering from. A page
  // with a cold cache can pull forty assets, which on the old shape meant a teacher's
  // browser could spend 40 of the 300 requests/minute before they had made a single API
  // call. The assets get their own, much larger, bucket; they are cheap to serve and
  // expensive to count.
  if (!input.url.startsWith(API_BASE_PATH)) return asset;

  /*
   * The user, not the address.
   *
   * `request.actor` is populated by auth.plugin's `onRequest` hook, and this plugin's
   * hook runs at `preValidation` — later — precisely so that it is. At `onRequest`,
   * which is where this plugin used to sit, no session had been resolved yet and the
   * only thing available was the address; the ordering was the reason the old bucket
   * could only ever key on `request.ip`.
   *
   * `preValidation` is the earliest hook that has both, and it still runs before every
   * route's `authorize()` preHandler, so a caller who is about to be refused for lacking
   * permission has still spent their quota. That matters: a bucket that stopped
   * counting refusals would not be a bucket.
   *
   * WHAT MOVED WITH THE HOOK, because a lower hook is not free: a request that fails to
   * PARSE — malformed JSON, a body over `bodyLimit` — is now answered before this
   * counter is touched. That is a real change and it is bounded: those requests never
   * reach a query, the body limit caps what one costs to reject, and the two
   * credential buckets that actually protect an account are unaffected.
   */
  if (input.userId !== undefined) {
    return {
      bucket: 'api:user',
      key: `api:user:${input.userId}`,
      max: RATE_LIMIT_BUCKETS.RATE_LIMIT_API_USER_MAX,
      timeWindow: RATE_LIMIT_BUCKETS.RATE_LIMIT_API_USER_WINDOW_MS,
    };
  }

  // Anonymous. The address is the only identity there is, which is also why the
  // TRUST_PROXY_HOPS warning above matters most for exactly these requests.
  return {
    bucket: 'api:ip',
    key: `api:ip:${input.ip}`,
    max: env.RATE_LIMIT_GLOBAL_MAX,
    timeWindow: env.RATE_LIMIT_GLOBAL_WINDOW_MS,
  };
}

/** The same decision, for the three things a Fastify request actually carries. */
function bucketFor(request: FastifyRequest): BucketDecision {
  return classifyBucket({ url: request.url, ip: request.ip, userId: request.actor?.id });
}

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
    // The shared client, and the reason this store is shared at all: the API runs
    // behind more than one process (a container replica, `pnpm dev`'s restart, the
    // test suite's own forks), and a per-process counter is a counter that resets
    // every time a worker dies. Omitting this line does not fail — @fastify/rate-limit
    // falls back to an in-process `LocalStore`, which passes every functional test
    // and rate-limits nothing across a deployment. Measured while writing this file.
    redis: app.redis,
    // `preValidation`, not the default `onRequest`: see `bucketFor`. Everything below
    // is a consequence of that one choice, and the reason for it is written there.
    hook: 'preValidation',
    nameSpace: 'rl:',
    // A Redis outage must degrade to "unlimited", not "everything is a 429".
    skipOnError: true,
    keyGenerator: (request: FastifyRequest) => bucketFor(request).key,
    max: (request: FastifyRequest) => bucketFor(request).max,
    timeWindow: (request: FastifyRequest) => bucketFor(request).timeWindow,
    addHeadersOnExceeding: { 'x-ratelimit-limit': true, 'x-ratelimit-remaining': true },
  });

  /*
   * The whole rate-limit configuration on every boot, as one structured line.
   *
   * Phase 7 established the pattern with `AUDIT_RETENTION_DAYS` — a mechanism ships
   * with its state on the log rather than in a file nobody reads — and the reason is
   * the same. "Is my rate limit working" is a question this file answers in four
   * different numbers, and the only way to know which of them a running process is
   * using is to ask it. A rate limit that is silently keyed on the load balancer is
   * indistinguishable from one that is working until the day it is not.
   */
  const trusted = trustProxyIsUnconfigured()
    ? 'UNSET — request.ip is the TCP peer, so the anonymous api:ip bucket counts whoever connects to this process'
    : `${env.TRUST_PROXY_HOPS} hop(s) of X-Forwarded-For trusted`;

  log.info(
    {
      buckets: {
        'api:user': `${RATE_LIMIT_BUCKETS.RATE_LIMIT_API_USER_MAX} per ${RATE_LIMIT_BUCKETS.RATE_LIMIT_API_USER_WINDOW_MS}ms per user id`,
        'api:ip': `${env.RATE_LIMIT_GLOBAL_MAX} per ${env.RATE_LIMIT_GLOBAL_WINDOW_MS}ms per address (anonymous API calls only)`,
        'asset:ip': `${RATE_LIMIT_BUCKETS.RATE_LIMIT_ASSET_MAX} per ${RATE_LIMIT_BUCKETS.RATE_LIMIT_ASSET_WINDOW_MS}ms per address (SPA shell and /assets)`,
        'auth:ip': `${env.RATE_LIMIT_AUTH_IP_MAX} per ${env.RATE_LIMIT_AUTH_IP_WINDOW_MS}ms per address`,
        'auth:account': `${env.RATE_LIMIT_AUTH_ACCOUNT_MAX} per ${env.RATE_LIMIT_AUTH_ACCOUNT_WINDOW_MS}ms per account`,
      },
      trustProxyHops: env.TRUST_PROXY_HOPS,
      trustProxy: trusted,
    },
    'rate limit buckets configured',
  );

  if (trustProxyIsUnconfigured() && env.DEPLOY_ENV !== 'local') {
    log.warn(
      {
        deployEnv: env.DEPLOY_ENV,
        fix: 'set TRUST_PROXY_HOPS to the real number of reverse-proxy hops, or every anonymous API caller shares one bucket',
      },
      'TRUST_PROXY_HOPS is 0 outside local development: the per-address buckets are counting your load balancer, not your users',
    );
  }
};

/** Route-level override: the strict per-IP bucket for credential-handling endpoints. */
export const authIpRateLimit = {
  rateLimit: {
    max: env.RATE_LIMIT_AUTH_IP_MAX,
    timeWindow: env.RATE_LIMIT_AUTH_IP_WINDOW_MS,
    // The credential buckets keep the per-IP key, deliberately and against the grain of
    // the split above. Here the address is a heuristic for "is this one host grinding
    // through many accounts", and a bad key costs an attacker a few extra guesses
    // against `RATE_LIMIT_AUTH_ACCOUNT_MAX`, which is keyed on the account itself and
    // cannot be dodged by rotating addresses. It is worth saying out loud, because the
    // obvious-looking change — keying these on the user too — would key a bucket whose
    // whole purpose is "before we know who you are" on a session that does not exist.
    keyGenerator: (request: FastifyRequest) => `auth:ip:${request.ip}`,
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

    const key = `rl:auth:acct:${bucket}:${sha256(identity.toLowerCase())}`;

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
      request.log.warn(
        { bucket, limit: 'auth:account', max, windowMs },
        'rate limit refused a request',
      );
      throw rateLimited(ttl > 0 ? ttl : windowSeconds, 'Too many attempts for this account');
    }
  };
}

export default fp(ratelimitPlugin, { name: 'ratelimit', dependencies: ['redis'] });
