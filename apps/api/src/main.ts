import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { appSettings, configureApp } from './app.setup.js';
import { ProviderRegistry } from './common/providers/provider-registry.js';
import type { Env } from './config/env.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService<Env, true>);
  configureApp(app, appSettings(config));
  // Closes the database pool and lets in-flight requests finish on SIGTERM,
  // which is how ECS, Fly and Render stop a container.
  app.enableShutdownHooks();

  // Initialised first: each adapter registers itself in onModuleInit, so the
  // registry is only complete once the modules are. The gate then runs before
  // the port opens, and a production deployment never serves traffic while an
  // outside system is simulated.
  await app.init();
  const registry = app.get(ProviderRegistry);
  const nodeEnv = config.get('NODE_ENV', { infer: true });
  try {
    registry.assertNoStandInsInProduction(nodeEnv);
  } catch (error) {
    await app.close();
    throw error;
  }
  registry.report(nodeEnv);

  const port = config.get('PORT', { infer: true });
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`API listening on http://localhost:${port}`);
}

await bootstrap();
