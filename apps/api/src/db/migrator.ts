import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { Client, escapeIdentifier, type ClientBase, type ClientConfig } from 'pg';
import { MAX_NGWEE, MAX_RATE_BPS, MIN_NGWEE, MIN_RATE_BPS } from '../common/domain/money-limits.js';
import { databaseUrl, loadEnvFile } from '../config/env.js';
import {
  catalogDifferences,
  readCatalog,
  sameCatalog,
  type Catalog,
  type CatalogDifference,
} from './catalog.js';
import { describeDatabaseError, DRIVER_CODE, serverError } from './errors.js';

/**
 * The only way migrations are applied: `src/db/migrate.ts` runs it for `npm run db:migrate`,
 * the migrator image and the e2e setup. It recognises the database from three independent
 * facts, applies what is missing in one transaction on one connection, and refuses any
 * state it does not know.
 * It does not use Drizzle's migrate(), which creates its table outside the transaction
 * and skips by timestamp alone.
 */

const MIGRATIONS = fileURLToPath(new URL('../../drizzle/', import.meta.url));

// Expected catalogs are made on the Compose version; another major version deparses differently.
const POSTGRES_MAJOR = 17;
const LOCK_KEY = 'insurshield db:migrate';
const DDL_LOCK_TIMEOUT = '60s';
const CONVERSION_TAG = '0001_minor_units_timestamptz';
const MAX_LISTED_DIFFERENCES = 10;
const MAX_LISTED_LENGTH = 200;

// Drizzle's own statement (drizzle-orm pg-core dialect), so drizzle-kit reads the same table.
const DRIZZLE_HISTORY_TABLE = `
			CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
				id SERIAL PRIMARY KEY,
				hash text NOT NULL,
				created_at bigint
			)
		`;

/** The Prisma migrations a Prisma-era database must record, as `drizzle/prisma-era/` holds them. */
export const PRISMA_MIGRATIONS = [
  '20260924065735_init',
  '20260924090904_insurer_registration_details',
  '20260924115721_keycloak_identity',
  '20260924120514_park_phone_verification',
  '20260925_policy_renewal',
  '20261002_vehicle_registration_country',
] as const;

/** The columns 0001 converts, with the bounds of the CHECK it adds, in stored units. */
export const CONVERTED_COLUMNS = [
  { table: 'quote_requests', column: 'vehicleValue', renamedTo: 'vehicleValueMinor', min: MIN_NGWEE, max: MAX_NGWEE },
  { table: 'insurer_quotes', column: 'premium', renamedTo: 'premiumMinor', min: MIN_NGWEE, max: MAX_NGWEE },
  { table: 'payments', column: 'amount', renamedTo: 'amountMinor', min: MIN_NGWEE, max: MAX_NGWEE },
  { table: 'policies', column: 'premium', renamedTo: 'premiumMinor', min: MIN_NGWEE, max: MAX_NGWEE },
  { table: 'claim_notifications', column: 'estimatedLoss', renamedTo: 'estimatedLossMinor', min: MIN_NGWEE, max: MAX_NGWEE },
  { table: 'insurers', column: 'ratePercentage', renamedTo: 'rateBps', min: BigInt(MIN_RATE_BPS), max: BigInt(MAX_RATE_BPS) },
  { table: 'pia_config', column: 'piaRatePercentage', renamedTo: 'piaRateBps', min: BigInt(MIN_RATE_BPS), max: BigInt(MAX_RATE_BPS) },
] as const;

export class MigrationRefusedError extends Error {
  override name = 'MigrationRefusedError';
}

export type MigrationStep =
  | { name: 'created-drizzle-schema' }
  | { name: 'moved-prisma-history' }
  | { name: 'applied-statement'; tag: string; index: number }
  | { name: 'recorded-migration'; tag: string }
  | { name: 'final-check' };

export interface MigrateOptions {
  /** Called after each step of the applying sequence; tests use it to inject failures. */
  onStep?: (step: MigrationStep, client: ClientBase) => Promise<void> | void;
  /** The folder holding the migrations, `drizzle/` beside the build by default. */
  migrationsFolder?: string;
}

export interface MigrationResult {
  state: 'fresh' | 'managed' | 'prisma-era';
  applied: string[];
}

interface Migration {
  tag: string;
  statements: string[];
  hash: string;
  folderMillis: number;
}

interface Plan {
  migrations: Migration[];
  prismaChecksums: Map<string, Set<string>>;
  prismaCatalog: Catalog;
  catalogsAfter: Catalog[];
}

type PrismaHistory = { state: 'absent' } | { state: 'valid' } | { state: 'invalid'; reason: string };
type DrizzleHistory =
  | { state: 'none' }
  | { state: 'prefix'; applied: number }
  | { state: 'invalid'; reason: string };

interface Facts {
  prisma: PrismaHistory;
  drizzle: DrizzleHistory;
  archived: boolean;
  catalog: Catalog;
}

function loadPlan(folder: string): Plan {
  const journal = JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')) as {
    entries: { tag: string }[];
  };
  const files = readMigrationFiles({ migrationsFolder: folder });
  const migrations = files.map((file, index) => ({
    tag: journal.entries[index].tag,
    statements: file.sql.filter((statement) => statement.trim() !== ''),
    hash: file.hash,
    folderMillis: file.folderMillis,
  }));

  const prismaChecksums = new Map<string, Set<string>>();
  for (const name of PRISMA_MIGRATIONS) {
    const lf = readFileSync(join(folder, 'prisma-era', name, 'migration.sql'), 'utf8').replace(/\r\n/g, '\n');
    const sha = (text: string) => createHash('sha256').update(text).digest('hex');
    prismaChecksums.set(name, new Set([sha(lf), sha(lf.replace(/\n/g, '\r\n'))]));
  }

  return {
    migrations,
    prismaChecksums,
    prismaCatalog: expectedCatalog(folder, 'prisma-era'),
    catalogsAfter: migrations.map((migration) => expectedCatalog(folder, migration.tag)),
  };
}

function expectedCatalog(folder: string, name: string): Catalog {
  return JSON.parse(readFileSync(join(folder, 'catalog', `${name}.json`), 'utf8')) as Catalog;
}

async function columnsOf(client: ClientBase, table: string): Promise<Set<string>> {
  const { rows } = await client.query<{ name: string }>(
    `SELECT a.attname AS name FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = pg_catalog.to_regclass($1) AND a.attnum > 0 AND NOT a.attisdropped`,
    [table],
  );
  return new Set(rows.map((row) => row.name));
}

async function readPrismaHistory(client: ClientBase, plan: Plan): Promise<PrismaHistory> {
  const columns = await columnsOf(client, 'public._prisma_migrations');
  if (columns.size === 0) {
    const { rows } = await client.query<{ exists: boolean }>(
      `SELECT pg_catalog.to_regclass('public._prisma_migrations') IS NOT NULL AS exists`,
    );
    return rows[0].exists ? { state: 'invalid', reason: 'the table has no columns' } : { state: 'absent' };
  }
  if (!['migration_name', 'checksum', 'finished_at', 'rolled_back_at'].every((name) => columns.has(name))) {
    return { state: 'invalid', reason: 'the table is not the one Prisma creates' };
  }
  const { rows } = await client.query<{
    name: string;
    checksum: string;
    finished: boolean;
    rolled_back: boolean;
  }>(
    `SELECT migration_name::text AS name, checksum::text AS checksum,
            finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back
     FROM public._prisma_migrations`,
  );
  const finished = new Map<string, string[]>();
  for (const row of rows) {
    if (row.rolled_back) continue;
    if (!row.finished) {
      return { state: 'invalid', reason: 'a migration failed or did not finish' };
    }
    if (!plan.prismaChecksums.has(row.name)) {
      return { state: 'invalid', reason: 'a row names an unknown migration' };
    }
    finished.set(row.name, [...(finished.get(row.name) ?? []), row.checksum]);
  }
  for (const [name, checksums] of plan.prismaChecksums) {
    const recorded = finished.get(name) ?? [];
    if (recorded.length === 0) {
      return { state: 'invalid', reason: `${name} is not recorded as applied` };
    }
    if (recorded.length > 1) {
      return { state: 'invalid', reason: `${name} is recorded more than once` };
    }
    if (!checksums.has(recorded[0])) {
      return { state: 'invalid', reason: `${name} was altered` };
    }
  }
  return { state: 'valid' };
}

async function readDrizzleHistory(client: ClientBase, plan: Plan): Promise<DrizzleHistory> {
  const columns = await columnsOf(client, 'drizzle.__drizzle_migrations');
  if (columns.size === 0) {
    return { state: 'none' };
  }
  if (!['id', 'hash', 'created_at'].every((name) => columns.has(name))) {
    return { state: 'invalid', reason: 'the table is not the one Drizzle creates' };
  }
  const { rows } = await client.query<{ hash: string; created_at: string | null }>(
    `SELECT hash::text AS hash, created_at::text AS created_at
     FROM drizzle.__drizzle_migrations ORDER BY id`,
  );
  if (rows.length === 0) {
    return { state: 'none' };
  }
  if (rows.length > plan.migrations.length) {
    return { state: 'invalid', reason: 'it records more migrations than drizzle/ holds' };
  }
  for (const [index, row] of rows.entries()) {
    const migration = plan.migrations[index];
    if (row.hash !== migration.hash) {
      return { state: 'invalid', reason: `row ${index + 1} is not ${migration.tag}` };
    }
    if (row.created_at !== String(migration.folderMillis)) {
      return { state: 'invalid', reason: `row ${index + 1} has an altered created_at` };
    }
  }
  return { state: 'prefix', applied: rows.length };
}

async function readFacts(client: ClientBase, plan: Plan): Promise<Facts> {
  const archive = await client.query<{ exists: boolean }>(
    `SELECT pg_catalog.to_regclass('drizzle.prisma_migrations_archive') IS NOT NULL AS exists`,
  );
  return {
    prisma: await readPrismaHistory(client, plan),
    drizzle: await readDrizzleHistory(client, plan),
    archived: archive.rows[0].exists,
    catalog: await readCatalog(client),
  };
}

function describePrisma(history: PrismaHistory): string {
  return history.state === 'invalid' ? `invalid (${history.reason})` : history.state;
}

function describeDrizzle(history: DrizzleHistory, plan: Plan): string {
  if (history.state === 'prefix') {
    return `${history.applied} of ${plan.migrations.length} migrations applied`;
  }
  return history.state === 'invalid' ? `invalid (${history.reason})` : 'none';
}

function describeCatalog(catalog: Catalog, plan: Plan): string {
  if (catalog.length === 0) {
    return 'empty';
  }
  const candidates: [string, Catalog][] = [
    ['the Prisma schema', plan.prismaCatalog],
    ...plan.migrations.map((migration, index): [string, Catalog] => [
      `the schema after ${migration.tag}`,
      plan.catalogsAfter[index],
    ]),
  ];
  const matching = candidates.filter(([, expected]) => sameCatalog(catalog, expected));
  if (matching.length > 0) {
    return matching.map(([label]) => label).join(' and ');
  }
  const [label, differences] = [...candidates, ['an empty public', []] as [string, Catalog]]
    .map(([candidate, expected]): [string, CatalogDifference[]] => [candidate, catalogDifferences(catalog, expected)])
    .reduce((best, next) => (next[1].length < best[1].length ? next : best));
  // Objects first: one extra object can bring many definition records with it.
  const rank = ({ status, identity }: CatalogDifference) =>
    (/^(object|outside dependant) /.test(identity) ? 0 : 2) + (status === 'missing' ? 1 : 0);
  const listed = [...differences]
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, MAX_LISTED_DIFFERENCES)
    .map(({ status, identity }) => `\n    ${status} ${identity.slice(0, MAX_LISTED_LENGTH)}`)
    .join('');
  return `matches no expected schema; closest is ${label}, with ${differences.length} differences:${listed}`;
}

function refuse(facts: Facts, plan: Plan): never {
  throw new MigrationRefusedError(
    'Refusing to migrate: the database is in no state db:migrate accepts, and nothing was changed.\n' +
      `  Prisma history: ${describePrisma(facts.prisma)}\n` +
      `  Drizzle history: ${describeDrizzle(facts.drizzle, plan)}` +
      (facts.archived ? ', with drizzle.prisma_migrations_archive present' : '') +
      `\n  Catalog of public: ${describeCatalog(facts.catalog, plan)}`,
  );
}

type Decision = { state: MigrationResult['state']; from: number };

function decide(facts: Facts, plan: Plan): Decision {
  const { prisma, drizzle, archived, catalog } = facts;
  if (prisma.state === 'absent' && drizzle.state === 'none' && !archived && catalog.length === 0) {
    return { state: 'fresh', from: 0 };
  }
  if (
    prisma.state === 'absent' &&
    drizzle.state === 'prefix' &&
    sameCatalog(catalog, plan.catalogsAfter[drizzle.applied - 1])
  ) {
    return { state: 'managed', from: drizzle.applied };
  }
  if (
    prisma.state === 'valid' &&
    drizzle.state === 'none' &&
    !archived &&
    sameCatalog(catalog, plan.prismaCatalog)
  ) {
    return { state: 'prisma-era', from: 1 };
  }
  return refuse(facts, plan);
}

/** Counts, on the converted value, the rows that would break each new CHECK. */
async function refuseBreakingRows(client: ClientBase) {
  const failing: string[] = [];
  for (const { table, column, min, max } of CONVERTED_COLUMNS) {
    const name = escapeIdentifier(column);
    const { rows } = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM ${escapeIdentifier(table)}
       WHERE ${name} = 'NaN' OR round(${name} * 100) < $1::numeric OR round(${name} * 100) > $2::numeric`,
      [min.toString(), max.toString()],
    );
    if (rows[0].count > 0) {
      failing.push(`${table}."${column}" (${rows[0].count} ${rows[0].count === 1 ? 'row' : 'rows'})`);
    }
  }
  if (failing.length > 0) {
    throw new MigrationRefusedError(
      `Refusing to migrate: rows break the constraints ${CONVERSION_TAG} adds, and nothing was changed. ` +
        `Correct them and run again: ${failing.join(', ')}.`,
    );
  }
}

async function record(client: ClientBase, migration: Migration) {
  await client.query(`INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ($1, $2)`, [
    migration.hash,
    migration.folderMillis,
  ]);
}

async function apply(client: ClientBase, plan: Plan, options: MigrateOptions): Promise<MigrationResult> {
  const step = async (current: MigrationStep) => options.onStep?.(current, client);
  const decision = decide(await readFacts(client, plan), plan);
  const pending = plan.migrations.slice(decision.from);

  if (decision.state === 'fresh') {
    await client.query('CREATE SCHEMA IF NOT EXISTS public');
  }
  await client.query('SET LOCAL search_path TO public');
  if (decision.state === 'prisma-era' || pending.length > 0) {
    await client.query('CREATE SCHEMA IF NOT EXISTS "drizzle"');
    await client.query(DRIZZLE_HISTORY_TABLE);
    await step({ name: 'created-drizzle-schema' });
  }
  if (decision.state === 'prisma-era') {
    await client.query('ALTER TABLE public._prisma_migrations RENAME TO prisma_migrations_archive');
    await client.query('ALTER TABLE public.prisma_migrations_archive SET SCHEMA "drizzle"');
    await step({ name: 'moved-prisma-history' });
    await record(client, plan.migrations[0]);
    await step({ name: 'recorded-migration', tag: plan.migrations[0].tag });
  }
  for (const migration of pending) {
    if (migration.tag === CONVERSION_TAG) {
      await refuseBreakingRows(client);
    }
    for (const [index, statement] of migration.statements.entries()) {
      await client.query(statement);
      await step({ name: 'applied-statement', tag: migration.tag, index });
    }
    await record(client, migration);
    await step({ name: 'recorded-migration', tag: migration.tag });
  }

  await step({ name: 'final-check' });
  const after = await readFacts(client, plan);
  const final = plan.catalogsAfter[plan.migrations.length - 1];
  if (
    after.prisma.state !== 'absent' ||
    after.drizzle.state !== 'prefix' ||
    after.drizzle.applied !== plan.migrations.length ||
    !sameCatalog(after.catalog, final)
  ) {
    throw new MigrationRefusedError(
      'Refusing to commit: after applying, the database is not in the final state, so everything was rolled back.\n' +
        `  Prisma history: ${describePrisma(after.prisma)}\n` +
        `  Drizzle history: ${describeDrizzle(after.drizzle, plan)}\n` +
        `  Catalog of public: ${describeCatalog(after.catalog, plan)}`,
    );
  }
  return { state: decision.state, applied: pending.map((migration) => migration.tag) };
}

export async function migrateDatabase(
  config: ClientConfig,
  options: MigrateOptions = {},
): Promise<MigrationResult> {
  const plan = loadPlan(options.migrationsFolder ?? MIGRATIONS);
  const client = new Client(config);
  // A connection lost between statements fails the next one, which reports it; unheard, the event ends the process.
  client.on('error', () => undefined);
  await client.connect();
  try {
    const version = await client.query<{ major: number }>(
      `SELECT pg_catalog.current_setting('server_version_num')::int / 10000 AS major`,
    );
    if (version.rows[0].major !== POSTGRES_MAJOR) {
      throw new MigrationRefusedError(
        `Refusing to migrate: PostgreSQL ${POSTGRES_MAJOR} is required, and the server runs ${version.rows[0].major}.`,
      );
    }
    // Waiting for another run is unbounded; once it holds the lock, DDL waits at most a minute.
    await client.query('SET statement_timeout = 0');
    await client.query('SET transaction_timeout = 0');
    await client.query('SET lock_timeout = 0');
    await client.query('SELECT pg_catalog.pg_advisory_lock(pg_catalog.hashtextextended($1, 0))', [LOCK_KEY]);
    await client.query(`SET lock_timeout = '${DDL_LOCK_TIMEOUT}'`);

    await client.query('BEGIN');
    let result: MigrationResult;
    try {
      result = await apply(client, plan, options);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
    await client.query('COMMIT');
    return result;
  } finally {
    // Ending the session also releases the advisory lock.
    await client.end();
  }
}

function describeResult(result: MigrationResult): string {
  const applied = result.applied.length > 0 ? `applied ${result.applied.join(', ')}` : 'nothing to apply';
  const state = { fresh: 'empty database', managed: 'Drizzle-managed database', 'prisma-era': 'Prisma-era database, adopted' };
  return `db:migrate: ${state[result.state]}; ${applied}.`;
}

const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

const TLS_ERROR_CODE = /^ERR_(TLS|SSL)_|CERT|^UNABLE_TO_|^(INVALID_CA|HOSTNAME_MISMATCH)$/;
// node-postgres's fixed message when the server answers a TLS request with no.
const NO_TLS_MESSAGE = 'The server does not support SSL connections';

// Driver messages carry hosts, roles, database names and parameter values, so only these are printed.
export function failureReason(error: unknown): string {
  const code = serverError(error)?.code;
  if (code?.startsWith('28')) return 'authentication failed';
  if (code === '3D000') return 'the database does not exist';
  if (code?.startsWith('08') || code === '57P03') return 'could not connect to the server';
  if (code) return 'a statement failed';
  if (error instanceof Error && error.message === NO_TLS_MESSAGE) return 'TLS failed: the server does not offer TLS';
  const nodeCode = error instanceof Error ? (error as Error & { code?: unknown }).code : undefined;
  if (typeof nodeCode !== 'string' || !DRIVER_CODE.test(nodeCode)) return 'an unexpected error';
  if (CONNECTION_ERROR_CODES.has(nodeCode)) return `could not connect to the server (${nodeCode})`;
  if (TLS_ERROR_CODE.test(nodeCode)) return `TLS failed (${nodeCode})`;
  return `an unexpected error (${nodeCode})`;
}

export function failureDetails(error: unknown): { code?: string; constraint?: string } {
  const server = serverError(error);
  return server ? describeDatabaseError(server) : {};
}

/** Runs db:migrate as the command does and returns its exit code. */
export async function main(): Promise<number> {
  loadEnvFile();
  let url: string;
  try {
    url = databaseUrl();
  } catch (error) {
    // Configuration messages name the variable and the rule, never the value.
    console.error((error as Error).message);
    return 1;
  }
  try {
    console.log(describeResult(await migrateDatabase({ connectionString: url })));
    return 0;
  } catch (error) {
    if (error instanceof MigrationRefusedError) {
      console.error(error.message);
    } else {
      const details = failureDetails(error);
      console.error(`db:migrate failed: ${failureReason(error)}`, ...(details.code ? [details] : []));
    }
    return 1;
  }
}
