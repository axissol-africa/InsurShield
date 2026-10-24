import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ClientBase } from 'pg';
import { MAX_NGWEE } from '../src/common/domain/money-limits.js';
import { readCatalog, type Catalog } from '../src/db/catalog.js';
import { CONVERTED_COLUMNS, migrateDatabase } from '../src/db/migrator.js';
import { buildPrismaEraDatabase } from './fixtures/prisma-era/prisma-era.js';
import {
  applyMigrationFiles,
  createScratchDatabase,
  drizzleKit,
  type ScratchDatabase,
} from './scratch-database.js';

const DRIZZLE = fileURLToPath(new URL('../drizzle/', import.meta.url));
const SCHEMA = fileURLToPath(new URL('../src/db/schema.ts', import.meta.url));
const LUSAKA = { options: '-c TimeZone=Africa/Lusaka' };

const created: ScratchDatabase[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((db) => db.drop()));
});

async function scratch(build?: (client: ClientBase) => Promise<unknown>): Promise<ScratchDatabase> {
  const db = await createScratchDatabase('schema');
  created.push(db);
  if (build) {
    const client = await db.connect();
    try {
      await build(client);
    } finally {
      await client.end();
    }
  }
  return db;
}

async function query<T>(db: ScratchDatabase, run: (client: ClientBase) => Promise<T>, extra = {}) {
  const client = await db.connect(extra);
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

const catalogOf = (db: ScratchDatabase) => query(db, readCatalog);

const asFile = (catalog: Catalog) => `${JSON.stringify(catalog, null, 2)}\n`;

async function pushed(): Promise<ScratchDatabase> {
  const db = await scratch();
  await drizzleKit(['push', '--force', '--config', 'drizzle.config.ts'], { databaseUrl: db.url });
  return db;
}

/** Every timestamp value in public, per column, as UTC wall-clock text. */
async function timestamps(client: ClientBase): Promise<Record<string, (string | null)[]>> {
  const { rows: columns } = await client.query<{ table: string; column: string; zoned: boolean }>(
    `SELECT table_name AS table, column_name AS column, data_type = 'timestamp with time zone' AS zoned
     FROM information_schema.columns
     WHERE table_schema = 'public' AND data_type LIKE 'timestamp%' AND table_name <> '_prisma_migrations'`,
  );
  const values: Record<string, (string | null)[]> = {};
  for (const { table, column, zoned } of columns) {
    const value = zoned ? `"${column}" AT TIME ZONE 'UTC'` : `"${column}"`;
    const { rows } = await client.query<{ values: (string | null)[] }>(
      `SELECT coalesce(array_agg(to_char(${value}, 'YYYY-MM-DD HH24:MI:SS.MS') ORDER BY ${value}), '{}') AS values
       FROM "${table}"`,
    );
    values[`${table}.${column}`] = rows[0].values;
  }
  return values;
}

// `vitest -u` does not rewrite these; REGENERATE_CATALOGS=1 does, on purpose only.
async function expectCatalogFile(catalog: Catalog, name: string) {
  const file = new URL(`../drizzle/catalog/${name}.json`, import.meta.url);
  if (process.env.REGENERATE_CATALOGS === '1') {
    await writeFile(file, asFile(catalog));
  }
  const committed = await readFile(file, 'utf8').catch(() => undefined);
  expect(committed, `drizzle/catalog/${name}.json is missing`).toBeDefined();
  expect(committed, `drizzle/catalog/${name}.json differs`).toBe(asFile(catalog));
}

describe('expected catalogs in drizzle/catalog', () => {
  it('prisma-era.json is what the six Prisma migrations build', async () => {
    const db = await scratch((client) => buildPrismaEraDatabase(client));
    await expectCatalogFile(await catalogOf(db), 'prisma-era');
  });

  it.each([
    [1, '0000_baseline'],
    [2, '0001_minor_units_timestamptz'],
  ])('the catalog after %i Drizzle migrations is %s.json', async (count, tag) => {
    const db = await scratch((client) => applyMigrationFiles(client, count));
    await expectCatalogFile(await catalogOf(db), tag);
  });

  it('the final catalog is what drizzle-kit push makes of src/db/schema.ts', async () => {
    const db = await pushed();
    await expectCatalogFile(await catalogOf(db), '0001_minor_units_timestamptz');
  });
});

describe('0000_baseline', () => {
  it('builds the same catalog as the six Prisma migrations', async () => {
    const prisma = await scratch((client) => buildPrismaEraDatabase(client));
    const baseline = await scratch((client) => applyMigrationFiles(client, 1));

    expect(await catalogOf(baseline)).toEqual(await catalogOf(prisma));
  });
});

describe('0001_minor_units_timestamptz', () => {
  it('converts money and rates exactly and keeps NULLs and every instant, in a Lusaka session', async () => {
    const db = await scratch((client) => buildPrismaEraDatabase(client, { data: true }));
    const before = await query(db, timestamps, LUSAKA);

    await migrateDatabase({ ...db.config, ...LUSAKA });

    await query(
      db,
      async (client) => {
        const values = async (sql: string) => (await client.query(sql)).rows;
        expect(await values(`SELECT id, "vehicleValueMinor"::text AS v FROM quote_requests ORDER BY id`)).toEqual([
          { id: 'QR-1', v: '12345678' },
          { id: 'QR-2', v: '99999999999999' },
          { id: 'QR-3', v: '0' },
        ]);
        expect(await values(`SELECT "premiumMinor"::text AS v FROM insurer_quotes ORDER BY id`)).toEqual([
          { v: '29' },
          { v: '100550' },
        ]);
        expect(await values(`SELECT "amountMinor"::text AS v FROM payments`)).toEqual([{ v: '29' }]);
        expect(await values(`SELECT "premiumMinor"::text AS v FROM policies`)).toEqual([{ v: '100550' }]);
        expect(
          await values(`SELECT "claimNumber" AS id, "estimatedLossMinor"::text AS v FROM claim_notifications ORDER BY 1`),
        ).toEqual([
          { id: 'CL-1', v: null },
          { id: 'CL-2', v: '1' },
        ]);
        expect(await values(`SELECT name, "rateBps" AS v FROM insurers ORDER BY name`)).toEqual([
          { name: 'Benefits Empty', v: 1 },
          { name: 'Benefits Listed', v: 10000 },
          { name: 'Benefits Null', v: 525 },
        ]);
        expect(await values(`SELECT "piaRateBps" AS v FROM pia_config`)).toEqual([{ v: 250 }]);
        expect(await values(`SELECT "updatedAt" AS v FROM quote_requests WHERE id = 'QR-1'`)).toEqual([
          { v: new Date('2026-03-31T22:30:00.123Z') },
        ]);
        const after = await timestamps(client);
        expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
        for (const [column, values] of Object.entries(before)) {
          expect(after[column], column).toEqual(values);
        }
      },
      LUSAKA,
    );
    expect(Object.keys(before)).toHaveLength(59);
    for (const [column, values] of Object.entries(before)) {
      expect(values.filter((value) => value !== null).length, column).toBeGreaterThan(0);
    }
  });

  it('keeps NULL timestamps NULL', async () => {
    const db = await scratch((client) => buildPrismaEraDatabase(client, { data: true }));
    const nulls = async (client: ClientBase) =>
      Object.fromEntries(
        Object.entries(await timestamps(client))
          .map(([column, values]): [string, number] => [column, values.filter((value) => value === null).length])
          .filter(([, count]) => count > 0),
      );
    const before = await query(db, nulls);

    await migrateDatabase({ ...db.config, ...LUSAKA });

    expect(Object.keys(before).length).toBeGreaterThanOrEqual(10);
    expect(await query(db, nulls)).toEqual(before);
  });

  it('removes every column a Prisma build reads money from, so such a build fails loudly', async () => {
    const db = await scratch((client) => buildPrismaEraDatabase(client, { data: true }));
    await migrateDatabase(db.config);

    await query(db, async (client) => {
      for (const { table, column } of CONVERTED_COLUMNS) {
        await expect(client.query(`SELECT "${column}" FROM "${table}"`), `${table}.${column}`).rejects.toMatchObject({
          code: '42703',
        });
      }
    });
  });
});

describe('drizzle-kit', () => {
  it('generate finds no difference between src/db/schema.ts and the migrations', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'insurshield-generate-'));
    try {
      await cp(DRIZZLE, join(dir, 'drizzle'), { recursive: true });
      await writeFile(
        join(dir, 'drizzle.config.mjs'),
        `export default ${JSON.stringify({ dialect: 'postgresql', schema: SCHEMA, out: './drizzle' })};\n`,
      );
      const output = await drizzleKit(['generate', '--config', 'drizzle.config.mjs'], { cwd: dir });

      expect(output).toContain('No schema changes');
      expect(await readdir(join(dir, 'drizzle'))).toEqual(await readdir(DRIZZLE));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('the final schema', () => {
  it('is the catalog drizzle-kit push makes, after a fresh install and after adopting a Prisma-era database', async () => {
    const expected = await catalogOf(await pushed());
    const fresh = await scratch();
    const adopted = await scratch((client) => buildPrismaEraDatabase(client, { data: true }));

    await migrateDatabase(fresh.config);
    await migrateDatabase(adopted.config);

    expect(await catalogOf(fresh)).toEqual(expected);
    expect(await catalogOf(adopted)).toEqual(expected);
  });

  it('stores every timestamp as timestamptz(3), money as bigint and rates as integer', async () => {
    const db = await scratch();
    await migrateDatabase(db.config);

    const columns = await query(db, async (client) => {
      const { rows } = await client.query<{ name: string; type: string; precision: number | null }>(
        `SELECT table_name || '.' || column_name AS name, data_type AS type, datetime_precision AS precision
         FROM information_schema.columns WHERE table_schema = 'public'`,
      );
      return rows;
    });
    const timestampColumns = columns.filter((column) => column.type.startsWith('timestamp'));
    expect(timestampColumns).toHaveLength(59);
    for (const column of timestampColumns) {
      expect(column, column.name).toMatchObject({ type: 'timestamp with time zone', precision: 3 });
    }
    expect(columns.filter((column) => column.type === 'numeric')).toEqual([]);
    for (const { table, renamedTo, max } of CONVERTED_COLUMNS) {
      const column = columns.find((candidate) => candidate.name === `${table}.${renamedTo}`);
      expect(column?.type, `${table}.${renamedTo}`).toBe(max === MAX_NGWEE ? 'bigint' : 'integer');
    }
  });

  it('refuses an amount or rate outside its bounds in every converted column', async () => {
    const db = await scratch((client) => buildPrismaEraDatabase(client, { data: true }));
    await migrateDatabase(db.config);

    await query(db, async (client) => {
      for (const { table, renamedTo, min, max } of CONVERTED_COLUMNS) {
        const set = (value: bigint) => client.query(`UPDATE "${table}" SET "${renamedTo}" = $1`, [value.toString()]);
        await expect(set(min - 1n), `${table}.${renamedTo} below`).rejects.toMatchObject({ code: '23514' });
        await expect(set(max + 1n), `${table}.${renamedTo} above`).rejects.toMatchObject({ code: '23514' });
        await expect(set(max)).resolves.toBeDefined();
      }
    });
  });
});
