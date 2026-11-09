import { createHash } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, type ClientConfig } from 'pg';
import { parseIntoClientConfig } from 'pg-connection-string';
import { TEST_DATABASE_SUFFIX, testDatabase } from '../src/config/env.js';
import { migrateDatabase } from '../src/db/migrator.js';

const API_ROOT = fileURLToPath(new URL('../', import.meta.url));
const BUILD_COMMAND = 'npm run build -w @insurshield/api';

export default async function setup() {
  assertCatalogRegenerationAllowed(process.env);
  assertCurrentBuild();
  const test = testDatabase();
  const config = parseIntoClientConfig(test.url);
  // Taken before anything is dropped, and held until the run ends.
  const release = await claimTestDatabase(config, test.name);
  try {
    // The migrator needs the catalogs being regenerated; the schema spec migrates only its own scratch databases.
    const migrate = process.env.REGENERATE_CATALOGS !== '1';
    await resetTestDatabase(config, test.name, { migrate });
  } catch (error) {
    await release();
    throw error;
  }

  // Spec workers start after this and inherit these. Specs that test the limiter or proxies build
  // their app with `startApp({ env })`.
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.API_RATE_LIMIT = 'off';
  process.env.TRUST_PROXY_HOPS = '0';

  return release;
}

/**
 * Claims the test database for this run, and refuses to start when another run
 * already holds it.
 *
 * Setup drops and recreates the public schema, so two runs sharing a database
 * destroy each other: one wipes the schema while the other is mid-spec, and the
 * failures that follow look like defects in whatever each run was testing. The
 * lock is held on its own connection for the whole run and goes away with the
 * connection, so a killed run leaves nothing behind to clear by hand.
 */
export async function claimTestDatabase(config: ClientConfig, name: string): Promise<() => Promise<void>> {
  const client = new Client(config);
  await client.connect();
  try {
    const { rows } = await client.query<{ claimed: boolean }>(
      'SELECT pg_catalog.pg_try_advisory_lock($1) AS claimed',
      [lockKey(name)],
    );
    if (!rows[0].claimed) {
      throw new Error(
        `Another e2e run is using ${name}. Wait for it to finish, or give this run its own ` +
          'database by pointing TEST_DATABASE_URL at a different name ending in _test.',
      );
    }
  } catch (error) {
    await client.end();
    throw error;
  }
  return async () => {
    // Ending the connection drops the lock; the unlock is for a clear log.
    await client.query('SELECT pg_catalog.pg_advisory_unlock($1)', [lockKey(name)]).catch(() => undefined);
    await client.end().catch(() => undefined);
  };
}

/** A stable 64-bit key from the database name, so different databases never block each other. */
function lockKey(name: string): string {
  return BigInt.asIntN(64, BigInt(`0x${createHash('sha256').update(name).digest('hex').slice(0, 16)}`)).toString();
}

// A CI run that rewrote a drifted catalog would pass instead of failing on the drift.
export function assertCatalogRegenerationAllowed(env: NodeJS.ProcessEnv) {
  if (env.CI && env.REGENERATE_CATALOGS === '1') {
    throw new Error('REGENERATE_CATALOGS=1 is not allowed when CI is set: unset one of them');
  }
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
      // Equal timestamps cannot prove that the build contains the source on
      // filesystems with coarse timestamp resolution, so fail safely and
      // require a fresh build in that case too.
      statSync(join(entry.parentPath, entry.name)).mtimeMs >= built.mtimeMs,
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
