import { ValidationPipe, type INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Express } from 'express';
import { AUTH, AUTH_SETTINGS } from './auth/auth.constants.js';
import type { Auth, AuthSettings } from './auth/auth.instance.js';
import { mountIdentity } from './auth/identity-routes.js';
import { ApiExceptionFilter } from './common/filters/api-exception.filter.js';
import type { Env } from './config/env.js';
import { DATABASE, type Database } from './db/database.module.js';
import { setupSwagger } from './swagger.js';

export type AppSettings = Pick<Env, 'API_PREFIX' | 'CORS_ORIGINS' | 'SWAGGER_ENABLED' | 'TRUST_PROXY_HOPS'>;

export function appSettings(config: ConfigService<Env, true>): AppSettings {
  return {
    API_PREFIX: config.get('API_PREFIX', { infer: true }),
    CORS_ORIGINS: config.get('CORS_ORIGINS', { infer: true }),
    SWAGGER_ENABLED: config.get('SWAGGER_ENABLED', { infer: true }),
    TRUST_PROXY_HOPS: config.get('TRUST_PROXY_HOPS', { infer: true }),
  };
}

/** Everything the running API and the e2e apps share: the HTTP surface the web client sees. */
export function configureApp(app: INestApplication, settings: AppSettings) {
  const express = app.getHttpAdapter().getInstance() as Express;
  // `req.ip` is then the address the outermost trusted proxy saw, for rate limits and consent records.
  express.set('trust proxy', settings.TRUST_PROXY_HOPS);
  // Routes are served under this prefix so they line up with `apps/web/src/api/contracts.js`.
  app.setGlobalPrefix(settings.API_PREFIX, { exclude: ['health', 'health/ready'] });
  app.enableCors({ origin: settings.CORS_ORIGINS, credentials: true });
  mountIdentity(express, app.get<Auth>(AUTH), app.get<Database>(DATABASE), app.get<AuthSettings>(AUTH_SETTINGS));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new ApiExceptionFilter());
  if (settings.SWAGGER_ENABLED) {
    setupSwagger(app);
  }
}
