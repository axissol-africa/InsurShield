import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService<Env, true>);

  // Routes are served under this prefix so they line up with the paths in
  // `frontend/src/api/contracts.js` (default: /api/v1).
  app.setGlobalPrefix(config.get('API_PREFIX', { infer: true }), {
    exclude: ['health', 'health/ready'],
  });
  app.enableCors({ origin: config.get('CORS_ORIGINS', { infer: true }), credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  // Run Prisma's disconnect and in-flight requests to completion on SIGTERM,
  // which is how ECS, Fly and Render stop a container.
  app.enableShutdownHooks();

  const port = config.get('PORT', { infer: true });
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`API listening on http://localhost:${port}`);
}

await bootstrap();
