import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { ClientBase } from 'pg';
import { readCatalog } from '../src/db/catalog.js';
import { MigrationRefusedError, migrateDatabase } from '../src/db/migrator.js';
import {
  applyPrismaMigrations,
  buildPrismaEraDatabase,
  PRISMA_MIGRATIONS,
  prismaMigrationSql,
  recordPrismaHistory,
  VALID_HISTORY,
} from './fixtures/prisma-era/prisma-era.js';
import {
  applyMigrationFiles,
  createScratchDatabase,
  databaseState,
  recordDrizzleHistory,
  type ScratchDatabase,
} from './scratch-database.js';

type Build = (client: ClientBase) => Promise<unknown>;

const FINAL_CATALOG = JSON.parse(
  readFileSync(new URL('../drizzle/catalog/0001_minor_units_timestamptz.json', import.meta.url), 'utf8'),
) as string[];

const created: ScratchDatabase[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((db) => db.drop()));
});

async function scratch(build: Build): Promise<ScratchDatabase> {
  const db = await createScratchDatabase('refuse');
  created.push(db);
  const client = await db.connect();
  try {
    await build(client);
  } finally {
    await client.end();
  }
  return db;
}

async function stateOf(db: ScratchDatabase) {
  const client = await db.connect();
  try {
    return await databaseState(client);
  } finally {
    await client.end();
  }
}

async function expectRefused(build: Build, message: RegExp): Promise<ScratchDatabase> {
  const db = await scratch(build);
  const before = await stateOf(db);

  const run = migrateDatabase(db.config);

  await expect(run).rejects.toThrow(MigrationRefusedError);
  await expect(run).rejects.toThrow(message);
  expect(await stateOf(db)).toEqual(before);
  return db;
}

async function catalogOf(db: ScratchDatabase) {
  const client = await db.connect();
  try {
    return await readCatalog(client);
  } finally {
    await client.end();
  }
}

const prismaEra: Build = (client) => buildPrismaEraDatabase(client);
const managed: Build = async (client) => {
  await applyMigrationFiles(client);
  await recordDrizzleHistory(client, 2);
};
const then =
  (base: Build, ...statements: string[]): Build =>
  async (client) => {
    await base(client);
    for (const statement of statements) {
      await client.query(statement);
    }
  };
const LAST = PRISMA_MIGRATIONS[PRISMA_MIGRATIONS.length - 1];
const FIRST = PRISMA_MIGRATIONS[0];
const withHistory = (rows: Parameters<typeof recordPrismaHistory>[1]): Build => async (client) => {
  await applyPrismaMigrations(client);
  await recordPrismaHistory(client, rows);
};
const OTHER_SCHEMA = 'CREATE SCHEMA other';

describe('db:migrate refuses every state outside the decision table, changing nothing', () => {
  it.each<[string, Build, RegExp]>([
    [
      'the Prisma schema without its history',
      (client) => applyPrismaMigrations(client),
      /Prisma history: absent\n {2}Drizzle history: none\n {2}Catalog of public: the Prisma schema/,
    ],
    [
      'the final schema without a history',
      (client) => applyMigrationFiles(client),
      /Prisma history: absent\n {2}Drizzle history: none\n {2}Catalog of public: the schema after 0001/,
    ],
    [
      'a Drizzle history behind its schema',
      async (client) => {
        await applyMigrationFiles(client);
        await recordDrizzleHistory(client, 1);
      },
      /Drizzle history: 1 of 2 migrations applied\n {2}Catalog of public: the schema after 0001/,
    ],
    [
      'a Drizzle history ahead of its schema',
      async (client) => {
        await applyMigrationFiles(client, 1);
        await recordDrizzleHistory(client, 2);
      },
      /Drizzle history: 2 of 2 migrations applied\n {2}Catalog of public: the Prisma schema and the schema after 0000/,
    ],
    [
      'a valid Prisma history over an empty public',
      (client) => recordPrismaHistory(client),
      /Prisma history: valid\n {2}Drizzle history: none\n {2}Catalog of public: empty/,
    ],
    [
      'a valid Prisma history over the final schema',
      async (client) => {
        await applyMigrationFiles(client);
        await recordPrismaHistory(client);
      },
      /Prisma history: valid\n {2}Drizzle history: none\n {2}Catalog of public: the schema after 0001/,
    ],
    [
      'both histories on a Prisma-era database',
      async (client) => {
        await prismaEra(client);
        await recordDrizzleHistory(client, 1);
      },
      /Prisma history: valid\n {2}Drizzle history: 1 of 2 migrations applied/,
    ],
    [
      'both histories on a Drizzle-managed database',
      async (client) => {
        await managed(client);
        await recordPrismaHistory(client);
      },
      /Prisma history: valid\n {2}Drizzle history: 2 of 2 migrations applied/,
    ],
    [
      'a public holding only _prisma_migrations with a failed row',
      (client) => recordPrismaHistory(client, [{ name: FIRST, finished: false }]),
      /Prisma history: invalid \(a migration failed or did not finish\)[\s\S]*Catalog of public: empty/,
    ],
    [
      'a public holding only _prisma_migrations with no rows',
      (client) => recordPrismaHistory(client, []),
      new RegExp(`Prisma history: invalid \\(${FIRST} is not recorded as applied\\)[\\s\\S]*Catalog of public: empty`),
    ],
    [
      'a missing Prisma migration',
      withHistory(VALID_HISTORY.slice(0, -1)),
      new RegExp(`Prisma history: invalid \\(${LAST} is not recorded as applied\\)`),
    ],
    [
      'a failed Prisma migration',
      withHistory([...VALID_HISTORY.slice(0, -1), { name: LAST, finished: false }]),
      /Prisma history: invalid \(a migration failed or did not finish\)/,
    ],
    [
      'an altered Prisma migration',
      withHistory([{ name: FIRST, checksum: '0'.repeat(64) }, ...VALID_HISTORY.slice(1)]),
      new RegExp(`Prisma history: invalid \\(${FIRST} was altered\\)`),
    ],
    [
      'a Prisma migration recorded twice',
      withHistory([...VALID_HISTORY, { name: LAST }]),
      new RegExp(`Prisma history: invalid \\(${LAST} is recorded more than once\\)`),
    ],
    [
      'an unknown Prisma migration',
      withHistory([...VALID_HISTORY, { name: '20261101_extra', checksum: '0'.repeat(64) }]),
      /Prisma history: invalid \(a row names an unknown migration\)/,
    ],
    [
      'a Prisma history table of another shape',
      then(
        (client) => applyPrismaMigrations(client),
        'CREATE TABLE public._prisma_migrations (id int)',
      ),
      /Prisma history: invalid \(the table is not the one Prisma creates\)/,
    ],
    [
      'an empty public with no history beside an existing drizzle.prisma_migrations_archive',
      async (client) => {
        await client.query('CREATE SCHEMA drizzle');
        await client.query('CREATE TABLE drizzle.prisma_migrations_archive (id int)');
      },
      /Prisma history: absent\n {2}Drizzle history: none, with drizzle\.prisma_migrations_archive present\n {2}Catalog of public: empty$/,
    ],
    [
      'an existing drizzle.prisma_migrations_archive',
      then(prismaEra, 'CREATE SCHEMA drizzle', 'CREATE TABLE drizzle.prisma_migrations_archive (id int)'),
      /Drizzle history: none, with drizzle\.prisma_migrations_archive present/,
    ],
    [
      'a Drizzle row with an unknown hash',
      then(managed, `UPDATE drizzle.__drizzle_migrations SET hash = 'unknown' WHERE id = 2`),
      /Drizzle history: invalid \(row 2 is not 0001_minor_units_timestamptz\)/,
    ],
    [
      'a Drizzle row with an altered created_at',
      then(managed, 'UPDATE drizzle.__drizzle_migrations SET created_at = created_at + 1 WHERE id = 1'),
      /Drizzle history: invalid \(row 1 has an altered created_at\)/,
    ],
    [
      'a gap in the Drizzle history',
      then(managed, 'DELETE FROM drizzle.__drizzle_migrations WHERE id = 1'),
      /Drizzle history: invalid \(row 1 is not 0000_baseline\)/,
    ],
    [
      'an extra Drizzle row',
      then(managed, `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('extra', 1)`),
      /Drizzle history: invalid \(it records more migrations than drizzle\/ holds\)/,
    ],
    [
      'a Drizzle history table of another shape',
      then(
        (client) => applyMigrationFiles(client),
        'CREATE SCHEMA drizzle',
        'CREATE TABLE drizzle.__drizzle_migrations (id int)',
      ),
      /Drizzle history: invalid \(the table is not the one Drizzle creates\)/,
    ],
    [
      'a public holding only a leftover enum',
      (client) => client.query(`CREATE TYPE public."PaymentStatus" AS ENUM ('PENDING')`),
      /Catalog of public: matches no expected schema[\s\S]*\n {4}extra object type public\."PaymentStatus"/,
    ],
    [
      'a Drizzle-managed database whose public was dropped',
      then(managed, 'DROP SCHEMA public CASCADE'),
      /Drizzle history: 2 of 2 migrations applied\n {2}Catalog of public: empty/,
    ],
    [
      'a Drizzle-managed database whose public drifted',
      then(managed, 'ALTER TABLE public.payments ADD COLUMN note text'),
      /closest is the schema after 0001_minor_units_timestamptz, with 1 differences:\n {4}extra column public\.payments\.note$/,
    ],
  ])('%s', async (_case, build, message) => {
    await expectRefused(build, message);
  });
});

describe('the catalog reader sees every kind of extra object, on either accepted base', () => {
  const extras: [string, string[], RegExp][] = [
    ['a collation', ['CREATE COLLATION public.extra_collation FROM "C"'], /extra object collation public\.extra_collation/],
    ['a policy', ['CREATE POLICY extra_policy ON public.customers USING (true)'], /extra policy extra_policy on public\.customers/],
    [
      'a rule',
      ['CREATE RULE extra_rule AS ON INSERT TO public.audit_logs DO INSTEAD NOTHING'],
      /extra rule extra_rule on public\.audit_logs/,
    ],
    [
      'a text-search configuration',
      ['CREATE TEXT SEARCH CONFIGURATION public.extra_search (COPY = pg_catalog.simple)'],
      /extra object text search configuration public\.extra_search/,
    ],
    [
      'an operator',
      [
        OTHER_SCHEMA,
        'CREATE FUNCTION other.same(integer, integer) RETURNS boolean LANGUAGE sql AS $$SELECT $1 = $2$$',
        'CREATE OPERATOR public.=== (LEFTARG = integer, RIGHTARG = integer, FUNCTION = other.same)',
      ],
      /extra object operator public\.===\(integer,integer\)/,
    ],
    ['a domain', ['CREATE DOMAIN public.extra_domain AS integer'], /extra domain public\.extra_domain$/m],
    [
      'a function',
      ['CREATE FUNCTION public.extra_function() RETURNS integer LANGUAGE sql AS $$SELECT 1$$'],
      /extra object function public\.extra_function\(\)/,
    ],
    ['a table', ['CREATE TABLE public.extra_table (id integer)'], /extra object table public\.extra_table/],
    [
      'a trigger',
      [
        OTHER_SCHEMA,
        `CREATE FUNCTION other.touch() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END$$`,
        'CREATE TRIGGER extra_trigger BEFORE INSERT ON public.payments FOR EACH ROW EXECUTE FUNCTION other.touch()',
      ],
      /extra trigger extra_trigger on public\.payments$/m,
    ],
    ['a view', ['CREATE VIEW public.extra_view AS SELECT 1 AS one'], /extra object view public\.extra_view/],
    ['an extension', ['CREATE EXTENSION citext SCHEMA public'], /extra object extension citext/],
  ];

  it.each(
    extras.flatMap(([kind, statements, message]) => [
      [kind, 'Prisma-era', then(prismaEra, ...statements), message] as const,
      [kind, 'Drizzle-managed', then(managed, ...statements), message] as const,
    ]),
  )('%s on a %s database', async (_kind, _base, build, message) => {
    await expectRefused(build, message);
  });
});

describe('the catalog reader records relation and column properties, and a refusal names the record', () => {
  it.each<[string, string[], RegExp, RegExp]>([
    ['row-level security with no policy', ['ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY'], /different relation public\.payments$/m, /^relation public\.payments kind=r persistence=p rls=t /],
    ['forced row-level security', ['ALTER TABLE public.payments FORCE ROW LEVEL SECURITY'], /different relation public\.payments$/m, /^relation public\.payments .*force_rls=t /],
    ['an unlogged table', ['ALTER TABLE public.audit_logs SET UNLOGGED'], /different relation public\.audit_logs$/m, /^relation public\.audit_logs kind=r persistence=u /],
    ['a changed replica identity', ['ALTER TABLE public.payments REPLICA IDENTITY FULL'], /different relation public\.payments$/m, /^relation public\.payments .*replica_identity=f /],
    ['changed reloptions', ['ALTER TABLE public.payments SET (fillfactor = 70)'], /different relation public\.payments$/m, /^relation public\.payments .*options=fillfactor=70 /],
    [
      'a generated column',
      ['ALTER TABLE public.vehicles ADD COLUMN label text GENERATED ALWAYS AS (make) STORED'],
      /extra column public\.vehicles\.label$/m, /^column public\.vehicles\.label type=text .*generated=s$/,
    ],
    [
      'a column with another collation',
      ['ALTER TABLE public.vehicles ALTER COLUMN make TYPE text COLLATE "C"'],
      /different column public\.vehicles\.make$/m, /^column public\.vehicles\.make type=text .*collation=pg_catalog\."C" /,
    ],
    [
      'an identity column',
      ['ALTER TABLE public.ncd_codes ALTER COLUMN percentage ADD GENERATED BY DEFAULT AS IDENTITY'],
      /different column public\.ncd_codes\.percentage$/m, /^column public\.ncd_codes\.percentage type=integer .*identity=d /,
    ],
    [
      'a foreign key switched off with DISABLE TRIGGER ALL',
      ['ALTER TABLE public.payments DISABLE TRIGGER ALL'],
      /extra internal trigger for "payments_customerId_fkey" on public\.payments$/m, /^internal trigger for "payments_customerId_fkey" on public\.payments enabled=D$/,
    ],
  ])('%s', async (_case, statements, message, record) => {
    const db = await expectRefused(then(prismaEra, ...statements), message);

    expect(await catalogOf(db)).toContainEqual(expect.stringMatching(record));
  });
});

describe('the catalog reader sees outside dependants and members outside the table level', () => {
  it.each<[string, string[], RegExp]>([
    [
      'a table in another schema inheriting from public.payments',
      [OTHER_SCHEMA, 'CREATE TABLE other.child () INHERITS (public.payments)'],
      /extra outside dependant table other\.child/,
    ],
    [
      'a cast on a public enum',
      ['CREATE CAST (public."PaymentStatus" AS integer) WITH INOUT'],
      /extra outside dependant cast \(public\."PaymentStatus" AS integer\)/,
    ],
    [
      'a view in another schema over a timestamp column',
      [OTHER_SCHEMA, 'CREATE VIEW other.created AS SELECT "createdAt" FROM public.payments'],
      /extra outside dependant rule "_RETURN" on other\.created/,
    ],
    ['a schema publication', ['CREATE PUBLICATION extra_publication FOR TABLES IN SCHEMA public'], /extra object publication namespace /],
    [
      'a table publication',
      ['CREATE PUBLICATION table_publication FOR TABLE public.payments'],
      /extra member publication relation public\.payments in publication table_publication/,
    ],
    [
      'a statistics object in another schema',
      [OTHER_SCHEMA, 'CREATE STATISTICS other.payment_stats ON "customerId", status FROM public.payments'],
      /extra member statistics object other\.payment_stats/,
    ],
  ])('%s', async (_case, statements, message) => {
    await expectRefused(then(prismaEra, ...statements), message);
  });

  it('a default privilege in public, named without its role', async () => {
    const db = await expectRefused(
      then(prismaEra, 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO PUBLIC'),
      /extra object default acl in schema public on tables$/m,
    );

    const refusal = await migrateDatabase(db.config).catch((error: Error) => error.message);
    expect(refusal).not.toMatch(/for role/);
  });

  it.each([
    ['Prisma-era', prismaEra, 'amount'],
    ['Drizzle-managed', managed, 'amountMinor'],
  ] as const)('a view in another schema over a converted column of a %s database', async (_base, base, column) => {
    await expectRefused(
      then(base, OTHER_SCHEMA, `CREATE VIEW other.amounts AS SELECT "${column}" FROM public.payments`),
      /extra outside dependant rule "_RETURN" on other\.amounts/,
    );
  });
});

describe('states db:migrate accepts', () => {
  it('a database with no public schema and no histories, as fresh', async () => {
    const db = await scratch((client) => client.query('DROP SCHEMA public CASCADE'));

    expect(await migrateDatabase(db.config)).toMatchObject({ state: 'fresh' });
    const client = await db.connect();
    try {
      expect(await readCatalog(client)).toEqual(FINAL_CATALOG);
    } finally {
      await client.end();
    }
  });

  it('a Prisma history with extra rolled-back rows', async () => {
    const db = await scratch(
      withHistory([
        ...VALID_HISTORY,
        { name: LAST, finished: false, rolledBack: true },
        { name: '20261101_abandoned', checksum: '0'.repeat(64), finished: false, rolledBack: true },
      ]),
    );

    expect(await migrateDatabase(db.config)).toMatchObject({ state: 'prisma-era' });
  });

  it('a Prisma history whose checksums were taken over CRLF files', async () => {
    const crlf = (name: string) =>
      createHash('sha256').update(prismaMigrationSql(name).replace(/\n/g, '\r\n')).digest('hex');
    const db = await scratch(withHistory(PRISMA_MIGRATIONS.map((name) => ({ name, checksum: crlf(name) }))));

    expect(await migrateDatabase(db.config)).toMatchObject({ state: 'prisma-era' });
  });
});
