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
