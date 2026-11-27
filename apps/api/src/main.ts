import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { appSettings, configureApp } from './app.setup.js';
import { ProviderRegistry } from './common/providers/provider-registry.js';
import type { Env } from './config/env.js';
import { assertProductionTransport } from './config/production-transport.js';
import { startServing } from './serve.js';
import { SettingsService } from './settings/settings.service.js';

async function bootstrap() {
  // The raw body is kept so a payment provider's signature is checked over exactly the bytes it signed.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  const config = app.get(ConfigService<Env, true>);
  configureApp(app, appSettings(config));
  // Closes the database pool and lets in-flight requests finish on SIGTERM,
  // which is how ECS, Fly and Render stop a container.
  app.enableShutdownHooks();

  const registry = app.get(ProviderRegistry);
  const nodeEnv = config.get('NODE_ENV', { infer: true });
  try {
    if (nodeEnv === 'production') {
      assertProductionTransport({
        DATABASE_URL: config.get('DATABASE_URL', { infer: true }),
        BETTER_AUTH_URL: config.get('BETTER_AUTH_URL', { infer: true }),
        CORS_ORIGINS: config.get('CORS_ORIGINS', { infer: true }),
        MAIL_ENDPOINT: config.get('MAIL_ENDPOINT', { infer: true }),
        S3_ENDPOINT: config.get('S3_ENDPOINT', { infer: true }),
      });
    }
    // Adapters register during module initialization. Check the complete
    // registry and effective rule approvals before the port opens.
    await app.init();
    registry.assertNoStandInsInProduction(nodeEnv);
    await app.get(SettingsService).assertProductionRules();
  } catch (error) {
    await app.close();
    throw error;
  }
  registry.report(nodeEnv);

  const port = config.get('PORT', { infer: true });
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`API listening on http://localhost:${port}`);
  startServing(app);
}

await bootstrap();
