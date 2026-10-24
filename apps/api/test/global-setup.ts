import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, type ClientConfig } from 'pg';
import { parseIntoClientConfig } from 'pg-connection-string';
import type { TestProject } from 'vitest/node';
import { TEST_DATABASE_SUFFIX, testDatabase } from '../src/config/env.js';
import { migrateDatabase } from '../src/db/migrator.js';
import { startJwksServer } from './jwks.js';

const API_ROOT = fileURLToPath(new URL('../', import.meta.url));
const BUILD_COMMAND = 'npm run build -w @insurshield/api';

export default async function setup(project: TestProject) {
  assertCurrentBuild();
  const test = testDatabase();
  // The migrator needs the catalogs being regenerated; the schema spec migrates only its own scratch databases.
  const migrate = process.env.REGENERATE_CATALOGS !== '1';
  await resetTestDatabase(parseIntoClientConfig(test.url), test.name, { migrate });

  const jwks = await startJwksServer();
  // Spec workers start after this and inherit it, so the app's verifier fetches this run's key.
  process.env.KEYCLOAK_ISSUER = jwks.issuer;
  project.provide('jwks', { issuer: jwks.issuer, signingKey: jwks.signingKey });
  return () => jwks.close();
}

// Specs run the built migration entry point, so a build older than any source would test old code.
export function assertCurrentBuild(apiRoot = API_ROOT) {
  const built = statSync(join(apiRoot, 'dist', 'db', 'migrate.js'), { throwIfNoEntry: false });
  if (!built) {
    throw new Error(`There is no API build: run ${BUILD_COMMAND} before the e2e suite`);
  }
  const sources = join(apiRoot, 'src');
  const stale = readdirSync(sources, { recursive: true, withFileTypes: true }).find(
    (entry) =>
      entry.isFile() &&
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts') &&
      statSync(join(entry.parentPath, entry.name)).mtimeMs > built.mtimeMs,
  );
  if (stale) {
    throw new Error(`The API build is older than src/: run ${BUILD_COMMAND} before the e2e suite`);
  }
}

/** Empties the test database and migrates it, after checking the server opened that database. */
export async function resetTestDatabase(config: ClientConfig, expectedName: string, { migrate = true } = {}) {
  if (!expectedName.endsWith(TEST_DATABASE_SUFFIX)) {
    throw new Error(`Refusing to reset: the database name must end in ${TEST_DATABASE_SUFFIX}`);
  }
  const client = new Client(config);
  await client.connect();
  try {
    // Ask the server which database it opened, because a pooler alias can disguise it.
    const { rows } = await client.query<{ name: string }>('SELECT pg_catalog.current_database() AS name');
    if (rows[0].name !== expectedName) {
      throw new Error('Refusing to reset: the server opened a different database than TEST_DATABASE_URL names');
    }
    await client.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }
  if (migrate) {
    await migrateDatabase(config);
  }
}
