import { existsSync } from 'node:fs';
import { parse } from 'pg-connection-string';
import { z } from 'zod';

/**
 * Every environment variable the API needs, validated once at boot. A missing or
 * malformed value fails startup here rather than surfacing as a runtime error
 * somewhere deep in a request. Messages name a variable, never its value.
 */
const PLACEHOLDER = 'CHANGE_ME';
// Postgres silently truncates longer names, which would defeat the _test check.
export const MAX_DATABASE_NAME_BYTES = 63;
export const TEST_DATABASE_SUFFIX = '_test';
// node-postgres also reads the host, port, user, database, a nested connectionString and
// session settings from URL parameters, overriding the URL's own parts, so only these pass.
const URL_PARAMETERS = ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'application_name', 'schema'];
// Parts pg-connection-string derives from the URL itself rather than from its parameters.
const URL_PARTS = ['user', 'password', 'host', 'port', 'database', 'ssl'];
// The migration run holds one connection for its whole duration; requests need another.
const MIN_POOL_SIZE = 2;
const MAX_POOL_SIZE = 100;

const booleanish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((value) => value === true || value === 'true' || value === '1');

const wholeNumber = (min: number, max: number) =>
  z
    .string()
    .regex(/^\d+$/, `must be a whole number from ${min} to ${max}`)
    .transform(Number)
    .pipe(z.number().min(min).max(max, `must be a whole number from ${min} to ${max}`));

function databaseUrlProblem(value: string): string | undefined {
  if (!/^postgres(ql)?:\/\//.test(value)) {
    return 'must be a postgres:// URL';
  }
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(value);
  } catch {
    return 'must be a postgres:// URL';
  }
  // A NUL byte in any parameter can add a second database name to the
  // connection request, and Postgres uses the last one.
  if (
    value.includes('\0') ||
    Object.values(parsed).some((setting) => typeof setting === 'string' && setting.includes('\0'))
  ) {
    return 'must not contain a NUL byte';
  }
  const parameters = [
    ...urlParameterNames(value),
    ...Object.keys(parsed).filter((name) => !URL_PARTS.includes(name)),
  ];
  const refused = parameters.find((name) => !URL_PARAMETERS.includes(name));
  if (refused !== undefined) {
    const label = /^\w{1,63}$/.test(refused) ? refused : '(not a plain word)';
    return `must not set the URL parameter ${label}; only ${URL_PARAMETERS.join(', ')} are accepted`;
  }
  const database = parsed.database;
  if (!database || Buffer.byteLength(database) > MAX_DATABASE_NAME_BYTES) {
    return `must name a database of at most ${MAX_DATABASE_NAME_BYTES} bytes`;
  }
  return undefined;
}

// The query runs from the first '?' to any '#', as the WHATWG URL parser that pg uses reads it.
function urlParameterNames(value: string): string[] {
  const beforeFragment = value.split('#')[0];
  const start = beforeFragment.indexOf('?');
  return start < 0 ? [] : [...new URLSearchParams(beforeFragment.slice(start + 1)).keys()];
}

const databaseUrlSetting = z.string().superRefine((value, context) => {
  const problem = databaseUrlProblem(value);
  if (problem) {
    context.addIssue({ code: 'custom', message: problem });
  }
});

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: wholeNumber(1, 65535),
  API_PREFIX: z.string().default('api/v1'),
  /** Comma-separated list of browser origins allowed to call the API. */
  CORS_ORIGINS: z
    .string()
    .min(1)
    .transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean)),

  DATABASE_URL: databaseUrlSetting,
  DATABASE_POOL_SIZE: wholeNumber(MIN_POOL_SIZE, MAX_POOL_SIZE),

  /** API docs describe every endpoint and error, so production can leave them off. */
  SWAGGER_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),

  // ── Identity (Keycloak) ─────────────────────────────────────────────
  /**
   * The realm's issuer URL. Tokens are accepted only if their `iss` matches
   * this exactly, and their signature verifies against the realm's JWKS.
   */
  KEYCLOAK_ISSUER: z.string().url(),
  /** The audience this API expects in an access token. */
  KEYCLOAK_AUDIENCE: z.string().min(1),
  /** Confidential client used for administrative user management. */
  KEYCLOAK_CLIENT_ID: z.string().min(1),
  KEYCLOAK_CLIENT_SECRET: z.string().min(1),

  /** Unset in production so the AWS SDK talks to real S3. */
  S3_ENDPOINT: z.string().url().optional(),
  /** MinIO needs path-style addressing; S3 does not. */
  S3_FORCE_PATH_STYLE: booleanish.default(false),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().min(1),
  /** Omit both keys in production to fall back to the instance/task IAM role. */
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().max(604800).default(300),
  /**
   * Server-side encryption applied on upload. Leave unset for MinIO, which
   * rejects the header with 501 NotImplemented. On S3 use 'AES256' (SSE-S3) or
   * 'aws:kms' with S3_SSE_KMS_KEY_ID. S3 also encrypts by default at the bucket
   * level, so this is belt-and-braces rather than the only protection.
   */
  S3_SSE: z.enum(['AES256', 'aws:kms']).optional(),
  S3_SSE_KMS_KEY_ID: z.string().optional(),

  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(3 * 1024 * 1024),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const placeholders = Object.keys(envSchema.shape).filter((name) => {
    const value = raw[name];
    return typeof value === 'string' && value.includes(PLACEHOLDER);
  });
  const result = envSchema.safeParse(raw);
  const issues = [
    ...(result.success
      ? []
      : result.error.issues
          .filter((issue) => !placeholders.includes(String(issue.path[0])))
          .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)),
    ...placeholders.map((name) => `  - ${name}: still contains the ${PLACEHOLDER} placeholder`),
  ];
  if (!result.success || placeholders.length > 0) {
    throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`);
  }
  return result.data;
}

export function loadEnvFile(path = '.env') {
  if (existsSync(path)) {
    process.loadEnvFile(path);
  }
}

function postgresUrl(name: string): { url: string; database: string } {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set (see .env.example)`);
  }
  if (value.includes(PLACEHOLDER)) {
    throw new Error(`${name} still contains the ${PLACEHOLDER} placeholder`);
  }
  const problem = databaseUrlProblem(value);
  if (problem) {
    throw new Error(`${name} ${problem}`);
  }
  return { url: value, database: parse(value).database ?? '' };
}

/** DATABASE_URL for the tools that run outside Nest: the migration entry point and drizzle-kit. */
export function databaseUrl(): string {
  return postgresUrl('DATABASE_URL').url;
}

// Migration and e2e specs drop and recreate this database, so it must be a test one.
export function testDatabase(): { url: string; name: string } {
  const { url, database } = postgresUrl('TEST_DATABASE_URL');
  if (!database.endsWith(TEST_DATABASE_SUFFIX)) {
    throw new Error(`TEST_DATABASE_URL must name a database ending in ${TEST_DATABASE_SUFFIX}`);
  }
  return { url, name: database };
}

// Runs before any e2e setup touches the test database: the app under test must
// use that database, never the development one, and every setting must pass.
export function useTestDatabase() {
  const test = testDatabase();
  if (process.env.DATABASE_URL && postgresUrl('DATABASE_URL').database === test.name) {
    throw new Error('TEST_DATABASE_URL must name a different database from DATABASE_URL');
  }
  process.env.DATABASE_URL = test.url;
  validateEnv(process.env);
}
