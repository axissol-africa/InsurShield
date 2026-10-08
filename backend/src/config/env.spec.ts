import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.js';

const valid = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/insurshield?schema=public',
  S3_BUCKET: 'insurshield-documents',
  AUTH_JWT_SECRET: 'a-test-signing-secret-long-enough-to-pass',
};

describe('validateEnv', () => {
  it('applies the defaults the API expects when only the essentials are set', () => {
    const env = validateEnv(valid);

    expect(env.NODE_ENV).toBe('development');
    // Must match VITE_API_BASE_URL in frontend/.env.example.
    expect(env.PORT).toBe(4000);
    expect(env.API_PREFIX).toBe('api/v1');
    expect(env.S3_SIGNED_URL_TTL_SECONDS).toBe(300);
    expect(env.MAX_UPLOAD_BYTES).toBe(3 * 1024 * 1024);
    // Unset locally so MinIO does not reject the upload with 501.
    expect(env.S3_SSE).toBeUndefined();
    expect(env.AUTH_TOKEN_TTL).toBe('12h');
  });

  it('refuses a signing secret short enough to be guessed', () => {
    expect(() => validateEnv({ ...valid, AUTH_JWT_SECRET: 'too-short' })).toThrow(
      /AUTH_JWT_SECRET/,
    );
  });

  it('refuses to start with no signing secret, rather than inventing one', () => {
    const { AUTH_JWT_SECRET: _omitted, ...withoutSecret } = valid;
    expect(() => validateEnv(withoutSecret)).toThrow(/AUTH_JWT_SECRET/);
  });

  it('splits CORS_ORIGINS into a list', () => {
    const env = validateEnv({
      ...valid,
      CORS_ORIGINS: 'http://localhost:5173, https://app.insurshield.zm ,',
    });

    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173', 'https://app.insurshield.zm']);
  });

  it('coerces the numeric and boolean values that arrive as strings', () => {
    const env = validateEnv({ ...valid, PORT: '8080', S3_FORCE_PATH_STYLE: 'true' });

    expect(env.PORT).toBe(8080);
    expect(env.S3_FORCE_PATH_STYLE).toBe(true);
  });

  it('rejects a missing database URL rather than failing at the first query', () => {
    expect(() => validateEnv({ S3_BUCKET: 'x' })).toThrow(/DATABASE_URL/);
  });

  it('rejects a database URL that is not Postgres', () => {
    expect(() => validateEnv({ ...valid, DATABASE_URL: 'mysql://localhost/db' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('rejects a signed-URL lifetime beyond the seven days S3 allows', () => {
    expect(() => validateEnv({ ...valid, S3_SIGNED_URL_TTL_SECONDS: '604801' })).toThrow(
      /S3_SIGNED_URL_TTL_SECONDS/,
    );
  });

  it('reports every problem at once so a misconfigured deploy is fixed in one pass', () => {
    expect(() => validateEnv({ NODE_ENV: 'staging', PORT: 'abc' })).toThrow(
      /NODE_ENV[\s\S]*PORT[\s\S]*DATABASE_URL[\s\S]*AUTH_JWT_SECRET[\s\S]*S3_BUCKET/,
    );
  });
});
