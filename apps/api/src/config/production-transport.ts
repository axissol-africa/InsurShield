import type { Env } from './env.js';

type TransportSettings = Pick<Env, 'DATABASE_URL' | 'BETTER_AUTH_URL' | 'CORS_ORIGINS' | 'MAIL_ENDPOINT' | 'S3_ENDPOINT'>;

function httpsEndpoint(value: string): boolean {
  const url = URL.parse(value);
  return Boolean(url?.protocol === 'https:' && !url.username && !url.password);
}

export function assertProductionTransport(settings: TransportSettings) {
  const blocked: string[] = [];
  const database = URL.parse(settings.DATABASE_URL);
  const sslModes = database?.searchParams.getAll('sslmode');
  if (sslModes?.length !== 1 || sslModes[0] !== 'verify-full') blocked.push('DATABASE_URL (sslmode=verify-full)');
  if (!httpsEndpoint(settings.BETTER_AUTH_URL)) blocked.push('BETTER_AUTH_URL');
  if (settings.CORS_ORIGINS.length === 0 || !settings.CORS_ORIGINS.every(httpsEndpoint)) blocked.push('CORS_ORIGINS');
  if (settings.MAIL_ENDPOINT !== undefined && !httpsEndpoint(settings.MAIL_ENDPOINT)) blocked.push('MAIL_ENDPOINT');
  if (settings.S3_ENDPOINT !== undefined && !httpsEndpoint(settings.S3_ENDPOINT)) blocked.push('S3_ENDPOINT');
  if (blocked.length) throw new Error(`Production requires verified transport for: ${blocked.join(', ')}.`);
}
