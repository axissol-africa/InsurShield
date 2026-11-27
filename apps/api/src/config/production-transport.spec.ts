import { describe, expect, it } from 'vitest';
import { assertProductionTransport } from './production-transport.js';

const valid = {
  DATABASE_URL: 'postgres://user:private@db.example.test/insurshield?sslmode=verify-full',
  BETTER_AUTH_URL: 'https://api.example.test',
  CORS_ORIGINS: ['https://app.example.test'],
  MAIL_ENDPOINT: 'https://mail.example.test/deliver',
  S3_ENDPOINT: undefined,
};

describe('production transport', () => {
  it('accepts explicit database verification and HTTPS with default or custom object storage', () => {
    expect(() => assertProductionTransport(valid)).not.toThrow();
    expect(() => assertProductionTransport({ ...valid, S3_ENDPOINT: 'https://objects.example.test' })).not.toThrow();
  });

  it.each(['', '?sslmode=disable', '?sslmode=require', '?sslmode=verify-full&sslmode=disable'])(
    'requires explicit server certificate and hostname verification for %s',
    (parameters) => {
      expect(() => assertProductionTransport({
        ...valid,
        DATABASE_URL: `postgres://user:private@db.example.test/insurshield${parameters}`,
      })).toThrow(/^Production requires verified transport for: DATABASE_URL \(sslmode=verify-full\)\.$/);
    },
  );

  it('lists unsafe configuration names without revealing connection strings', () => {
    expect(() => assertProductionTransport({
      ...valid,
      BETTER_AUTH_URL: 'http://api.example.test',
      CORS_ORIGINS: ['https://app.example.test', 'http://app.example.test'],
      MAIL_ENDPOINT: 'https://user:password@mail.example.test/deliver',
      S3_ENDPOINT: 'http://objects.example.test',
    })).toThrow(/^Production requires verified transport for: BETTER_AUTH_URL, CORS_ORIGINS, MAIL_ENDPOINT, S3_ENDPOINT\.$/);
  });
});
