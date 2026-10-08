import { z } from 'zod';

/**
 * Every environment variable the API needs, validated once at boot. A missing or
 * malformed value fails startup here rather than surfacing as a runtime error
 * somewhere deep in a request.
 */
const booleanish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((value) => value === true || value === 'true' || value === '1');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  API_PREFIX: z.string().default('api/v1'),
  /** Comma-separated list of browser origins allowed to call the API. */
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean)),

  DATABASE_URL: z.string().startsWith('postgres'),

  // ── Identity ────────────────────────────────────────────────────────
  /**
   * Signs this service's access tokens. Anyone holding it can mint a token for
   * any account, so it belongs in Secrets Manager in production and must be
   * long enough that guessing it is hopeless. Changing it signs everyone out.
   */
  AUTH_JWT_SECRET: z.string().min(32, 'AUTH_JWT_SECRET must be at least 32 characters'),
  /** How long an access token stays valid; any span `jose` accepts, e.g. "12h". */
  AUTH_TOKEN_TTL: z.string().default('12h'),

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
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
