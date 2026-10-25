import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { ClientBase } from 'pg';
import { PRISMA_MIGRATIONS } from '../../../src/db/migrator.js';

const PRISMA_ERA = new URL('../../../drizzle/prisma-era/', import.meta.url);
const FIXTURES = new URL('./', import.meta.url);

export { PRISMA_MIGRATIONS };

export function prismaMigrationSql(name: string): string {
  return readFileSync(new URL(`${name}/migration.sql`, PRISMA_ERA), 'utf8');
}

export function prismaChecksum(name: string): string {
  return createHash('sha256').update(readFileSync(new URL(`${name}/migration.sql`, PRISMA_ERA))).digest('hex');
}

export interface PrismaHistoryRow {
  name: string;
  checksum?: string;
  finished?: boolean;
  rolledBack?: boolean;
}

export const VALID_HISTORY: PrismaHistoryRow[] = PRISMA_MIGRATIONS.map((name) => ({ name }));

/** Runs the Prisma migration files in order, each as one script, as `prisma migrate deploy` does. */
export async function applyPrismaMigrations(client: ClientBase, names: readonly string[] = PRISMA_MIGRATIONS) {
  for (const name of names) {
    await client.query(prismaMigrationSql(name));
  }
}

export async function recordPrismaHistory(client: ClientBase, rows = VALID_HISTORY) {
  await client.query(readFileSync(new URL('prisma-migrations.sql', FIXTURES), 'utf8'));
  for (const row of rows) {
    await client.query(
      `INSERT INTO "_prisma_migrations"
         ("id", "checksum", "finished_at", "migration_name", "rolled_back_at", "started_at", "applied_steps_count")
       VALUES ($1, $2, CASE WHEN $3 THEN now() END, $4, CASE WHEN $5 THEN now() END, now(), $6)`,
      [
        randomUUID(),
        row.checksum ?? prismaChecksum(row.name),
        row.finished ?? true,
        row.name,
        row.rolledBack ?? false,
        (row.finished ?? true) ? 1 : 0,
      ],
    );
  }
}

export async function loadPrismaEraData(client: ClientBase) {
  await client.query(readFileSync(new URL('data.sql', FIXTURES), 'utf8'));
}

/** A database as a fully migrated Prisma build left it, optionally with the data fixture. */
export async function buildPrismaEraDatabase(client: ClientBase, { data = false } = {}) {
  await applyPrismaMigrations(client);
  await recordPrismaHistory(client);
  if (data) {
    await loadPrismaEraData(client);
  }
}
