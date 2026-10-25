import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client, escapeIdentifier, type ClientBase } from 'pg';
import { parseIntoClientConfig } from 'pg-connection-string';
import { TEST_DATABASE_SUFFIX } from '../src/config/env.js';
import { readCatalog } from '../src/db/catalog.js';
import {
  CONVERTED_COLUMNS,
  failureDetails,
  failureReason,
  MigrationRefusedError,
  migrateDatabase,
  type MigrationStep,
} from '../src/db/migrator.js';
import { buildPrismaEraDatabase, PRISMA_MIGRATIONS } from './fixtures/prisma-era/prisma-era.js';
import {
  applyMigrationFiles,
  createScratchDatabase,
  databaseState,
  drizzleKit,
  recordDrizzleHistory,
  scratchClientConfig,
  type ScratchDatabase,
} from './scratch-database.js';

const API_ROOT = fileURLToPath(new URL('../', import.meta.url));
const ALL = ['0000_baseline', '0001_minor_units_timestamptz'];
const FINAL_CATALOG = JSON.parse(
  readFileSync(new URL('../drizzle/catalog/0001_minor_units_timestamptz.json', import.meta.url), 'utf8'),
) as string[];

const BUILT_ENTRY_POINT = 'dist/db/migrate.js';
const SENTINEL = 'p1sentinel';

const created: ScratchDatabase[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((db) => db.drop()));
});

async function scratch(build?: (client: ClientBase) => Promise<unknown>): Promise<ScratchDatabase> {
  const db = await createScratchDatabase('migrate');
  created.push(db);
  if (build) {
    await query(db, build);
  }
  return db;
}

async function query<T>(db: ScratchDatabase, run: (client: ClientBase) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

const stateOf = (db: ScratchDatabase) => query(db, databaseState);
const prismaEra = (client: ClientBase) => buildPrismaEraDatabase(client, { data: true });

async function managedAfterBaseline(client: ClientBase) {
  await applyMigrationFiles(client, 1);
  await recordDrizzleHistory(client, 1);
}

async function runEntryPoint(db: ScratchDatabase) {
  return promisify(execFile)(process.execPath, ['--import', 'tsx', 'src/db/migrate.ts'], {
    cwd: API_ROOT,
    env: { ...process.env, DATABASE_URL: db.url },
  });
}

describe('scratch databases', () => {
  const hostile = (url: string) => {
    const elsewhere = new URL(url);
    elsewhere.pathname = '/postgres';
    return `${url}${url.includes('?') ? '&' : '?'}connectionString=${encodeURIComponent(elsewhere.toString())}&host=elsewhere.example&port=1&user=intruder`;
  };

  it('are not made from a TEST_DATABASE_URL whose parameters redirect the connection', async () => {
    const saved = process.env.TEST_DATABASE_URL ?? '';
    process.env.TEST_DATABASE_URL = hostile(saved);
    try {
      const attempt = createScratchDatabase('migrate').then((db) => created.push(db));
      await expect(attempt).rejects.toThrow('TEST_DATABASE_URL must not set the URL parameter connectionString;');
    } finally {
      process.env.TEST_DATABASE_URL = saved;
    }
  });

  it('connect with every setting of the validated TEST_DATABASE_URL and their own name', () => {
    const url = 'postgresql://owner:pw@db.example:6000/insurshield_test?sslmode=verify-full&application_name=x';
    const saved = process.env.TEST_DATABASE_URL ?? '';
    process.env.TEST_DATABASE_URL = url;
    try {
      const config = scratchClientConfig('insurshield_migrate_1_test');

      expect(config).toEqual({ ...parseIntoClientConfig(url), database: 'insurshield_migrate_1_test' });
      expect(config).toMatchObject({ host: 'db.example', port: 6000, user: 'owner', password: 'pw', application_name: 'x' });
    } finally {
      process.env.TEST_DATABASE_URL = saved;
    }
  });

  it('are not configured from a TEST_DATABASE_URL whose parameters redirect the connection', () => {
    const saved = process.env.TEST_DATABASE_URL ?? '';
    process.env.TEST_DATABASE_URL = hostile(saved);
    try {
      expect(() => scratchClientConfig('insurshield_migrate_1_test')).toThrow(
        'TEST_DATABASE_URL must not set the URL parameter connectionString;',
      );
    } finally {
      process.env.TEST_DATABASE_URL = saved;
    }
  });
});

describe('the migrator library', () => {
  it('migrates nothing when imported', async () => {
    const db = await scratch();
    const before = await stateOf(db);

    const { stdout, stderr } = await promisify(execFile)(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', "await import('./src/db/migrator.ts');"],
      { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: db.url } },
    );

    expect(`${stdout}${stderr}`).toBe('');
    expect(await stateOf(db)).toEqual(before);
  });
});

async function runBuiltEntryPoint(databaseUrl: string, entryPoint = join(API_ROOT, BUILT_ENTRY_POINT)) {
  if (!parseIntoClientConfig(databaseUrl).database?.endsWith(TEST_DATABASE_SUFFIX)) {
    throw new Error(`The built entry point is run only on a DATABASE_URL that must name a database ending in ${TEST_DATABASE_SUFFIX}`);
  }
  return promisify(execFile)(process.execPath, [entryPoint], {
    cwd: API_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}

describe('the helper that runs the built entry point', () => {
  it('refuses a database whose name does not end in _test, before starting a process', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'migrate-guard-'));
    try {
      const marker = join(folder, 'started');
      const entryPoint = join(folder, 'entry.mjs');
      writeFileSync(entryPoint, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, '');`);
      const target = new URL(process.env.TEST_DATABASE_URL ?? '');
      target.pathname = `/${SENTINEL}_db`;

      await expect(runBuiltEntryPoint(target.toString(), entryPoint)).rejects.toThrow(
        `must name a database ending in ${TEST_DATABASE_SUFFIX}`,
      );
      expect(existsSync(marker)).toBe(false);

      target.pathname = `/${SENTINEL}_db${TEST_DATABASE_SUFFIX}`;
      await runBuiltEntryPoint(target.toString(), entryPoint);
      expect(existsSync(marker)).toBe(true);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

describe('the built entry point', () => {
  beforeAll(() => {
    const built = statSync(join(API_ROOT, BUILT_ENTRY_POINT), { throwIfNoEntry: false });
    const sources = readdirSync(join(API_ROOT, 'src'), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.name.endsWith('.spec.ts'))
      .map((entry) => join(entry.parentPath, entry.name));
    const newest = Math.max(...sources.map((source) => statSync(source).mtimeMs));
    if (!built || built.mtimeMs < newest) {
      throw new Error('Build the API first: npm run build -w @insurshield/api');
    }
  });

  const withSentinels = (url: string, parts: { user?: string; password?: string; host?: string; port?: string; database?: string }) => {
    const target = new URL(url);
    if (parts.user) target.username = parts.user;
    if (parts.password) target.password = parts.password;
    if (parts.host) target.hostname = parts.host;
    if (parts.port) target.port = parts.port;
    if (parts.database) target.pathname = `/${parts.database}`;
    target.search = `?application_name=${SENTINEL}_app`;
    return target.toString();
  };

  async function failure(databaseUrl: string): Promise<string> {
    const outcome = await runBuiltEntryPoint(databaseUrl).then(
      () => undefined,
      (error: { code?: number; stdout: string; stderr: string }) => error,
    );
    expect(outcome?.code).toBe(1);
    return `${outcome?.stdout ?? ''}${outcome?.stderr ?? ''}`;
  }

  it.each([
    ['directly', (entryPoint: string) => entryPoint],
    [
      'through a symlink',
      (entryPoint: string, folder: string) => {
        const link = join(folder, 'db-migrate.js');
        symlinkSync(entryPoint, link);
        return link;
      },
    ],
  ])('run %s, migrates a fresh database and exits non-zero when it refuses', async (_case, entry) => {
    const db = await scratch(async (client) => {
      await prismaEra(client);
      await client.query(`UPDATE payments SET amount = -1`);
    });
    const folder = mkdtempSync(join(tmpdir(), 'migrate-entry-'));
    try {
      const entryPoint = entry(join(API_ROOT, BUILT_ENTRY_POINT), folder);

      await expect(runBuiltEntryPoint(db.url, entryPoint)).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining('payments."amount" (1 row)'),
      });
      const fresh = await scratch();
      expect((await runBuiltEntryPoint(fresh.url, entryPoint)).stdout).toContain(
        'empty database; applied 0000_baseline, 0001_minor_units_timestamptz.',
      );
      expect(await query(fresh, readCatalog)).toEqual(FINAL_CATALOG);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  const missingDatabase = () => `${SENTINEL}_missing_${randomBytes(4).toString('hex')}${TEST_DATABASE_SUFFIX}`;

  it.each([
    ['the server cannot be reached', { host: '127.0.0.1', port: '1', user: `${SENTINEL}_user`, password: `${SENTINEL}_pw`, database: missingDatabase() }, 'could not connect to the server'],
    ['the database does not exist', { database: missingDatabase() }, 'the database does not exist'],
  ])('when %s, prints a fixed reason and no part of the URL', async (_case, parts, reason) => {
    const test = process.env.TEST_DATABASE_URL ?? '';
    const output = await failure(withSentinels(test, parts));

    expect(output).toContain(`db:migrate failed: ${reason}`);
    expect(output).not.toContain(SENTINEL);
    expect(output).not.toContain(new URL(test).password);
  });

  // A server that trusts the connection accepts any password, so the case below would prove nothing.
  async function requirePasswordAuthentication(url: string) {
    const target = new URL(url);
    target.password = `${SENTINEL}_wrong`;
    const client = new Client({ connectionString: target.toString() });
    const code = await client.connect().then(
      () => 'accepted',
      (error: { code?: string }) => error.code,
    );
    await client.end().catch(() => undefined);
    if (code !== '28P01') {
      throw new Error('Precondition: the test server must check passwords, and it did not refuse a wrong one');
    }
  }

  it('when the password is wrong, prints a fixed reason and no part of the URL', async () => {
    const test = process.env.TEST_DATABASE_URL ?? '';
    await requirePasswordAuthentication(test);

    const output = await failure(
      withSentinels(test, { user: `${SENTINEL}_user`, password: `${SENTINEL}_pw`, database: missingDatabase() }),
    );

    expect(output).toContain('db:migrate failed: authentication failed');
    expect(output).not.toContain(SENTINEL);
    expect(output).not.toContain(new URL(test).password);
  });

  async function requireServerWithoutTls(url: string) {
    const client = new Client({ ...parseIntoClientConfig(url), ssl: { rejectUnauthorized: false } });
    const outcome = await client.connect().then(
      () => 'accepted',
      (error: Error) => error.message,
    );
    await client.end().catch(() => undefined);
    if (outcome !== 'The server does not support SSL connections') {
      throw new Error('Precondition: the test server must not offer TLS, and it did not refuse a TLS request');
    }
  }

  it('when the URL requires TLS and the server does not offer it, says TLS and no part of the URL', async () => {
    const test = process.env.TEST_DATABASE_URL ?? '';
    await requireServerWithoutTls(test);
    const target = new URL(withSentinels(test, { database: missingDatabase() }));
    target.searchParams.set('sslmode', 'require');

    const output = await failure(target.toString());

    expect(output).toContain('db:migrate failed: TLS failed');
    expect(output).not.toContain(SENTINEL);
  });

  it('when the migrations folder is missing, names the error code and no path', async () => {
    const copy = mkdtempSync(join(tmpdir(), 'migrate-without-drizzle-'));
    try {
      mkdirSync(join(copy, 'api'));
      cpSync(join(API_ROOT, 'dist'), join(copy, 'api', 'dist'), { recursive: true });
      copyFileSync(join(API_ROOT, 'package.json'), join(copy, 'api', 'package.json'));
      symlinkSync(join(API_ROOT, '..', '..', 'node_modules'), join(copy, 'node_modules'));
      const db = await scratch();

      const outcome = await runBuiltEntryPoint(db.url, join(copy, 'api', BUILT_ENTRY_POINT)).then(
        () => undefined,
        (error: { code?: number; stdout: string; stderr: string }) => error,
      );

      expect(outcome?.code).toBe(1);
      expect(outcome?.stderr).toContain('db:migrate failed: an unexpected error (ENOENT)');
      expect(`${outcome?.stdout}${outcome?.stderr}`).not.toContain(copy);
      expect(await stateOf(db)).toEqual(await stateOf(await scratch()));
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  });

  it('when a statement fails, prints a fixed reason and the SQLSTATE, and no names', async () => {
    const db = await scratch();
    const role = `${SENTINEL}_role_${Date.now()}`;
    await query(db, (client) => client.query(`CREATE ROLE ${role} LOGIN PASSWORD '${SENTINEL}_pw'`));
    try {
      const output = await failure(withSentinels(db.url, { user: role, password: `${SENTINEL}_pw` }));

      expect(output).toContain('db:migrate failed: a statement failed');
      expect(output).toContain("code: '42501'");
      expect(output).not.toContain(SENTINEL);
      expect(output).not.toContain(db.name);
    } finally {
      await query(db, (client) => client.query(`DROP ROLE ${role}`));
    }
  });
});

describe('db:migrate recognises each accepted state and leaves it Drizzle-managed', () => {
  it.each([
    ['an empty database', undefined, 'fresh', ALL],
    ['a Drizzle-managed database with a pending migration', managedAfterBaseline, 'managed', ALL.slice(1)],
    ['a fully migrated Prisma-era database', prismaEra, 'prisma-era', ALL.slice(1)],
  ] as const)('%s, then a second run applies nothing', async (_case, build, state, applied) => {
    const db = await scratch(build);

    expect(await migrateDatabase(db.config)).toEqual({ state, applied });
    const after = await stateOf(db);
    expect(await migrateDatabase(db.config)).toEqual({ state: 'managed', applied: [] });
    expect(await stateOf(db)).toEqual(after);
  });

  it('adopts a Prisma-era database: archives its history, keeps JSON and benefits, converts money', async () => {
    const db = await scratch(prismaEra);
    const json = `SELECT
      (SELECT json_agg(json_build_array(name, benefits, benefits IS NULL) ORDER BY name) FROM insurers) AS benefits,
      (SELECT json_agg(json_build_array(key, "responseBody", "responseBody" IS NULL) ORDER BY key) FROM idempotency_records) AS idempotency,
      (SELECT json_agg(json_build_array(id, "requestPayload", "responseBody", "responseBody" IS NULL) ORDER BY id) FROM integration_deliveries) AS deliveries,
      (SELECT json_agg(json_build_array(id, before, after, before IS NULL, after IS NULL) ORDER BY id) FROM audit_logs) AS audit`;
    const before = await query(db, async (client) => (await client.query(json)).rows[0]);

    const { stdout } = await runEntryPoint(db);

    expect(stdout).toContain('Prisma-era database, adopted; applied 0001_minor_units_timestamptz.');
    await query(db, async (client) => {
      expect((await client.query(json)).rows[0]).toEqual(before);
      const { rows: archive } = await client.query(
        `SELECT migration_name FROM drizzle.prisma_migrations_archive ORDER BY migration_name`,
      );
      expect(archive.map((row) => row.migration_name)).toEqual(PRISMA_MIGRATIONS);
      const { rows: prisma } = await client.query(`SELECT to_regclass('public._prisma_migrations') AS t`);
      expect(prisma[0].t).toBeNull();
      const { rows: history } = await client.query(`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`);
      expect(history[0].n).toBe(2);
      const { rows: loss } = await client.query(
        `SELECT "claimNumber", "estimatedLossMinor" FROM claim_notifications ORDER BY 1`,
      );
      expect(loss).toEqual([
        { claimNumber: 'CL-1', estimatedLossMinor: null },
        { claimNumber: 'CL-2', estimatedLossMinor: '1' },
      ]);
    });

    const second = await runEntryPoint(db);
    expect(second.stdout).toContain('Drizzle-managed database; nothing to apply.');
  });

  it('installs a fresh database through the entry point, and a second run does nothing', async () => {
    const db = await scratch();

    expect((await runEntryPoint(db)).stdout).toContain(
      'empty database; applied 0000_baseline, 0001_minor_units_timestamptz.',
    );
    expect((await runEntryPoint(db)).stdout).toContain('Drizzle-managed database; nothing to apply.');
    expect(await query(db, readCatalog)).toEqual(FINAL_CATALOG);
  });

  it('exits non-zero with the refusal and no values when it refuses', async () => {
    const db = await scratch(async (client) => {
      await prismaEra(client);
      await client.query(`UPDATE payments SET amount = -1`);
    });

    await expect(runEntryPoint(db)).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('payments."amount" (1 row)'),
    });
  });
});

describe('a catalog refusal names the records that differ, never their definitions', () => {
  const fallback = `${SENTINEL}_default`;

  it.each([
    ['an extra column', `ALTER TABLE public.payments ADD COLUMN note text DEFAULT '${fallback}'`, 'extra column public.payments.note'],
    [
      'a changed column default',
      `ALTER TABLE public.payments ALTER COLUMN "transactionId" SET DEFAULT '${fallback}'`,
      'different column public.payments."transactionId"',
    ],
  ])('%s, in the refusal and on the command\'s stderr', async (_case, statement, listed) => {
    const db = await scratch(async (client) => {
      await prismaEra(client);
      await client.query(statement);
    });

    const refusal = await migrateDatabase(db.config).then(
      () => '',
      (error: Error) => error.message,
    );
    expect(refusal).toContain(`\n    ${listed}`);
    expect(refusal).not.toContain(SENTINEL);

    const command = await runEntryPoint(db).then(
      () => undefined,
      (error: { code?: number; stdout: string; stderr: string }) => error,
    );
    expect(command?.code).toBe(1);
    expect(command?.stderr).toContain(listed);
    expect(`${command?.stdout}${command?.stderr}`).not.toContain(SENTINEL);
  });
});

describe('the Prisma-era migration folder', () => {
  const folder = new URL('../drizzle/prisma-era/', import.meta.url);

  it('holds exactly the six Prisma migrations as folders', () => {
    const folders = readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(folders).toEqual([...PRISMA_MIGRATIONS]);
    expect(PRISMA_MIGRATIONS).toHaveLength(6);
  });

  it('adopts a Prisma-era database with a stray file in a copy of the folder', async () => {
    const db = await scratch(prismaEra);
    const copy = mkdtempSync(join(tmpdir(), 'migrations-'));
    try {
      cpSync(join(API_ROOT, 'drizzle'), copy, { recursive: true });
      writeFileSync(join(copy, 'prisma-era', '.DS_Store'), '');

      expect(await migrateDatabase(db.config, { migrationsFolder: copy })).toEqual({
        state: 'prisma-era',
        applied: ALL.slice(1),
      });
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  });

  it('reads the migrations from the folder it is given', async () => {
    const db = await scratch();
    const empty = mkdtempSync(join(tmpdir(), 'migrations-'));
    try {
      await expect(migrateDatabase(db.config, { migrationsFolder: empty })).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await stateOf(db)).toEqual(await stateOf(await scratch()));
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('plain drizzle-kit migrate on a Prisma-era database', () => {
  it('fails, leaves only an empty Drizzle history, and db:migrate then adopts', async () => {
    const db = await scratch(prismaEra);
    const before = await stateOf(db);

    await expect(drizzleKit(['migrate', '--config', 'drizzle.config.ts'], { databaseUrl: db.url })).rejects.toThrow();

    const after = await stateOf(db);
    expect(after.filter((line) => !before.includes(line))).toEqual([
      'schema drizzle',
      'relation drizzle.__drizzle_migrations r',
      'rows drizzle.__drizzle_migrations ',
      'relation drizzle.__drizzle_migrations_id_seq S',
      'relation drizzle.__drizzle_migrations_pkey i',
    ]);
    expect(before.filter((line) => !after.includes(line))).toEqual([]);
    expect(await migrateDatabase(db.config)).toEqual({ state: 'prisma-era', applied: ALL.slice(1) });
  });
});

describe('a failure at any step rolls everything back', () => {
  const failAt = (match: (step: MigrationStep) => boolean) => ({
    onStep(step: MigrationStep) {
      if (match(step)) {
        throw new Error(`injected at ${step.name}`);
      }
    },
  });

  it.each([
    ['after creating the drizzle schema', (step: MigrationStep) => step.name === 'created-drizzle-schema'],
    ['after moving the Prisma history', (step: MigrationStep) => step.name === 'moved-prisma-history'],
    [
      'after recording 0000',
      (step: MigrationStep) => step.name === 'recorded-migration' && step.tag === '0000_baseline',
    ],
    [
      'inside 0001',
      (step: MigrationStep) =>
        step.name === 'applied-statement' && step.tag === '0001_minor_units_timestamptz' && step.index === 10,
    ],
    ['at the final check', (step: MigrationStep) => step.name === 'final-check'],
  ])('%s', async (_case, match) => {
    const db = await scratch(prismaEra);
    const before = await stateOf(db);

    await expect(migrateDatabase(db.config, failAt(match))).rejects.toThrow(/^injected at/);

    expect(await stateOf(db)).toEqual(before);
  });

  it('when the final check finds a schema other than the final one', async () => {
    const db = await scratch(prismaEra);
    const before = await stateOf(db);

    const run = migrateDatabase(db.config, {
      async onStep(step, client) {
        if (step.name === 'final-check') {
          await client.query('CREATE TABLE public.intruder (id int)');
        }
      },
    });

    await expect(run).rejects.toThrow(MigrationRefusedError);
    await expect(run).rejects.toThrow(/Refusing to commit[\s\S]*\n {4}extra object table public\.intruder$/m);
    expect(await stateOf(db)).toEqual(before);
  });
});

describe('rows that would break the new constraints', () => {
  const money = CONVERTED_COLUMNS.filter((column) => column.renamedTo.endsWith('Minor'));
  const rates = CONVERTED_COLUMNS.filter((column) => column.renamedTo.endsWith('Bps'));

  it.each([
    ...CONVERTED_COLUMNS.flatMap(({ table, column }) => [
      [table, column, '-0.01'],
      [table, column, 'NaN'],
    ]),
    ...rates.map(({ table, column }) => [table, column, '100.01']),
  ])('refuse %s."%s" = %s, changing nothing', async (table, column, value) => {
    const db = await scratch(async (client) => {
      await prismaEra(client);
      await client.query(`UPDATE "${table}" SET "${column}" = $1::numeric WHERE ctid = (SELECT min(ctid) FROM "${table}")`, [
        value,
      ]);
    });
    const before = await stateOf(db);

    await expect(migrateDatabase(db.config)).rejects.toThrow(
      `Refusing to migrate: rows break the constraints 0001_minor_units_timestamptz adds, and nothing was changed. Correct them and run again: ${table}."${column}" (1 row).`,
    );
    expect(await stateOf(db)).toEqual(before);
  });

  it('names every failing column with its count', async () => {
    const db = await scratch(async (client) => {
      await prismaEra(client);
      await client.query(`UPDATE quote_requests SET "vehicleValue" = -1`);
      await client.query(`UPDATE insurers SET "ratePercentage" = 'NaN' WHERE name <> 'Benefits Null'`);
      await client.query(`UPDATE pia_config SET "piaRatePercentage" = 999.99`);
    });

    await expect(migrateDatabase(db.config)).rejects.toThrow(
      'quote_requests."vehicleValue" (3 rows), insurers."ratePercentage" (2 rows), pia_config."piaRatePercentage" (1 row).',
    );
  });

  it('accepts a NULL estimated loss and the largest amounts and rates', async () => {
    const db = await scratch(async (client) => {
      await prismaEra(client);
      for (const { table, column } of money) {
        await client.query(`UPDATE "${table}" SET "${column}" = 999999999999.99`);
      }
      await client.query(`UPDATE claim_notifications SET "estimatedLoss" = NULL WHERE "claimNumber" = 'CL-1'`);
      for (const { table, column } of rates) {
        await client.query(`UPDATE "${table}" SET "${column}" = 100.00`);
      }
    });

    expect(await migrateDatabase(db.config)).toEqual({ state: 'prisma-era', applied: ALL.slice(1) });
  });

  it('counts the columns and bounds of the CHECKs 0001 adds, as money-limits.ts defines them', () => {
    const checks = FINAL_CATALOG.filter((record) => / type=c /.test(record)).map((record) => {
      const match =
        /^constraint "(\w+)_(\w+)_check" on public\.(\w+) type=c CHECK \(\(\("(\w+)" >= (\d+)\) AND \("\4" <= '?(\d+)'?(?:::bigint)?\)\)\)$/.exec(
          record,
        );
      expect(match, record).not.toBeNull();
      const [, , , table, column, min, max] = match ?? [];
      return { table, renamedTo: column, min: BigInt(min), max: BigInt(max) };
    });

    expect(checks).toEqual(
      expect.arrayContaining(
        CONVERTED_COLUMNS.map(({ table, renamedTo, min, max }) => ({ table, renamedTo, min, max })),
      ),
    );
    expect(checks).toHaveLength(CONVERTED_COLUMNS.length);
  });
});

describe('a server whose database TimeZone is Africa/Lusaka', () => {
  const inLusaka = (db: ScratchDatabase) =>
    query(db, (client) => client.query(`ALTER DATABASE ${escapeIdentifier(db.name)} SET TimeZone = 'Africa/Lusaka'`));

  it('installs a fresh database', async () => {
    const db = await scratch();
    await inLusaka(db);

    expect(await migrateDatabase(db.config)).toEqual({ state: 'fresh', applied: ALL });
  });

  it('adopts a Prisma-era database and keeps the instant the Prisma build read from each timestamp', async () => {
    const db = await scratch(prismaEra);
    await inLusaka(db);
    const stored = await query(db, async (client) =>
      (await client.query(`SELECT "preferredDate"::text AS v FROM inspections WHERE id = 'INS-1'`)).rows,
    );
    expect(stored).toEqual([{ v: '2026-04-02 22:00:00' }]);

    expect(await migrateDatabase(db.config)).toEqual({ state: 'prisma-era', applied: ALL.slice(1) });

    const read = await query(db, async (client) =>
      (await client.query<{ v: Date }>(`SELECT "preferredDate" AS v FROM inspections WHERE id = 'INS-1'`)).rows,
    );
    expect(read.map((row) => row.v.toISOString())).toEqual(['2026-04-02T22:00:00.000Z']);
  });
});

describe('concurrent runs', () => {
  it('waits for the lock past a transaction_timeout the connection sets, then migrates', async () => {
    const db = await scratch();
    const holder = await db.connect();
    await holder.query(`SELECT pg_advisory_lock(hashtextextended('insurshield db:migrate', 0))`);
    const release = setTimeout(() => void holder.end(), 3_000);
    try {
      const started = Date.now();
      expect(await migrateDatabase({ ...db.config, options: '-c transaction_timeout=1000' })).toEqual({
        state: 'fresh',
        applied: ALL,
      });
      expect(Date.now() - started).toBeGreaterThan(3_000);
    } finally {
      clearTimeout(release);
      await holder.end().catch(() => undefined);
    }
  });

  it('a second run waits past its own statement_timeout for a first that holds the lock for over 60 s, then applies nothing', async () => {
    const db = await scratch();
    let holding: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      holding = resolve;
    });
    const first = migrateDatabase(db.config, {
      async onStep(step) {
        if (step.name === 'final-check') {
          holding();
          await new Promise((resolve) => setTimeout(resolve, 61_000));
        }
      },
    });
    // A first run that fails before the final check would otherwise leave this wait hanging until the test times out.
    await Promise.race([held, first]);
    const started = Date.now();
    const second = migrateDatabase({ ...db.config, options: '-c statement_timeout=1000' });

    // Both runs finish before the assertion, so a failure cannot leave one running while the database is dropped.
    const results = await Promise.allSettled([first, second]);
    expect(results).toEqual([
      { status: 'fulfilled', value: { state: 'fresh', applied: ALL } },
      { status: 'fulfilled', value: { state: 'managed', applied: [] } },
    ]);
    expect(Date.now() - started).toBeGreaterThan(60_000);
  }, 150_000);
});

describe('a connection lost while the migrator waits between statements', () => {
  it('fails the next statement with the fixed reason instead of ending the process', async () => {
    const db = await scratch();
    const side = await db.connect();
    try {
      const error: unknown = await migrateDatabase(db.config, {
        async onStep(step, client) {
          if (step.name !== 'created-drizzle-schema') return;
          const { rows } = await client.query<{ pid: number }>('SELECT pg_catalog.pg_backend_pid() AS pid');
          await side.query('SELECT pg_catalog.pg_terminate_backend($1)', [rows[0].pid]);
          for (let attempt = 0; attempt < 200; attempt += 1) {
            const { rowCount } = await side.query('SELECT 1 FROM pg_catalog.pg_stat_activity WHERE pid = $1', [rows[0].pid]);
            if (rowCount === 0) break;
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          await new Promise((resolve) => setTimeout(resolve, 200));
        },
      }).then(
        () => undefined,
        (rejection: unknown) => rejection,
      );

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(MigrationRefusedError);
      expect(`db:migrate failed: ${failureReason(error)}`).toBe('db:migrate failed: an unexpected error');
      expect(failureDetails(error)).toEqual({});
    } finally {
      await side.end();
    }
  });
});
