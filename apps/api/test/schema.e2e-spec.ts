import { randomUUID } from 'node:crypto';
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ClientBase } from 'pg';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { MAX_NGWEE } from '../src/common/domain/money-limits.js';
import { readCatalog, type Catalog } from '../src/db/catalog.js';
import { CONVERTED_COLUMNS, migrateDatabase } from '../src/db/migrator.js';
import { buildPrismaEraDatabase } from './fixtures/prisma-era/prisma-era.js';
import {
  applyMigrationFiles,
  catalogPath,
  createScratchDatabase,
  databaseState,
  DRIZZLE_FOLDER,
  drizzleKit,
  migrationTags,
  recordDrizzleHistory,
  type ScratchDatabase,
} from './scratch-database.js';

const SCHEMA = fileURLToPath(new URL('../src/db/schema.ts', import.meta.url));
const LUSAKA = { options: '-c TimeZone=Africa/Lusaka' };
const TAGS = migrationTags();

/** How many migrations precede 0009, which is the one the scanning test is about. */
const SCANNING = TAGS.findIndex((tag) => tag.startsWith('0009_'));

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

async function applyMigration(client: ClientBase, index: number) {
  const migration = readMigrationFiles({ migrationsFolder: DRIZZLE_FOLDER })[index];
  if (!migration) throw new Error(`Migration ${index} is missing`);
  for (const statement of migration.sql) {
    await client.query(statement);
  }
}

async function pushed(): Promise<ScratchDatabase> {
  const db = await scratch();
  await drizzleKit(['push', '--force', '--config', 'drizzle.config.ts'], { databaseUrl: db.url });
  // Drizzle models tables and indexes but not the append-only trigger. Keep
  // the push-built catalog comparable to the real migration-built catalog.
  await query(db, applyAuditLogAppendOnlyInvariant);
  return db;
}

async function applyAuditLogAppendOnlyInvariant(client: ClientBase) {
  // Keep the definition text byte-for-byte aligned with migration 0008: the
  // catalog deliberately detects a changed database function definition.
  await client.query(`CREATE OR REPLACE FUNCTION "audit_logs_reject_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$;`);
  await client.query(`DROP TRIGGER IF EXISTS "audit_logs_append_only" ON "audit_logs"`);
  await client.query(`CREATE TRIGGER "audit_logs_append_only"
BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW
EXECUTE FUNCTION "audit_logs_reject_mutation"()`);
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
  const file = catalogPath(name);
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

  it.each(TAGS.map((tag, index) => [index + 1, tag] as const))(
    'the catalog after %i Drizzle migrations is %s.json',
    async (count, tag) => {
      const db = await scratch((client) => applyMigrationFiles(client, count));
      await expectCatalogFile(await catalogOf(db), tag);
    },
  );

  it(`the final catalog, ${TAGS.at(-1)}.json, is what drizzle-kit push makes of src/db/schema.ts`, async () => {
    const db = await pushed();
    await expectCatalogFile(await catalogOf(db), TAGS[TAGS.length - 1]);
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

    await query(db, (client) => applyMigration(client, 1), LUSAKA);

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

    await query(db, (client) => applyMigration(client, 1), LUSAKA);

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

describe('0002_better_auth', () => {
  const CUSTOMERS = [randomUUID(), randomUUID()];
  const STAFF = [randomUUID(), randomUUID()];
  const keycloakEraRows = async (client: ClientBase) => {
    for (const [index, id] of CUSTOMERS.entries()) {
      await client.query(
        `INSERT INTO customers (id, "fullName", email, phone, "keycloakId", "updatedAt")
         VALUES ($1, 'Chanda Mwale', $2, $3, $4, '2026-10-01T08:00:00Z')`,
        [id, `customer-${index}@example.invalid`, `+26097000000${index}`, `kc-customer-${index}`],
      );
      await client.query(
        `INSERT INTO consent_records (id, "customerId", "privacyVersion", "termsVersion") VALUES ($1, $2, 'v1', 'v1')`,
        [randomUUID(), id],
      );
    }
    for (const [index, id] of STAFF.entries()) {
      await client.query(
        `INSERT INTO staff_users (id, email, "fullName", role, "keycloakId", "updatedAt")
         VALUES ($1, $2, 'Mutale Banda', 'ADMIN', $3, '2026-10-01T08:00:00Z')`,
        [id, `staff-${index}@example.invalid`, `kc-staff-${index}`],
      );
    }
  };
  const atFirstWithKeycloakRows = async (client: ClientBase) => {
    await applyMigrationFiles(client, 2);
    await recordDrizzleHistory(client, 2);
    await keycloakEraRows(client);
  };
  const atBetterAuthWithKeycloakRows = async (client: ClientBase) => {
    await applyMigrationFiles(client, 3);
    await recordDrizzleHistory(client, 3);
    await keycloakEraRows(client);
  };
  const keycloakEraDomainRows = async (client: ClientBase) => ({
    customers: (
      await client.query(
        `SELECT id, "fullName", email, phone, "keycloakId", "userId" FROM customers ORDER BY id`,
      )
    ).rows,
    staff: (
      await client.query(
        `SELECT id, email, "fullName", role, "keycloakId", "userId" FROM staff_users ORDER BY id`,
      )
    ).rows,
    consents: (await client.query(`SELECT * FROM consent_records ORDER BY id`)).rows,
  });

  async function insertUser(client: ClientBase, { sessions = 0, accounts = 0 } = {}): Promise<string> {
    const id = randomUUID();
    await client.query(
      `INSERT INTO auth_users (id, name, email, "updatedAt") VALUES ($1, 'Bwalya Phiri', $2, CURRENT_TIMESTAMP)`,
      [id, `${id}@example.invalid`],
    );
    for (let index = 0; index < sessions; index++) {
      await client.query(
        `INSERT INTO auth_sessions (id, "expiresAt", token, "updatedAt", "userId")
         VALUES ($1, CURRENT_TIMESTAMP + interval '7 days', $2, CURRENT_TIMESTAMP, $3)`,
        [randomUUID(), randomUUID(), id],
      );
    }
    for (let index = 0; index < accounts; index++) {
      await client.query(
        `INSERT INTO auth_accounts (id, "accountId", "providerId", "userId", "updatedAt")
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
        [randomUUID(), id, `provider-${index}`, id],
      );
    }
    return id;
  }

  const countFor = async (client: ClientBase, table: string, userId: string) =>
    (await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE "userId" = $1`, [userId])).rows[0].n;

  it('M1 applies on a database at 0001 holding Keycloak-era rows, which keep every value with a null userId', async () => {
    const db = await scratch(atFirstWithKeycloakRows);
    const before = await query(db, async (client) => ({
      customers: (
        await client.query(`SELECT id, "fullName", email, phone, "keycloakId" FROM customers ORDER BY id`)
      ).rows,
      staff: (
        await client.query(`SELECT id, email, "fullName", role, "keycloakId" FROM staff_users ORDER BY id`)
      ).rows,
      consents: (await client.query(`SELECT * FROM consent_records ORDER BY id`)).rows,
    }));

    await query(db, (client) => applyMigration(client, 2));

    const after = await query(db, keycloakEraDomainRows);
    expect(before.customers).toHaveLength(2);
    expect(before.staff).toHaveLength(2);
    expect(after.customers).toEqual(before.customers.map((row) => ({ ...row, userId: null })));
    expect(after.staff).toEqual(before.staff.map((row) => ({ ...row, userId: null })));
    expect(after.consents).toEqual(before.consents);
  });

  it("accepts the Keycloak build's writes: a keycloakId and no userId", async () => {
    const db = await scratch(atBetterAuthWithKeycloakRows);

    await query(db, async (client) => {
      const insert = (keycloakId: string, email: string) =>
        client.query(
          `INSERT INTO customers (id, "fullName", email, phone, "keycloakId", "updatedAt")
           VALUES ($1, 'Mutale Phiri', $2, $3, $4, CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING`,
          [randomUUID(), email, `pending:${keycloakId}`, keycloakId],
        );
      expect((await insert('kc-new', 'new@example.invalid')).rowCount).toBe(1);
      expect((await insert('kc-new', 'other@example.invalid')).rowCount).toBe(0);
      const staff = await client.query(
        `INSERT INTO staff_users (id, email, "fullName", role, "keycloakId", "updatedAt")
         VALUES ($1, 'staff-0@example.invalid', 'Mutale Banda', 'ADMIN', 'kc-relinked', CURRENT_TIMESTAMP)
         ON CONFLICT (email) DO UPDATE SET "keycloakId" = excluded."keycloakId" RETURNING "keycloakId", "userId"`,
        [randomUUID()],
      );
      expect(staff.rows).toEqual([{ keycloakId: 'kc-relinked', userId: null }]);
    });
  });

  it.each([
    ['customers', CUSTOMERS],
    ['staff_users', STAFF],
  ])('links a user from at most one row of %s', async (table, ids) => {
    const db = await scratch(atBetterAuthWithKeycloakRows);

    await query(db, async (client) => {
      const user = await insertUser(client);
      const link = (id: string) => client.query(`UPDATE ${table} SET "userId" = $1 WHERE id = $2`, [user, id]);
      expect((await link(ids[0])).rowCount).toBe(1);
      await expect(link(ids[1])).rejects.toMatchObject({ code: '23505', constraint: `${table}_userId_key` });
    });
  });

  it('refuses to delete a user a customer or staff row links, keeping its sessions and accounts', async () => {
    const db = await scratch(atBetterAuthWithKeycloakRows);

    await query(db, async (client) => {
      const user = await insertUser(client, { sessions: 1, accounts: 1 });
      const remove = () => client.query(`DELETE FROM auth_users WHERE id = $1`, [user]);
      const link = (table: string, id: string, value: string | null) =>
        client.query(`UPDATE ${table} SET "userId" = $1 WHERE id = $2`, [value, id]);
      await link('customers', CUSTOMERS[0], user);
      await link('staff_users', STAFF[0], user);

      await expect(remove()).rejects.toMatchObject({ code: '23503', constraint: 'customers_userId_fkey' });
      await link('customers', CUSTOMERS[0], null);
      await expect(remove()).rejects.toMatchObject({ code: '23503', constraint: 'staff_users_userId_fkey' });
      expect(await countFor(client, 'auth_sessions', user)).toBe(1);
      expect(await countFor(client, 'auth_accounts', user)).toBe(1);

      await link('staff_users', STAFF[0], null);
      expect((await remove()).rowCount).toBe(1);
    });
  });

  it('stores a user email only in lower case', async () => {
    const db = await scratch((client) => applyMigrationFiles(client));

    await query(db, async (client) => {
      const insert = (email: string) =>
        client.query(
          `INSERT INTO auth_users (id, name, email, "updatedAt") VALUES ($1, 'Bwalya Phiri', $2, CURRENT_TIMESTAMP)`,
          [randomUUID(), email],
        );
      await expect(insert('Mwale@example.invalid')).rejects.toMatchObject({
        code: '23514',
        constraint: 'auth_users_email_check',
      });
      expect((await insert('mwale@example.invalid')).rowCount).toBe(1);
    });
  });

  it('keys failed sign-ins only by a lower-case email', async () => {
    const db = await scratch((client) => applyMigrationFiles(client));

    await query(db, async (client) => {
      const insert = (emailKey: string) =>
        client.query(
          `INSERT INTO auth_sign_in_failures ("emailKey", attempts, "windowStartedAt") VALUES ($1, 1, CURRENT_TIMESTAMP)`,
          [emailKey],
        );
      await expect(insert('Mwale@example.invalid')).rejects.toMatchObject({
        code: '23514',
        constraint: 'auth_sign_in_failures_emailKey_check',
      });
      expect((await insert('mwale@example.invalid')).rowCount).toBe(1);
    });
  });

  it("deletes an unlinked user's sessions and accounts with it, and no one else's", async () => {
    const db = await scratch(atBetterAuthWithKeycloakRows);

    await query(db, async (client) => {
      const deleted = await insertUser(client, { sessions: 2, accounts: 2 });
      const kept = await insertUser(client, { sessions: 1, accounts: 1 });

      await client.query(`DELETE FROM auth_users WHERE id = $1`, [deleted]);

      expect(await countFor(client, 'auth_sessions', deleted)).toBe(0);
      expect(await countFor(client, 'auth_accounts', deleted)).toBe(0);
      expect(await countFor(client, 'auth_sessions', kept)).toBe(1);
      expect(await countFor(client, 'auth_accounts', kept)).toBe(1);
    });
  });
});

describe('0003_drop_keycloak_ids', () => {
  it('removes the retired columns and indexes without changing the Better Auth links or domain rows', async () => {
    const customerId = randomUUID();
    const staffId = randomUUID();
    const db = await scratch(async (client) => {
      await applyMigrationFiles(client, 3);
      await client.query(
        `INSERT INTO customers (id, "fullName", email, phone, "keycloakId", "updatedAt")
         VALUES ($1, 'Chanda Mwale', 'chanda@example.invalid', '+260970000001', 'kc-chanda', CURRENT_TIMESTAMP)`,
        [customerId],
      );
      await client.query(
        `INSERT INTO staff_users (id, email, "fullName", role, "keycloakId", "updatedAt")
         VALUES ($1, 'mutale@example.invalid', 'Mutale Banda', 'ADMIN', 'kc-mutale', CURRENT_TIMESTAMP)`,
        [staffId],
      );
    });

    await query(db, async (client) => {
      await applyMigration(client, 3);

      expect(
        (
          await client.query(
            `SELECT id, "fullName", email, phone, "userId" FROM customers WHERE id = $1`,
            [customerId],
          )
        ).rows,
      ).toEqual([
        { id: customerId, fullName: 'Chanda Mwale', email: 'chanda@example.invalid', phone: '+260970000001', userId: null },
      ]);
      expect(
        (
          await client.query(
            `SELECT id, email, "fullName", role, "userId" FROM staff_users WHERE id = $1`,
            [staffId],
          )
        ).rows,
      ).toEqual([
        { id: staffId, email: 'mutale@example.invalid', fullName: 'Mutale Banda', role: 'ADMIN', userId: null },
      ]);
      expect(
        (
          await client.query(
            `SELECT to_regclass('public."customers_keycloakId_key"') AS customer_index,
                    to_regclass('public."staff_users_keycloakId_key"') AS staff_index`,
          )
        ).rows,
      ).toEqual([{ customer_index: null, staff_index: null }]);
      await expect(client.query(`SELECT "keycloakId" FROM customers`)).rejects.toMatchObject({ code: '42703' });
      await expect(client.query(`SELECT "keycloakId" FROM staff_users`)).rejects.toMatchObject({ code: '42703' });
    });
  });
});

describe('0004_payment_rtsa_fee', () => {
  it('defaults the fee to zero for existing payments and enforces the ngwee money bounds', async () => {
    const db = await scratch(async (client) => {
      await buildPrismaEraDatabase(client, { data: true });
      await applyMigration(client, 1);
      await applyMigration(client, 2);
      await applyMigration(client, 3);
    });

    await query(db, async (client) => {
      await applyMigration(client, 4);

      expect(
        (await client.query(`SELECT "rtsaAnniversaryFeeMinor"::text AS fee FROM payments ORDER BY id`)).rows,
      ).toEqual([{ fee: '0' }]);

      const setFee = (fee: bigint) =>
        client.query(`UPDATE payments SET "rtsaAnniversaryFeeMinor" = $1`, [fee.toString()]);
      await expect(setFee(-1n)).rejects.toMatchObject({
        code: '23514',
        constraint: 'payments_rtsaAnniversaryFeeMinor_check',
      });
      expect((await setFee(MAX_NGWEE)).rowCount).toBe(1);
      await expect(setFee(MAX_NGWEE + 1n)).rejects.toMatchObject({
        code: '23514',
        constraint: 'payments_rtsaAnniversaryFeeMinor_check',
      });
    });
  });
});

describe('0005_vehicle_per_request', () => {
  it('gives every historical quote request its own vehicle, follows linked policies, and is replay-safe', async () => {
    const originalVehicleId = '00000000-0000-4000-8000-000000000021';
    const db = await scratch(async (client) => {
      await buildPrismaEraDatabase(client, { data: true });
      await applyMigration(client, 1);
      await applyMigration(client, 2);
      await applyMigration(client, 3);
      await applyMigration(client, 4);

      // The fixture's first policy now represents a policy made from QR-2. The
      // second policy has no originating quote request and must stay untouched.
      await client.query(`UPDATE policies SET "quoteRequestId" = 'QR-2' WHERE "policyNumber" = 'POL-1'`);
      await client.query(
        `INSERT INTO payments
           (id, "transactionId", method, "amountMinor", "idempotencyKey", "customerId", "quoteRequestId", "insurerQuoteId", "updatedAt")
         VALUES
           ('00000000-0000-4000-8000-000000000052', 'TX-2', 'CARD', 100550, 'key-2',
            '00000000-0000-4000-8000-000000000001', 'QR-2', '00000000-0000-4000-8000-000000000042', now())`,
      );
      await client.query(
        `INSERT INTO policies
           ("policyNumber", "insurerId", "customerId", "vehicleId", coverage, "premiumMinor", "paymentId", "updatedAt")
         VALUES
           ('POL-WITHOUT-REQUEST', '00000000-0000-4000-8000-000000000011',
            '00000000-0000-4000-8000-000000000001', $1, 'Comprehensive', 100550,
            '00000000-0000-4000-8000-000000000052', now())`,
        [originalVehicleId],
      );
    });

    await query(db, async (client) => {
      const { rows: [original] } = await client.query<{ snapshot: Record<string, unknown> }>(
        `SELECT to_jsonb(v) - 'id' AS snapshot FROM vehicles v WHERE id = $1`,
        [originalVehicleId],
      );

      await applyMigration(client, 5);

      const { rows: requests } = await client.query<{ id: string; vehicleId: string; snapshot: Record<string, unknown> }>(
        `SELECT qr.id, qr."vehicleId", to_jsonb(v) - 'id' AS snapshot
         FROM quote_requests qr
         INNER JOIN vehicles v ON v.id = qr."vehicleId"
         ORDER BY qr.id`,
      );
      expect(requests.map(({ id }) => id)).toEqual(['QR-1', 'QR-2', 'QR-3']);
      expect(requests[0].vehicleId).toBe(originalVehicleId);
      expect(new Set(requests.map(({ vehicleId }) => vehicleId)).size).toBe(3);
      expect(requests.map(({ snapshot }) => snapshot)).toEqual([original.snapshot, original.snapshot, original.snapshot]);

      const vehicleForRequest = new Map(requests.map(({ id, vehicleId }) => [id, vehicleId]));
      expect(
        (
          await client.query(
            `SELECT "policyNumber", "quoteRequestId", "vehicleId"
             FROM policies WHERE "policyNumber" IN ('POL-1', 'POL-WITHOUT-REQUEST') ORDER BY "policyNumber"`,
          )
        ).rows,
      ).toEqual([
        { policyNumber: 'POL-1', quoteRequestId: 'QR-2', vehicleId: vehicleForRequest.get('QR-2') },
        { policyNumber: 'POL-WITHOUT-REQUEST', quoteRequestId: null, vehicleId: originalVehicleId },
      ]);

      const afterFirstRun = await databaseState(client);
      await applyMigration(client, 5);
      expect(await databaseState(client)).toEqual(afterFirstRun);
    });
  });
});

describe('0008_audit_trail_state_history', () => {
  it('makes audit evidence append-only while retaining its searchable state history', async () => {
    const db = await scratch((client) => applyMigrationFiles(client, TAGS.length));

    await query(db, async (client) => {
      const id = randomUUID();
      await client.query(
        `INSERT INTO audit_logs (id, "actorType", action, "entityType", "entityId")
         VALUES ($1, 'SYSTEM', 'test.created', 'TEST', 'record-1')`,
        [id],
      );
      await expect(client.query(`UPDATE audit_logs SET action = 'test.updated' WHERE id = $1`, [id]))
        .rejects.toMatchObject({ message: expect.stringContaining('audit_logs is append-only') });
      await expect(client.query(`DELETE FROM audit_logs WHERE id = $1`, [id]))
        .rejects.toMatchObject({ message: expect.stringContaining('audit_logs is append-only') });

      await client.query(
        `INSERT INTO state_history (id, "entityType", "entityId", "fromStatus", "toStatus", "actorType")
         VALUES ($1, 'POLICY', 'POL-1', 'AWAITING_INSURER_CERTIFICATE', 'ACTIVE', 'INSURER')`,
        [randomUUID()],
      );
      expect((await client.query(`SELECT "toStatus" FROM state_history WHERE "entityId" = 'POL-1'`)).rows)
        .toEqual([{ toStatus: 'ACTIVE' }]);
    });
  });
});

describe('0009_documents_scanning_and_retention', () => {
  it('leaves existing documents unscanned, classifies them by kind and scans nothing retrospectively', async () => {
    // Applied up to the migration before scanning, so the rows exist without it.
    // Counted from 0009's own position rather than from the end of TAGS, so a
    // later migration does not silently change which one this test runs against.
    const db = await scratch((client) => applyMigrationFiles(client, SCANNING));

    await query(db, async (client) => {
      const kinds = ['QUOTATION', 'WHITE_BOOK', 'INSPECTION_PHOTO', 'CERTIFICATE', 'CLAIM_ATTACHMENT', 'NCD_EVIDENCE', 'INSURER_LOGO'];
      for (const kind of kinds) {
        await client.query(
          `INSERT INTO documents (id, kind, "fileName", "mimeType", "sizeBytes", "storageKey")
           VALUES ($1, $2, 'legacy.pdf', 'application/pdf', 10, $3)`,
          [randomUUID(), kind, `legacy/${kind}`],
        );
      }
      await applyMigration(client, SCANNING);

      const { rows } = await client.query<{ kind: string; scanStatus: string; retentionClass: string; scannedAt: Date | null; scannerName: string | null }>(
        `SELECT kind, "scanStatus", "retentionClass", "scannedAt", "scannerName" FROM documents ORDER BY kind::text`,
      );
      expect(rows).toEqual(
        [
          ['CERTIFICATE', 'POLICY_EVIDENCE'],
          ['CLAIM_ATTACHMENT', 'CLAIM_EVIDENCE'],
          ['INSPECTION_PHOTO', 'UNDERWRITING_EVIDENCE'],
          ['INSURER_LOGO', 'BRAND_ASSET'],
          ['NCD_EVIDENCE', 'CLAIM_EVIDENCE'],
          ['QUOTATION', 'UNDERWRITING_EVIDENCE'],
          ['WHITE_BOOK', 'UNDERWRITING_EVIDENCE'],
        ].map(([kind, retentionClass]) => ({
          kind,
          retentionClass,
          scanStatus: 'UNSCANNED',
          scannedAt: null,
          scannerName: null,
        })),
      );
    });
  });

  it('refuses a document stored without a retention class', async () => {
    const db = await scratch((client) => applyMigrationFiles(client, TAGS.length));

    await query(db, async (client) => {
      await expect(
        client.query(
          `INSERT INTO documents (id, kind, "fileName", "mimeType", "sizeBytes", "storageKey")
           VALUES ($1, 'QUOTATION', 'q.pdf', 'application/pdf', 10, 'k/q.pdf')`,
          [randomUUID()],
        ),
      ).rejects.toMatchObject({ message: expect.stringContaining('retentionClass') });
    });
  });
});

describe('drizzle-kit', () => {
  it('generate finds no difference between src/db/schema.ts and the migrations', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'insurshield-generate-'));
    try {
      await cp(DRIZZLE_FOLDER, join(dir, 'drizzle'), { recursive: true });
      await writeFile(
        join(dir, 'drizzle.config.mjs'),
        `export default ${JSON.stringify({ dialect: 'postgresql', schema: SCHEMA, out: './drizzle' })};\n`,
      );
      const output = await drizzleKit(['generate', '--config', 'drizzle.config.mjs'], { cwd: dir });

      expect(output).toContain('No schema changes');
      expect(await readdir(join(dir, 'drizzle'))).toEqual(await readdir(DRIZZLE_FOLDER));
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
    // Eight more than the pre-Batch 7 baseline: the staff-team created and
    // updated timestamps, the onboarding record's approvedAt plus evidence
    // reviewedAt, createdAt and updatedAt, and suspension marks on recipients
    // and quotes. Effective, renewal and expiry columns are `date`, so they
    // are deliberately omitted.
    // Approval requests add created, updated, expiry, decision and execution instants.
    // Staff MFA adds a lock instant; support-reset attempts add created,
    // delivered and failed instants.
    expect(timestampColumns).toHaveLength(104);
    for (const column of timestampColumns) {
      expect(column, column.name).toMatchObject({ type: 'timestamp with time zone', precision: 3 });
    }
    expect(columns.filter((column) => column.type === 'numeric')).toEqual([]);
    for (const { table, renamedTo, max } of CONVERTED_COLUMNS) {
      const column = columns.find((candidate) => candidate.name === `${table}.${renamedTo}`);
      expect(column?.type, `${table}.${renamedTo}`).toBe(max === MAX_NGWEE ? 'bigint' : 'integer');
    }
    expect(columns.find((column) => column.name === 'payments.rtsaAnniversaryFeeMinor')).toMatchObject({
      type: 'bigint',
    });
  });

  it('refuses an amount or rate outside its bounds in every converted column, and accepts each bound', async () => {
    const db = await scratch((client) => buildPrismaEraDatabase(client, { data: true }));
    await migrateDatabase(db.config);

    await query(db, async (client) => {
      for (const { table, renamedTo, min, max } of CONVERTED_COLUMNS) {
        const set = (value: bigint) => client.query(`UPDATE "${table}" SET "${renamedTo}" = $1`, [value.toString()]);
        await expect(set(min - 1n), `${table}.${renamedTo} below`).rejects.toMatchObject({ code: '23514' });
        await expect(set(max + 1n), `${table}.${renamedTo} above`).rejects.toMatchObject({ code: '23514' });
        expect((await set(max)).rowCount, `${table}.${renamedTo} at most`).toBeGreaterThan(0);
        expect((await set(min)).rowCount, `${table}.${renamedTo} at least`).toBeGreaterThan(0);
      }
    });
  });
});
