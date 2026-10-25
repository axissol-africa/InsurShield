import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { databaseUrl, envSchema, testDatabase, useTestDatabase, validateEnv } from './env.js';

const SECRET = 's3cret-value';
const SENTINEL = 'sentinel-7f3a';

// Each of these lets node-postgres open another database, server or role than the URL names.
const REDIRECTING_PARAMETERS = [
  ['connectionString', `postgresql://other:${SENTINEL}@${SENTINEL}.example/${SENTINEL}`],
  ['host', `${SENTINEL}.example`],
  ['port', '6543'],
  ['user', SENTINEL],
  ['password', SENTINEL],
  ['database', SENTINEL],
  ['dbname', SENTINEL],
  ['options', `-c search_path=${SENTINEL}`],
  ['statement_timeout', '0'],
  ['lock_timeout', '0'],
  ['ssl', 'false'],
];

function withParameter(url: string, parameter: string, value: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}${parameter}=${encodeURIComponent(value)}`;
}

const valid = {
  PORT: '4000',
  CORS_ORIGINS: 'http://localhost:5173',
  DATABASE_URL: `postgresql://user:${SECRET}@localhost:5432/insurshield`,
  DATABASE_POOL_SIZE: '10',
  S3_BUCKET: 'insurshield-documents',
  KEYCLOAK_ISSUER: 'http://localhost:8080/realms/insurshield',
  KEYCLOAK_AUDIENCE: 'insurshield-api',
  KEYCLOAK_CLIENT_ID: 'insurshield-api',
  KEYCLOAK_CLIENT_SECRET: 'a-test-client-secret',
};

function problems(raw: Record<string, unknown>): string {
  try {
    validateEnv(raw);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected the configuration to be refused');
}

describe('validateEnv', () => {
  it('applies the defaults the API expects when only the essentials are set', () => {
    const env = validateEnv(valid);

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(4000);
    expect(env.API_PREFIX).toBe('api/v1');
    expect(env.DATABASE_POOL_SIZE).toBe(10);
    expect(env.SWAGGER_ENABLED).toBe(false);
    expect(env.S3_SIGNED_URL_TTL_SECONDS).toBe(300);
    expect(env.MAX_UPLOAD_BYTES).toBe(3 * 1024 * 1024);
    // Unset locally so MinIO does not reject the upload with 501.
    expect(env.S3_SSE).toBeUndefined();
  });

  it('rejects an issuer that is not a URL, since tokens are pinned to it', () => {
    expect(() => validateEnv({ ...valid, KEYCLOAK_ISSUER: 'not-a-url' })).toThrow(
      /KEYCLOAK_ISSUER/,
    );
  });

  it.each([
    'PORT',
    'CORS_ORIGINS',
    'DATABASE_URL',
    'DATABASE_POOL_SIZE',
    'KEYCLOAK_ISSUER',
    'KEYCLOAK_AUDIENCE',
    'KEYCLOAK_CLIENT_ID',
    'KEYCLOAK_CLIENT_SECRET',
    'S3_BUCKET',
  ])('requires %s, with no default host, port or name in code', (name) => {
    const { [name as keyof typeof valid]: _omitted, ...without } = valid;
    expect(problems(without)).toMatch(new RegExp(`- ${name}:`));
  });

  it('splits CORS_ORIGINS into a list', () => {
    const env = validateEnv({
      ...valid,
      CORS_ORIGINS: 'http://localhost:5173, https://app.insurshield.zm ,',
    });

    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173', 'https://app.insurshield.zm']);
  });

  it('coerces the numeric and boolean values that arrive as strings', () => {
    const env = validateEnv({
      ...valid,
      PORT: '8080',
      S3_FORCE_PATH_STYLE: 'true',
      SWAGGER_ENABLED: 'true',
    });

    expect(env.PORT).toBe(8080);
    expect(env.S3_FORCE_PATH_STYLE).toBe(true);
    expect(env.SWAGGER_ENABLED).toBe(true);
  });

  it.each(['yes', '1', 'TRUE'])('rejects SWAGGER_ENABLED=%s', (value) => {
    expect(problems({ ...valid, SWAGGER_ENABLED: value })).toMatch(/- SWAGGER_ENABLED:/);
  });

  it.each(['0', '65536', '40.5', 'abc'])('rejects PORT=%s', (value) => {
    expect(problems({ ...valid, PORT: value })).toMatch(/- PORT:/);
  });

  it.each(['1', '101', '2.5', 'ten', ''])('rejects DATABASE_POOL_SIZE=%j', (value) => {
    expect(problems({ ...valid, DATABASE_POOL_SIZE: value })).toMatch(/- DATABASE_POOL_SIZE:/);
  });

  it.each(['2', '100'])('accepts DATABASE_POOL_SIZE=%s', (value) => {
    expect(validateEnv({ ...valid, DATABASE_POOL_SIZE: value }).DATABASE_POOL_SIZE).toBe(
      Number(value),
    );
  });

  it.each([
    ['DATABASE_URL', `postgresql://user:CHANGE_ME@localhost:5432/insurshield`],
    ['KEYCLOAK_CLIENT_SECRET', 'CHANGE_ME'],
    ['S3_SECRET_ACCESS_KEY', `${SECRET}-CHANGE_ME`],
    ['CORS_ORIGINS', 'https://CHANGE_ME.example'],
  ])('refuses the CHANGE_ME placeholder in %s', (name, value) => {
    const message = problems({ ...valid, [name]: value });
    expect(message).toContain(`- ${name}: still contains the CHANGE_ME placeholder`);
    expect(message).not.toContain(SECRET);
  });

  it.each([
    ['not a URL', 'not a url'],
    ['another scheme', `mysql://user:${SECRET}@localhost/insurshield`],
    ['a NUL byte', `postgresql://user:${SECRET}@localhost/insur\0shield`],
    ['no database name', `postgresql://user:${SECRET}@localhost:5432`],
    ['a name Postgres would truncate', `postgresql://user:${SECRET}@localhost/${'a'.repeat(64)}`],
  ])('rejects a database URL with %s, without echoing it', (_case, value) => {
    const message = problems({ ...valid, DATABASE_URL: value });
    expect(message).toMatch(/- DATABASE_URL:/);
    expect(message).not.toContain(SECRET);
  });

  it.each(REDIRECTING_PARAMETERS)(
    'rejects a database URL that sets the %s parameter, naming it without its value',
    (parameter, value) => {
      const message = problems({ ...valid, DATABASE_URL: withParameter(valid.DATABASE_URL, parameter, value) });
      expect(message).toContain(`- DATABASE_URL: must not set the URL parameter ${parameter};`);
      expect(message).not.toContain(SECRET);
      expect(message).not.toContain(SENTINEL);
    },
  );

  it.each([
    ['sslmode', `postgresql://user:${SECRET}@db.example/insurshield?sslmode=require`],
    ['schema, as Prisma reads it', `postgresql://user:${SECRET}@localhost:5432/insurshield?schema=public`],
    ['an application name', `postgresql://user:${SECRET}@localhost/insurshield?application_name=api`],
    ['a Unix socket', `postgres://user:${SECRET}@%2Fvar%2Frun%2Fpostgresql/insurshield`],
  ])('accepts a database URL with %s', (_case, value) => {
    expect(validateEnv({ ...valid, DATABASE_URL: value }).DATABASE_URL).toBe(value);
  });

  it('rejects a signed-URL lifetime beyond the seven days S3 allows', () => {
    expect(() => validateEnv({ ...valid, S3_SIGNED_URL_TTL_SECONDS: '604801' })).toThrow(
      /S3_SIGNED_URL_TTL_SECONDS/,
    );
  });

  it('never echoes a value in any message', () => {
    const message = problems({
      ...valid,
      NODE_ENV: SECRET,
      PORT: SECRET,
      DATABASE_POOL_SIZE: SECRET,
      SWAGGER_ENABLED: SECRET,
      KEYCLOAK_ISSUER: SECRET,
      S3_ENDPOINT: SECRET,
      S3_SSE: SECRET,
      S3_SIGNED_URL_TTL_SECONDS: SECRET,
      DATABASE_URL: SECRET,
    });
    expect(message).not.toContain(SECRET);
  });

  it('reports every problem at once so a misconfigured deploy is fixed in one pass', () => {
    expect(() => validateEnv({ NODE_ENV: 'staging', PORT: 'abc' })).toThrow(
      /NODE_ENV[\s\S]*PORT[\s\S]*DATABASE_URL[\s\S]*KEYCLOAK_ISSUER[\s\S]*S3_BUCKET/,
    );
  });
});

describe('.env.example', () => {
  const documented = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
  const example = parseEnv(documented);

  it('documents every setting', () => {
    for (const name of [...Object.keys(envSchema.shape), 'TEST_DATABASE_URL']) {
      expect(documented, name).toMatch(new RegExp(`^#? ?${name}=`, 'm'));
    }
  });

  it('is refused until every placeholder is replaced, and valid after', () => {
    expect(problems(example)).toContain('still contains the CHANGE_ME placeholder');
    const filled = Object.fromEntries(
      Object.entries(example).map(([name, value]) => [name, value?.replaceAll('CHANGE_ME', 'x')]),
    );
    expect(() => validateEnv(filled)).not.toThrow();
  });
});

describe('the test database', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  function useEnvironment(values: Record<string, string>) {
    process.env = { ...values };
  }

  it('names the test database', () => {
    useEnvironment({ TEST_DATABASE_URL: `postgresql://user:${SECRET}@db/insurshield_test` });
    expect(testDatabase()).toEqual({
      url: `postgresql://user:${SECRET}@db/insurshield_test`,
      name: 'insurshield_test',
    });
  });

  it.each([
    ['is missing', undefined, 'TEST_DATABASE_URL must be set (see .env.example)'],
    [
      'does not end in _test',
      `postgresql://user:${SECRET}@db/insurshield`,
      'TEST_DATABASE_URL must name a database ending in _test',
    ],
    [
      'ends in _test only after truncation',
      `postgresql://user:${SECRET}@db/${'a'.repeat(60)}_test`,
      'TEST_DATABASE_URL must name a database of at most 63 bytes',
    ],
    [
      'holds a NUL byte',
      `postgresql://user:${SECRET}@db/insurshield_test?application_name=a%00b`,
      'TEST_DATABASE_URL must not contain a NUL byte',
    ],
    [
      'holds the placeholder',
      'postgresql://user:CHANGE_ME@db/insurshield_test',
      'TEST_DATABASE_URL still contains the CHANGE_ME placeholder',
    ],
  ])('refuses a TEST_DATABASE_URL that %s, without echoing it', (_case, value, message) => {
    useEnvironment(value === undefined ? {} : { TEST_DATABASE_URL: value });
    expect(() => testDatabase()).toThrow(message);
    expect(() => testDatabase()).not.toThrow(SECRET);
  });

  it.each(REDIRECTING_PARAMETERS)(
    'refuses a TEST_DATABASE_URL that sets the %s parameter, naming it without its value',
    (parameter, value) => {
      useEnvironment({
        TEST_DATABASE_URL: withParameter(`postgresql://user:${SECRET}@db/insurshield_test`, parameter, value),
      });
      expect(() => testDatabase()).toThrow(`TEST_DATABASE_URL must not set the URL parameter ${parameter};`);
      expect(() => testDatabase()).not.toThrow(SECRET);
      expect(() => testDatabase()).not.toThrow(SENTINEL);
    },
  );

  it('refuses a parameter name that is not a plain word without repeating it', () => {
    useEnvironment({ TEST_DATABASE_URL: `postgresql://user:${SECRET}@db/insurshield_test?${SENTINEL}-x=1` });
    expect(() => testDatabase()).toThrow('TEST_DATABASE_URL must not set the URL parameter (not a plain word);');
    expect(() => testDatabase()).not.toThrow(SENTINEL);
  });

  it('points the app at the test database and checks every setting', () => {
    useEnvironment({
      ...valid,
      TEST_DATABASE_URL: `postgresql://user:${SECRET}@db/insurshield_test`,
    });
    useTestDatabase();
    expect(process.env.DATABASE_URL).toBe(`postgresql://user:${SECRET}@db/insurshield_test`);
    expect(databaseUrl()).toBe(`postgresql://user:${SECRET}@db/insurshield_test`);
  });

  it('refuses a test database with the same name as the development one', () => {
    useEnvironment({
      ...valid,
      DATABASE_URL: `postgresql://user:${SECRET}@db/insurshield_test`,
      TEST_DATABASE_URL: `postgresql://user:${SECRET}@other/insurshield_test`,
    });
    expect(() => useTestDatabase()).toThrow(
      'TEST_DATABASE_URL must name a different database from DATABASE_URL',
    );
  });

  it('refuses to start the tests when another setting is invalid', () => {
    useEnvironment({
      ...valid,
      KEYCLOAK_CLIENT_SECRET: 'CHANGE_ME',
      TEST_DATABASE_URL: `postgresql://user:${SECRET}@db/insurshield_test`,
    });
    expect(() => useTestDatabase()).toThrow(/KEYCLOAK_CLIENT_SECRET/);
  });

  it('reads DATABASE_URL with the same rules', () => {
    useEnvironment({ DATABASE_URL: `postgresql://user:${SECRET}@db/insurshield?lock_timeout=0` });
    expect(() => databaseUrl()).toThrow('DATABASE_URL must not set the URL parameter lock_timeout;');
    expect(() => databaseUrl()).not.toThrow(SECRET);
  });
});
