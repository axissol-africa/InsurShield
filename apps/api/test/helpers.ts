import type { INestApplication, LoggerService, Provider, Type } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { appSettings, configureApp, type AppSettings } from '../src/app.setup.js';
import type { Env } from '../src/config/env.js';
import { testDatabase } from '../src/config/env.js';
import { createDatabase, createPool, DATABASE, type Database } from '../src/db/database.module.js';
import * as schema from '../src/db/schema.js';
import { StorageService } from '../src/storage/storage.service.js';
import { StorageFake } from './storage-fake.js';

export type Http = ReturnType<typeof request>;

export interface StartOptions {
  /** Replaces the settings `configureApp` reads from the environment. */
  settings?: Partial<AppSettings>;
  /** Test-only controllers and their providers, registered in the testing module. */
  controllers?: Type<unknown>[];
  providers?: Provider[];
  logger?: LoggerService;
  /** Further `overrideProvider` calls on the testing module. */
  override?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}

export interface TestApp {
  app: INestApplication;
  http: Http;
  /** The app's own Drizzle handle, on the test database. */
  db: Database;
  storage: StorageFake;
  close(): Promise<void>;
}

/** The API as `main.ts` configures it, on a random local port, with storage in memory. */
export async function startApp(options: StartOptions = {}): Promise<TestApp> {
  const storage = new StorageFake();
  let builder = Test.createTestingModule({
    imports: [AppModule],
    controllers: options.controllers ?? [],
    providers: options.providers ?? [],
  })
    .overrideProvider(StorageService)
    .useValue(storage);
  if (options.override) builder = options.override(builder);
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication();
  if (options.logger) app.useLogger(options.logger);
  configureApp(app, { ...appSettings(app.get(ConfigService<Env, true>)), ...options.settings });
  await app.listen(0, '127.0.0.1');

  return {
    app,
    http: request(app.getHttpServer()),
    db: app.get<Database>(DATABASE),
    storage,
    close: () => app.close(),
  };
}

/** A Drizzle handle on the test database for specs that need no app. */
export function openTestDatabase(): { db: Database; pool: Pool; close(): Promise<void> } {
  const pool = new Pool({ connectionString: testDatabase().url, max: 4 });
  return { db: createDatabase(pool, { schema }), pool, close: () => pool.end() };
}

/** A pool made by the API's own factory, on any database and of any size. */
export function productionPool(connectionString: string, poolSize: number): Pool {
  const settings: Pick<Env, 'DATABASE_URL' | 'DATABASE_POOL_SIZE'> = {
    DATABASE_URL: connectionString,
    DATABASE_POOL_SIZE: poolSize,
  };
  const config = { get: (key: keyof typeof settings) => settings[key] };
  return createPool(config as unknown as ConfigService<Env, true>);
}

/** Records every log line so a spec can check what the server wrote. */
export class RecordingLogger implements LoggerService {
  readonly lines: string[] = [];

  log(...parts: unknown[]) {
    this.record('log', parts);
  }
  error(...parts: unknown[]) {
    this.record('error', parts);
  }
  warn(...parts: unknown[]) {
    this.record('warn', parts);
  }
  debug(...parts: unknown[]) {
    this.record('debug', parts);
  }
  verbose(...parts: unknown[]) {
    this.record('verbose', parts);
  }
  fatal(...parts: unknown[]) {
    this.record('fatal', parts);
  }

  get text(): string {
    return this.lines.join('\n');
  }

  private record(level: string, parts: unknown[]) {
    const text = parts.map((part) =>
      part instanceof Error ? `${part.message}\n${part.stack ?? ''}` : typeof part === 'string' ? part : JSON.stringify(part),
    );
    this.lines.push(`${level} ${text.join(' ')}`);
  }
}
