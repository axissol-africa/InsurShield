import { ValidationPipe, type INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { ApiExceptionFilter } from './common/filters/api-exception.filter.js';
import type { Env } from './config/env.js';
import { setupSwagger } from './swagger.js';

export type AppSettings = Pick<Env, 'API_PREFIX' | 'CORS_ORIGINS' | 'SWAGGER_ENABLED'>;

export function appSettings(config: ConfigService<Env, true>): AppSettings {
  return {
    API_PREFIX: config.get('API_PREFIX', { infer: true }),
    CORS_ORIGINS: config.get('CORS_ORIGINS', { infer: true }),
    SWAGGER_ENABLED: config.get('SWAGGER_ENABLED', { infer: true }),
  };
}

/** Everything the running API and the e2e apps share: the HTTP surface the web client sees. */
export function configureApp(app: INestApplication, settings: AppSettings) {
  // Routes are served under this prefix so they line up with `apps/web/src/api/contracts.js`.
  app.setGlobalPrefix(settings.API_PREFIX, { exclude: ['health', 'health/ready'] });
  app.enableCors({ origin: settings.CORS_ORIGINS, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new ApiExceptionFilter());
  if (settings.SWAGGER_ENABLED) {
    setupSwagger(app);
  }
}
