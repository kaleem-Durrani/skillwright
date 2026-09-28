import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/**
 * Configuration is parsed exactly once, at module load, because a process that
 * discovers a missing key on request #4000 has already lied about being healthy.
 */

/**
 * One .env at the repository root, loaded with Node's own reader — no dotenv
 * dependency, and no per-package copies drifting out of sync. Skipped under test,
 * where the harness owns the environment and a stray developer .env would make the
 * suite pass or fail depending on whose machine it ran on.
 */
if (process.env.NODE_ENV !== 'test' && typeof process.loadEnvFile === 'function') {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [resolve(here, '../../..', '.env'), resolve(process.cwd(), '.env')]) {
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      break;
    }
  }
}

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const port = z.coerce.number().int().min(1).max(65_535);

/** Positive integer with a default, used by every RATE_LIMIT_* knob. */
const count = z.coerce.number().int().positive();

const base64Key32 = z.string().refine((v) => {
  try {
    return Buffer.from(v, 'base64').length === 32;
  } catch {
    return false;
  }
}, 'must be exactly 32 bytes encoded as base64 (generate: `openssl rand -base64 32`)');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /**
   * Where this process is actually deployed. Deliberately separate from NODE_ENV:
   * a staging box runs NODE_ENV=production but must still refuse production-only
   * safeguards like the demo login.
   */
  DEPLOY_ENV: z.enum(['local', 'ci', 'staging', 'production']).default('local'),

  PORT: port.default(4000),
  HOST: z.string().min(1).default('0.0.0.0'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  SESSION_COOKIE_NAME: z.string().min(1).default('__Host-sw_session'),
  ENCRYPTION_KEY: base64Key32,

  /** Comma-separated list. Doubles as the CORS allowlist and the CSRF origin check. */
  ALLOWED_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((v) =>
      v
        .split(',')
        .map((o) => o.trim().replace(/\/$/, ''))
        .filter(Boolean),
    )
    .pipe(z.array(z.string().url()).min(1)),

  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: bool.default('true'),

  SMTP_HOST: z.string().min(1),
  SMTP_PORT: port.default(1025),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  MAIL_FROM: z.string().min(1),

  /**
   * Where the built SPA lives, when this process is also serving it.
   *
   * Set only in the production image, which copies apps/web/dist to /app/public and
   * runs one process on one origin — which is not a packaging convenience but the
   * reason the session cookie can be `__Host-` with `SameSite=Lax` and no CORS surface
   * at all (docs/adr/0004-same-origin-sessions-and-csrf.md).
   *
   * Unset in development, where Vite serves the SPA on :5173 and proxies /api to this
   * process. Absent means "do not serve static files", not "serve from the default" —
   * a wrong default here would shadow the API with a 404 page.
   *
   * The Dockerfile has set this since it was written; nothing read it until now, so
   * the image built the SPA, copied it in, and answered `/` with a 404.
   */
  WEB_DIST_DIR: z.string().min(1).optional(),

  /** Enables POST /auth/demo. Hard-refused when DEPLOY_ENV === 'production'. */
  DEMO_MODE: bool.default('false'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /** Number of proxy hops to trust for req.ip. 0 disables X-Forwarded-For entirely. */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),

  RATE_LIMIT_GLOBAL_MAX: count.default(300),
  RATE_LIMIT_GLOBAL_WINDOW_MS: count.default(60_000),
  RATE_LIMIT_AUTH_IP_MAX: count.default(20),
  RATE_LIMIT_AUTH_IP_WINDOW_MS: count.default(60_000),
  RATE_LIMIT_AUTH_ACCOUNT_MAX: count.default(10),
  RATE_LIMIT_AUTH_ACCOUNT_WINDOW_MS: count.default(900_000),

  /**
   * The abandoned-upload sweeper (uploads.sweeper.ts): how often it runs, and how old a
   * PENDING row must be before the job reclaims it. The age default is a full day —
   * deliberately many times the 15-minute PUT signature lifetime, so no live dialog can
   * ever have its row swept from under a PUT in flight.
   */
  UPLOAD_SWEEP_INTERVAL_MS: count.default(300_000),
  UPLOAD_SWEEP_MAX_AGE_MS: count.default(86_400_000),

  /**
   * The retention sweeper (modules/audit/retention.sweeper.ts): how often it runs. It
   * reclaims three kinds of row that the database already knows are dead, so the interval
   * is a load question rather than a correctness one — an hour late on an expired session
   * costs nothing, because `findLiveSession` refuses it the moment its clock passes and
   * deletes it inline on the way out.
   */
  RETENTION_SWEEP_INTERVAL_MS: count.default(3_600_000),

  /**
   * How many due account deletions ONE tick of the retention sweeper may finalise.
   *
   * A per-run work bound rather than an interval, which is why it is a separate key: an
   * interval says how often the clock rings, this says how much the answer may cost when
   * it does. A hundred is generous for a system with one API process, and a backlog
   * larger than that drains across successive hourly ticks rather than in one statement —
   * the same trade `AUDIT_PRUNE_BATCH` makes for the audit table.
   *
   * It is a BOUND and not a threshold: nothing about an account's deletion depends on it,
   * only how quickly a large backlog is worked off. Every account the predicate selects
   * is finalised on some tick regardless of this number, and a pass that is skipping
   * because the queue is empty is not "delayed" by it.
   */
  ACCOUNT_DELETION_SWEEP_MAX_PER_RUN: count.default(100),

  /**
   * How long a SPENT recovery code's hash is kept before it is reclaimed.
   *
   * A month, and the word doing the work is SPENT. This age never applies to an unused
   * code: a recovery code is password-equivalent, `regenerateRecoveryCodes` shows it once
   * and never again (totp.service.ts:90-95), and the model has no `expiresAt` — so a
   * sweeper that reached for `createdAt` here would be deleting live credentials. The
   * WHERE clause is `usedAt IS NOT NULL`, and this number only decides how long a code
   * that can no longer authenticate anything is kept for forensics.
   * See packages/db/src/retention/sweepers.ts.
   */
  SPENT_RECOVERY_CODE_SWEEP_MAX_AGE_MS: count.default(2_592_000_000),

  /**
   * The audit trail's retention window, in days. UNSET, and there is no default, on
   * purpose.
   *
   * `AuditEvent` is the compliance record, and how long a school must keep one is a
   * question about the school's obligations, not about this database — so this repository
   * does not answer it. Phase 7 of the feature plan says so directly: "it is the
   * compliance record, so its retention is a policy question, not a technical one. Do not
   * invent a number." Inventing 365 would have looked like a decision and functioned as
   * one, in a file nobody reads, deleting compliance evidence on a schedule chosen by a
   * default value.
   *
   * So the mechanism ships and the decision does not. Unset, or `0`, means KEEP
   * EVERYTHING, and the sweeper says so in the log on every boot rather than trimming
   * quietly. An operator who has a real obligation sets a number here; one who has not
   * sets nothing and loses nothing. `null` — rather than `0` — is what carries "not
   * decided" through to the pruner, so the state cannot be confused with a real window of
   * zero days.
   *
   * Nothing else in this file is this asymmetric, and the asymmetry is the point: every
   * other default here is a safe value for the mechanism it configures, and this one is
   * not a value at all.
   */
  AUDIT_RETENTION_DAYS: z
    .union([z.literal(''), z.coerce.number().int().min(0)])
    .optional()
    .transform((v) => (v === undefined || v === '' || v === 0 ? null : v)),
});

export type Env = Readonly<z.infer<typeof envSchema>>;

function parseEnv(source: NodeJS.ProcessEnv): Env {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    // Report EVERY bad key at once: fixing configuration one restart at a time is
    // the slowest possible feedback loop.
    const lines = parsed.error.issues.map((issue) => {
      const key = issue.path.join('.') || '(root)';
      return `  - ${key}: ${issue.message}`;
    });
    process.stderr.write(
      `\nInvalid environment configuration (${lines.length} problem(s)):\n${lines.join('\n')}\n\n` +
        `See .env.example at the repository root for every key and its dev default.\n\n`,
    );
    process.exit(1);
  }

  return Object.freeze(parsed.data);
}

export const env: Env = parseEnv(process.env);

export const isProduction = env.DEPLOY_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
