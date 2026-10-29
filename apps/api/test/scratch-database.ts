import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { Client, escapeIdentifier, type ClientBase, type ClientConfig } from 'pg';
import { parseIntoClientConfig } from 'pg-connection-string';
import { MAX_DATABASE_NAME_BYTES, TEST_DATABASE_SUFFIX, testDatabase } from '../src/config/env.js';
import { readCatalog } from '../src/db/catalog.js';

const API_ROOT = fileURLToPath(new URL('../', import.meta.url));
const DRIZZLE_KIT = join(dirname(createRequire(import.meta.url).resolve('drizzle-kit')), 'bin.cjs');
export const DRIZZLE_FOLDER = fileURLToPath(new URL('../drizzle/', import.meta.url));

export interface ScratchDatabase {
  name: string;
  config: ClientConfig;
  url: string;
  connect(extra?: Partial<ClientConfig>): Promise<Client>;
  drop(): Promise<void>;
}

// The validated TEST_DATABASE_URL, whose parameters cannot name another host, role or database.
export function scratchClientConfig(database: string): ClientConfig {
  return { ...parseIntoClientConfig(testDatabase().url), database };
}

// Asks the server which database it opened, because a pooler alias can disguise it.
async function assertOpened(client: Client, name: string) {
  const { rows } = await client.query<{ name: string }>(
    'SELECT pg_catalog.current_database() AS name',
  );
  if (rows[0].name !== name) {
    throw new Error('Refusing to continue: the server opened a different database than expected');
  }
}

/**
 * Creates `<test database base>_<spec>_<n>_test` on the test server, so a migration spec
 * never touches the shared e2e database. Only names ending in `_test` are created or dropped.
 */
export async function createScratchDatabase(spec: string): Promise<ScratchDatabase> {
  const test = testDatabase();
  const base = test.name.slice(0, -TEST_DATABASE_SUFFIX.length);
  const name = `${base}_${spec}_${randomBytes(4).toString('hex')}${TEST_DATABASE_SUFFIX}`;
  if (!/^[a-z0-9_]+$/.test(spec) || Buffer.byteLength(name) > MAX_DATABASE_NAME_BYTES) {
    throw new Error('A scratch database name must be short lowercase letters, digits and _');
  }
  const admin = new Client(scratchClientConfig(test.name));
  await admin.connect();
  try {
    await assertOpened(admin, test.name);
    await admin.query(`CREATE DATABASE ${escapeIdentifier(name)}`);
  } finally {
    await admin.end();
  }

  const config = scratchClientConfig(name);
  const url = new URL(test.url);
  url.pathname = `/${encodeURIComponent(name)}`;

  return {
    name,
    config,
    url: url.toString(),
    async connect(extra = {}) {
      const client = new Client({ ...config, ...extra });
      await client.connect();
      await assertOpened(client, name);
      return client;
    },
    async drop() {
      const client = new Client(scratchClientConfig(test.name));
      await client.connect();
      try {
        await assertOpened(client, test.name);
        await client.query(`DROP DATABASE IF EXISTS ${escapeIdentifier(name)} WITH (FORCE)`);
      } finally {
        await client.end();
      }
    },
  };
}

/** The expected catalog file of a migration tag, or of `prisma-era`. */
export function catalogPath(tag: string): string {
  return join(DRIZZLE_FOLDER, 'catalog', `${tag}.json`);
}

/** The tags of the Drizzle migrations in drizzle/meta/_journal.json, oldest first. */
export function migrationTags(): string[] {
  const journal = JSON.parse(readFileSync(join(DRIZZLE_FOLDER, 'meta', '_journal.json'), 'utf8')) as {
    entries: { tag: string }[];
  };
  return journal.entries.map((entry) => entry.tag);
}

/** The names, without .sql, of the SQL files at the top of drizzle/, in name order. */
export function migrationFileTags(): string[] {
  return readdirSync(DRIZZLE_FOLDER)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => name.slice(0, -'.sql'.length))
    .sort();
}

/** Runs the statements of the first `count` Drizzle migrations directly, recording no history. */
export async function applyMigrationFiles(client: ClientBase, count?: number) {
  const migrations = readMigrationFiles({ migrationsFolder: DRIZZLE_FOLDER });
  for (const migration of migrations.slice(0, count)) {
    for (const statement of migration.sql) {
      await client.query(statement);
    }
  }
}

/** Runs the drizzle-kit CLI and returns its output; DATABASE_URL points it at one database. */
export async function drizzleKit(
  args: string[],
  { cwd = API_ROOT, databaseUrl }: { cwd?: string; databaseUrl?: string } = {},
): Promise<string> {
  const env = { ...process.env, ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}) };
  const { stdout, stderr } = await promisify(execFile)(process.execPath, [DRIZZLE_KIT, ...args], {
    cwd,
    env,
  });
  return `${stdout}${stderr}`;
}

/** Records the first `count` Drizzle migrations as applied, as an older db:migrate run left them. */
export async function recordDrizzleHistory(client: ClientBase, count: number) {
  const migrations = readMigrationFiles({ migrationsFolder: DRIZZLE_FOLDER });
  await client.query('CREATE SCHEMA IF NOT EXISTS drizzle');
  await client.query(
    'CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)',
  );
  for (const migration of migrations.slice(0, count)) {
    await client.query('INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)', [
      migration.hash,
      migration.folderMillis,
    ]);
  }
}

/**
 * Everything a refused run must leave as it was: the catalog of public, the schemas,
 * every relation outside the system schemas and the rows of every table.
 */
export async function databaseState(client: ClientBase): Promise<string[]> {
  const { rows: tables } = await client.query<{ schema: string; name: string; kind: string }>(
    `SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind
     FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%'
     ORDER BY 1, 2`,
  );
  const { rows: schemas } = await client.query<{ name: string }>(
    `SELECT nspname AS name FROM pg_catalog.pg_namespace
     WHERE nspname NOT IN ('pg_catalog', 'information_schema') AND nspname NOT LIKE 'pg_t%' ORDER BY 1`,
  );
  const state = [...(await readCatalog(client)), ...schemas.map((schema) => `schema ${schema.name}`)];
  for (const table of tables) {
    state.push(`relation ${table.schema}.${table.name} ${table.kind}`);
    if (table.kind === 'r') {
      const qualified = `${escapeIdentifier(table.schema)}.${escapeIdentifier(table.name)}`;
      const { rows } = await client.query<{ rows: string }>(
        `SELECT coalesce(string_agg(t::text, E'\\n' ORDER BY t::text), '') AS rows FROM ${qualified} t`,
      );
      state.push(`rows ${table.schema}.${table.name} ${rows[0].rows}`);
    }
  }
  return state;
}
