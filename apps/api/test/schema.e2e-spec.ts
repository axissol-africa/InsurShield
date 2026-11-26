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
/** The additive selected-product model begins at Batch 12. */
const PRODUCT_CHOICES = TAGS.findIndex((tag) => tag.startsWith('0028_'));

/** How many migrations precede 0033, which gives each chosen version its own state. */
const QUOTE_WORKFLOW = TAGS.findIndex((tag) => tag.startsWith('0033_'));

/** The migration that releases products held for an inspection. */
const OPTIONAL_INSPECTIONS = TAGS.findIndex((tag) => tag.startsWith('0037_'));

/** The batch 14 migration: real payment states, provider callbacks and reconciliation items. */
const PAYMENTS = TAGS.findIndex((tag) => tag.startsWith('0038_'));

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
  await query(db, applyProductSelectionIntegrityInvariants);
  await query(db, applyInternalNotesAppendOnlyInvariant);
  await query(db, applySettlementInvariants);
  await query(db, applyServiceRequestInvariants);
  await query(db, applyRetentionInvariants);
  await query(db, applyClaimInvariants);
  await query(db, applyNcdInvariants);
  await query(db, applyLaterInspectionInvariants);
  await query(db, applyReviewInvariants);
  await query(db, applyCertificateBadgeInvariants);
  return db;
}

async function applyCertificateBadgeInvariants(client: ClientBase) {
  const migration = await readFile(new URL('../drizzle/0051_batch_18_ratings_badges.sql', import.meta.url), 'utf8');
  const invariants = migration.slice(migration.indexOf('-- Certificate badge invariants begin'), migration.indexOf('-- Certificate badge invariants end'));
  for (const statement of invariants.split('--> statement-breakpoint')) {
    if (statement.trim()) await client.query(statement);
  }
}

async function applyReviewInvariants(client: ClientBase) {
  const migration = await readFile(new URL('../drizzle/0050_batch_17_verified_reviews.sql', import.meta.url), 'utf8');
  const invariants = migration.slice(migration.indexOf('-- Review decision invariants begin'), migration.indexOf('-- Review decision invariants end'));
  for (const statement of invariants.split('--> statement-breakpoint')) {
    if (statement.trim()) await client.query(statement);
  }
}

/** Later inspection report guards and evidence retention are SQL-only invariants. */
async function applyLaterInspectionInvariants(client: ClientBase) {
  const migration = await readFile(new URL('../drizzle/0049_batch_16_later_inspections.sql', import.meta.url), 'utf8');
  const invariants = migration.slice(migration.indexOf('-- Later inspection invariants begin'), migration.indexOf('-- Later inspection invariants end'));
  // The push schema already exposed this FK to 0046's reference-guard discovery.
  await client.query('DROP TRIGGER "retention_documentId" ON inspection_reports');
  for (const statement of invariants.split('--> statement-breakpoint')) {
    if (statement.trim()) await client.query(statement);
  }
}

/** The NCD migration adds holds and a reference guard after the table exists. */
async function applyNcdInvariants(client: ClientBase) {
  const migration = await readFile(new URL('../drizzle/0048_batch_16_ncd_evidence.sql', import.meta.url), 'utf8');
  const invariants = migration.slice(migration.indexOf('-- NCD retention invariants begin'), migration.indexOf('-- NCD retention invariants end'));
  // On a push-built schema, 0046's FK discovery already saw the NCD table.
  await client.query('DROP TRIGGER "retention_documentId" ON ncd_evidence');
  for (const statement of invariants.split('--> statement-breakpoint')) {
    if (statement.trim()) await client.query(statement);
  }
}

/** The new retention rules and claim history invariants are expressed in SQL. */
async function applyClaimInvariants(client: ClientBase) {
  const migration = await readFile(new URL('../drizzle/0047_batch_16_claim_lifecycle.sql', import.meta.url), 'utf8');
  const invariants = migration.slice(migration.indexOf('-- Claim evidence remains held'), migration.indexOf('-- Claim update notification templates'));
  for (const statement of invariants.split('--> statement-breakpoint')) {
    if (statement.trim()) await client.query(statement);
  }
}

/** Retention fences live in SQL; Drizzle supplies their columns and partial index. */
async function applyRetentionInvariants(client: ClientBase) {
  const migration = await readFile(new URL('../drizzle/0046_batch_15_retention_fences.sql', import.meta.url), 'utf8');
  const invariants = migration.slice(migration.indexOf('CREATE FUNCTION public.retention_customer_held'), migration.indexOf('CREATE INDEX "documents_pending_deletion_idx"'));
  for (const statement of invariants.split('--> statement-breakpoint')) {
    if (statement.trim()) await client.query(statement);
  }
}

/** The append-only trigger on service request updates, read from migration 0044 itself. */
async function applyServiceRequestInvariants(client: ClientBase) {
  const migration = await readFile(new URL('../drizzle/0044_batch_15_service_requests.sql', import.meta.url), 'utf8');
  const triggers = migration.slice(migration.indexOf('-- What was said on a service request is never rewritten'));
  for (const statement of triggers.split('--> statement-breakpoint')) {
    if (statement.trim()) await client.query(statement);
  }
}

/** The settlement and adjustment triggers, read from migration 0041 itself so the two cannot drift. */
async function applySettlementInvariants(client: ClientBase) {
  const migration = await readFile(new URL('../drizzle/0041_batch_14_settlements.sql', import.meta.url), 'utf8');
  const triggers = migration.slice(migration.indexOf('-- A finalised settlement and its lines never change'));
  for (const statement of triggers.split('--> statement-breakpoint')) {
    if (statement.trim()) await client.query(statement);
  }
}

async function applyInternalNotesAppendOnlyInvariant(client: ClientBase) {
  // Byte-for-byte the definition in migration 0033.
  await client.query(`CREATE OR REPLACE FUNCTION "quote_internal_notes_reject_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'quote_internal_notes is append-only' USING ERRCODE = '55000';
END;
$$;`);
  await client.query(`CREATE TRIGGER "quote_internal_notes_append_only"
BEFORE UPDATE OR DELETE ON "quote_internal_notes"
FOR EACH ROW EXECUTE FUNCTION "quote_internal_notes_reject_mutation"()`);
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

async function applyProductSelectionIntegrityInvariants(client: ClientBase) {
  // Drizzle deliberately does not infer cross-table guards. Keep these
  // definitions aligned with 0031 so a schema push receives the same tenant
  // and selected-version integrity guarantees as a migration-built database.
  await client.query(`CREATE OR REPLACE FUNCTION public.enforce_quote_request_selection_insurer()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  owner_insurer_id uuid;
BEGIN
  SELECT product."insurerId"
    INTO owner_insurer_id
  FROM public.insurer_product_versions AS version
  INNER JOIN public.insurer_products AS product ON product.id = version."productId"
  WHERE version.id = NEW."productVersionId";

  IF owner_insurer_id IS NULL OR owner_insurer_id <> NEW."insurerId" THEN
    RAISE EXCEPTION 'quote_request_product_versions insurer must own product version'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;`);
  await client.query(`CREATE TRIGGER quote_request_selection_insurer_guard
BEFORE INSERT OR UPDATE OF "productVersionId", "insurerId"
ON public.quote_request_product_versions
FOR EACH ROW EXECUTE FUNCTION public.enforce_quote_request_selection_insurer();`);
  await client.query(`CREATE OR REPLACE FUNCTION public.enforce_insurer_quote_selected_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  request_model public."QuoteRequestModel";
BEGIN
  SELECT "model"
    INTO request_model
  FROM public.quote_requests
  WHERE id = NEW."quoteRequestId";

  IF request_model = 'PRODUCT_SELECTION' THEN
    IF NEW."productVersionId" IS NULL OR NOT EXISTS (
      SELECT 1
      FROM public.quote_request_product_versions AS selection
      WHERE selection."quoteRequestId" = NEW."quoteRequestId"
        AND selection."productVersionId" = NEW."productVersionId"
        AND selection."insurerId" = NEW."insurerId"
    ) THEN
      RAISE EXCEPTION 'product-selection quote must reference its selected version and insurer'
        USING ERRCODE = '23514';
    END IF;
  ELSIF request_model = 'LEGACY' AND NEW."productVersionId" IS NOT NULL THEN
    RAISE EXCEPTION 'legacy quote cannot reference a product version'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;`);
  await client.query(`CREATE TRIGGER insurer_quote_selected_version_guard
BEFORE INSERT OR UPDATE OF "quoteRequestId", "insurerId", "productVersionId"
ON public.insurer_quotes
FOR EACH ROW EXECUTE FUNCTION public.enforce_insurer_quote_selected_version();`);
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

describe('0028_batch_12_product_choice_request_model', () => {
  it('keeps historical insurer-level quotes readable while allowing two selected versions from one insurer', async () => {
    const db = await scratch(async (client) => {
      await buildPrismaEraDatabase(client, { data: true });
      // The Prisma-era fixture already represents the pre-Drizzle baseline,
      // so replay only the later migrations before exercising Batch 12.
      for (let index = 1; index < PRODUCT_CHOICES; index += 1) {
        await applyMigration(client, index);
      }
    });

    await query(db, async (client) => {
      await applyMigration(client, PRODUCT_CHOICES);

      expect(
        (
          await client.query(
            `SELECT "productVersionId" FROM insurer_quotes WHERE id = '00000000-0000-4000-8000-000000000041'`,
          )
        ).rows,
      ).toEqual([{ productVersionId: null }]);

      const insurerId = '00000000-0000-4000-8000-000000000011';
      const staffId = '00000000-0000-4000-8000-000000000002';
      const productId = randomUUID();
      const firstVersionId = randomUUID();
      const secondVersionId = randomUUID();
      await client.query(
        `INSERT INTO insurer_products (id, "insurerId", code, "coverType", "updatedAt")
         VALUES ($1, $2, 'B12-COMP', 'COMPREHENSIVE', CURRENT_TIMESTAMP)`,
        [productId, insurerId],
      );
      for (const [id, versionNumber] of [[firstVersionId, 1], [secondVersionId, 2]] as const) {
        await client.query(
          `INSERT INTO insurer_product_versions
             (id, "productId", "versionNumber", status, name, "coverType", "coverGuide", "inspectionRule", "rateBps", "effectiveFrom", "createdByStaffId", "updatedAt")
           VALUES ($1, $2, $3, 'APPROVED', 'Batch 12 comprehensive', 'COMPREHENSIVE', '{}'::jsonb, 'NOT_REQUIRED', 500, '2026-01-01', $4, CURRENT_TIMESTAMP)`,
          [id, productId, versionNumber, staffId],
        );
      }

      const addDocument = async (name: string) => {
        const id = randomUUID();
        await client.query(
          `INSERT INTO documents (id, kind, "fileName", "mimeType", "sizeBytes", "storageKey", "retentionClass")
           VALUES ($1, 'QUOTATION', $2, 'application/pdf', 10, $3, 'UNDERWRITING_EVIDENCE')`,
          [id, name, `batch-12/${name}`],
        );
        return id;
      };

      for (const versionId of [firstVersionId, secondVersionId]) {
        await client.query(
          `INSERT INTO quote_request_product_versions (id, "quoteRequestId", "productVersionId")
           VALUES ($1, 'QR-1', $2)`,
          [randomUUID(), versionId],
        );
      }
      await expect(
        client.query(
          `INSERT INTO quote_request_product_versions (id, "quoteRequestId", "productVersionId")
           VALUES ($1, 'QR-1', $2)`,
          [randomUUID(), firstVersionId],
        ),
      ).rejects.toMatchObject({
        code: '23505',
        constraint: 'quote_request_product_versions_request_version_key',
      });

      for (const versionId of [firstVersionId, secondVersionId]) {
        await client.query(
          `INSERT INTO insurer_quotes
             (id, "quoteRequestId", "insurerId", "productVersionId", "premiumMinor", "insurerReference", "validityDays", "validUntil", "documentId")
           VALUES ($1, 'QR-1', $2, $3, 50000, 'shared-reference', 14, CURRENT_TIMESTAMP + interval '14 days', $4)`,
          [randomUUID(), insurerId, versionId, await addDocument(`${versionId}.pdf`)],
        );
      }
      await expect(
        client.query(
          `INSERT INTO insurer_quotes
             (id, "quoteRequestId", "insurerId", "productVersionId", "premiumMinor", "validityDays", "validUntil", "documentId")
           VALUES ($1, 'QR-1', $2, $3, 50000, 14, CURRENT_TIMESTAMP + interval '14 days', $4)`,
          [randomUUID(), insurerId, firstVersionId, await addDocument('duplicate-version.pdf')],
        ),
      ).rejects.toMatchObject({ code: '23505', constraint: 'insurer_quotes_request_product_version_key' });
      await expect(
        client.query(
          `INSERT INTO insurer_quotes
             (id, "quoteRequestId", "insurerId", "premiumMinor", "validityDays", "validUntil", "documentId")
           VALUES ($1, 'QR-1', $2, 50000, 14, CURRENT_TIMESTAMP + interval '14 days', $3)`,
          [randomUUID(), insurerId, await addDocument('duplicate-legacy.pdf')],
        ),
      ).rejects.toMatchObject({ code: '23505', constraint: 'insurer_quotes_legacy_request_insurer_key' });
    });
  });
});

describe('0030_batch_12_quote_request_drafts', () => {
  it('limits selections and removes draft-only document references with the expired draft', async () => {
    const db = await scratch((client) => applyMigrationFiles(client));
    await query(db, async (client) => {
      const customerId = randomUUID();
      const documentId = randomUUID();
      const draftId = randomUUID();
      await client.query(
        `INSERT INTO customers (id, "fullName", email, phone, "updatedAt")
         VALUES ($1, 'Draft Customer', $2, $3, CURRENT_TIMESTAMP)`,
        [customerId, `draft-${customerId}@example.invalid`, `+260${Date.now()}`],
      );
      await client.query(
        `INSERT INTO documents (id, kind, "fileName", "mimeType", "sizeBytes", "storageKey", "retentionClass")
         VALUES ($1, 'WHITE_BOOK', 'white-book.pdf', 'application/pdf', 10, $2, 'UNDERWRITING_EVIDENCE')`,
        [documentId, `draft-schema/${documentId}`],
      );
      await client.query(
        `INSERT INTO quote_request_drafts (id, "customerId", "commonAnswers", "selectedProductVersionIds", "configurableAnswers", "expiresAt", "updatedAt")
         VALUES ($1, $2, '{}'::jsonb, '{}'::uuid[], '{}'::jsonb, CURRENT_TIMESTAMP + interval '30 days', CURRENT_TIMESTAMP)`,
        [draftId, customerId],
      );
      await client.query(
        `INSERT INTO quote_request_draft_documents (id, "quoteRequestDraftId", slot, kind, "documentId")
         VALUES ($1, $2, 'white-book', 'WHITE_BOOK', $3)`,
        [randomUUID(), draftId, documentId],
      );
      await client.query(`DELETE FROM quote_request_drafts WHERE id = $1`, [draftId]);
      const references = await client.query(
        `SELECT 1 FROM quote_request_draft_documents WHERE "quoteRequestDraftId" = $1`,
        [draftId],
      );
      expect(references.rows).toEqual([]);

      await expect(
        client.query(
          `INSERT INTO quote_request_drafts (id, "customerId", "commonAnswers", "selectedProductVersionIds", "configurableAnswers", "expiresAt", "updatedAt")
           VALUES ($1, $2, '{}'::jsonb, ARRAY[$3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::uuid, $8::uuid], '{}'::jsonb, CURRENT_TIMESTAMP + interval '30 days', CURRENT_TIMESTAMP)`,
          [randomUUID(), customerId, randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()],
        ),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'quote_request_drafts_selected_products_limit_check',
      });
    });
  });
});

describe('0033_batch_13_quote_workflow', () => {
  it('gives each existing chosen version the state its facts already say, and keeps internal notes append-only', async () => {
    const db = await scratch(async (client) => {
      await buildPrismaEraDatabase(client, { data: true });
      for (let index = 1; index < QUOTE_WORKFLOW; index += 1) await applyMigration(client, index);
    });

    const insurerId = '00000000-0000-4000-8000-000000000011';
    const staffId = '00000000-0000-4000-8000-000000000002';
    const versions = {
      quoted: randomUUID(),
      cancelledUnquoted: randomUUID(),
      cancelledWithUnpaidQuote: randomUUID(),
      inspectionFirst: randomUUID(),
      waiting: randomUUID(),
    };

    await query(db, async (client) => {
      // Only a product-selection request may carry quotes for chosen versions.
      await client.query(`UPDATE quote_requests SET model = 'PRODUCT_SELECTION' WHERE id = 'QR-1'`);
      const productId = randomUUID();
      await client.query(
        `INSERT INTO insurer_products (id, "insurerId", code, "coverType", "updatedAt")
         VALUES ($1, $2, 'B13-COMP', 'COMPREHENSIVE', CURRENT_TIMESTAMP)`,
        [productId, insurerId],
      );
      let number = 0;
      for (const [name, versionId] of Object.entries(versions)) {
        number += 1;
        const inspectionFirst = name === 'inspectionFirst';
        await client.query(
          `INSERT INTO insurer_product_versions
             (id, "productId", "versionNumber", status, name, "coverType", "coverGuide", "inspectionRule", "inspectionTiming", "inspectionMethod", "rateBps", "effectiveFrom", "createdByStaffId", "updatedAt")
           VALUES ($1, $2, $3, 'APPROVED', $4, 'COMPREHENSIVE', '{}'::jsonb, $5, $6, $7, 500, '2026-01-01', $8, CURRENT_TIMESTAMP)`,
          [
            versionId, productId, number, name,
            inspectionFirst ? 'REQUIRED' : 'NOT_REQUIRED',
            inspectionFirst ? 'BEFORE_QUOTATION' : null,
            inspectionFirst ? 'PHYSICAL' : null,
            staffId,
          ],
        );
        const cancelled = name.startsWith('cancelled');
        await client.query(
          `INSERT INTO quote_request_product_versions
             (id, "quoteRequestId", "productVersionId", "insurerId", "productCode", "productVersionNumber", "productName", "coverType", "coverGuide", "inspectionRule", "inspectionTiming", "inspectionMethod", "cancelledAt", "cancelledReason")
           VALUES ($1, 'QR-1', $2, $3, 'B13-COMP', $4, $5, 'COMPREHENSIVE', '{}'::jsonb, $6, $7, $8, $9, $10)`,
          [
            randomUUID(), versionId, insurerId, number, name,
            inspectionFirst ? 'REQUIRED' : 'NOT_REQUIRED',
            inspectionFirst ? 'BEFORE_QUOTATION' : null,
            inspectionFirst ? 'PHYSICAL' : null,
            cancelled ? '2026-10-01T00:00:00Z' : null,
            cancelled ? 'INSURER_SUSPENDED' : null,
          ],
        );
        if (name === 'quoted' || name === 'cancelledWithUnpaidQuote') {
          const documentId = randomUUID();
          await client.query(
            `INSERT INTO documents (id, kind, "fileName", "mimeType", "sizeBytes", "storageKey", "retentionClass")
             VALUES ($1, 'QUOTATION', 'quote.pdf', 'application/pdf', 10, $2, 'UNDERWRITING_EVIDENCE')`,
            [documentId, `batch-13/${documentId}`],
          );
          await client.query(
            `INSERT INTO insurer_quotes
               (id, "quoteRequestId", "insurerId", "productVersionId", "premiumMinor", "validityDays", "sentAt", "validUntil", "documentId")
             VALUES ($1, 'QR-1', $2, $3, 50000, 14, '2026-09-20T08:00:00Z', '2026-10-04T08:00:00Z', $4)`,
            [randomUUID(), insurerId, versionId, documentId],
          );
        }
      }

      await applyMigration(client, QUOTE_WORKFLOW);

      const { rows } = await client.query<{ name: string; status: string; paused: boolean; due: boolean; changed: string }>(
        `SELECT v."productName" AS name, v.status, v."pausedAt" IS NOT NULL AS paused,
                v."replyDueAt" = r."expiresAt" AS due, to_char(v."statusChangedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS changed
         FROM quote_request_product_versions v JOIN quote_requests r ON r.id = v."quoteRequestId"
         ORDER BY v."productVersionNumber"`,
      );
      expect(rows).toEqual([
        { name: 'quoted', status: 'QUOTED', paused: false, due: true, changed: '2026-09-20' },
        { name: 'cancelledUnquoted', status: 'CANCELLED', paused: false, due: true, changed: '2026-10-01' },
        { name: 'cancelledWithUnpaidQuote', status: 'CANCELLED', paused: false, due: true, changed: '2026-10-01' },
        { name: 'inspectionFirst', status: 'INSPECTION_REQUIRED', paused: true, due: true, changed: expect.any(String) },
        { name: 'waiting', status: 'SUBMITTED', paused: false, due: true, changed: expect.any(String) },
      ]);

      await expect(
        client.query(
          `UPDATE quote_request_product_versions SET status = 'DECLINED' WHERE "productVersionId" = $1`,
          [versions.waiting],
        ),
      ).rejects.toMatchObject({ code: '23514', constraint: 'quote_request_product_versions_decline_check' });

      const noteId = randomUUID();
      await client.query(
        `INSERT INTO quote_internal_notes (id, "quoteRequestId", "productVersionId", "insurerId", "authorStaffId", body)
         VALUES ($1, 'QR-1', $2, $3, $4, 'Checked the white book.')`,
        [noteId, versions.waiting, insurerId, staffId],
      );
      await expect(client.query(`UPDATE quote_internal_notes SET body = 'changed' WHERE id = $1`, [noteId]))
        .rejects.toMatchObject({ message: expect.stringContaining('quote_internal_notes is append-only') });
      await expect(client.query(`DELETE FROM quote_internal_notes WHERE id = $1`, [noteId]))
        .rejects.toMatchObject({ message: expect.stringContaining('quote_internal_notes is append-only') });

      await client.query(
        `INSERT INTO quote_information_requests (id, "quoteRequestId", "productVersionId", "insurerId", message, "dueAt")
         VALUES ($1, 'QR-1', $2, $3, 'Send the white book.', CURRENT_TIMESTAMP + interval '3 days')`,
        [randomUUID(), versions.waiting, insurerId],
      );
      await expect(
        client.query(
          `INSERT INTO quote_information_requests (id, "quoteRequestId", "productVersionId", "insurerId", message, "dueAt")
           VALUES ($1, 'QR-1', $2, $3, 'And the licence.', CURRENT_TIMESTAMP + interval '3 days')`,
          [randomUUID(), versions.waiting, insurerId],
        ),
      ).rejects.toMatchObject({ code: '23505', constraint: 'quote_information_requests_open_key' });

      // 0037 makes inspections optional: a product held for one goes back to waiting for its insurer.
      for (let index = QUOTE_WORKFLOW + 1; index <= OPTIONAL_INSPECTIONS; index += 1) await applyMigration(client, index);
      const { rows: released } = await client.query<{ status: string; paused: boolean }>(
        `SELECT status, "pausedAt" IS NOT NULL AS paused FROM quote_request_product_versions WHERE "productName" = 'inspectionFirst'`,
      );
      expect(released).toEqual([{ status: 'SUBMITTED', paused: false }]);
    });
  });
});

describe('0038_batch_14_payments', () => {
  it('keeps existing payments confirmed with their breakdown, and allows one open and one confirmed payment per request', async () => {
    const db = await scratch(async (client) => {
      await buildPrismaEraDatabase(client, { data: true });
      for (let index = 1; index < PAYMENTS; index += 1) await applyMigration(client, index);
    });

    await query(db, async (client) => {
      await client.query(`UPDATE payments SET status = 'CONFIRMED', "rtsaAnniversaryFeeMinor" = 2500, "amountMinor" = "amountMinor" + 2500`);
      const legacyPending = randomUUID();
      await client.query(
        `INSERT INTO payments (id, "transactionId", status, method, "amountMinor", "idempotencyKey", "customerId", "quoteRequestId", "insurerQuoteId", "updatedAt")
         SELECT $1, 'TXN-LEGACY', 'PENDING', method, 100, 'legacy-key', "customerId", "quoteRequestId", "insurerQuoteId", CURRENT_TIMESTAMP FROM payments`,
        [legacyPending],
      );
      await applyMigration(client, PAYMENTS);

      // Nothing was ever sent to a provider before this batch, so an old pending payment cannot complete.
      expect((await client.query(`SELECT status, "failureCode" FROM payments WHERE id = $1`, [legacyPending])).rows).toEqual([
        { status: 'EXPIRED', failureCode: 'NEVER_SENT' },
      ]);

      const { rows: [paid] } = await client.query(
        `SELECT p.status, p.provider, p."amountMinor"::int AS amount, p."amountBreakdown" AS lines,
                p."initiatedAt" = p."createdAt" AS initiated, p."quoteRequestId", p."customerId", p."insurerQuoteId", p.method
         FROM payments p WHERE p."transactionId" <> 'TXN-LEGACY'`,
      );
      expect(paid).toMatchObject({ status: 'CONFIRMED', provider: 'STAND_IN', initiated: true });
      expect(paid.lines).toEqual([
        { kind: 'PREMIUM', code: 'PREMIUM', label: 'Premium', amountMinor: paid.amount - 2500 },
        { kind: 'CHARGE', code: 'RTSA_ANNIVERSARY_FEE', label: 'RTSA anniversary fee', amountMinor: 2500 },
      ]);

      const attempt = (status: string) =>
        client.query(
          `INSERT INTO payments (id, "transactionId", status, method, "amountMinor", "idempotencyKey", "customerId", "quoteRequestId", "insurerQuoteId", "updatedAt")
           VALUES ($1, $2, $3, $4, 100, $5, $6, $7, $8, CURRENT_TIMESTAMP)`,
          [randomUUID(), `TXN-${randomUUID()}`, status, paid.method, randomUUID(), paid.customerId, paid.quoteRequestId, paid.insurerQuoteId],
        );
      await expect(attempt('CONFIRMED')).rejects.toMatchObject({ code: '23505', constraint: 'payments_quoteRequestId_confirmed_key' });
      await attempt('INITIATED');
      await expect(attempt('PENDING')).rejects.toMatchObject({ code: '23505', constraint: 'payments_quoteRequestId_open_key' });
      await attempt('FAILED');
      await attempt('EXPIRED');

      await expect(
        client.query(
          `INSERT INTO reconciliation_items (id, kind, status, reason, "updatedAt") VALUES ($1, 'REVERSAL', 'RESOLVED', 'x', CURRENT_TIMESTAMP)`,
          [randomUUID()],
        ),
      ).rejects.toMatchObject({ code: '23514', constraint: 'reconciliation_items_resolution_check' });
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
    // delivered and failed instants. Versioned products add their workflow
    // timestamps, and Batch 10 adds rule confirmation plus taxonomy and
    // product-term mapping history. Batch 11 adds delivery processing,
    // acknowledgement and resolution instants plus the callback receipt time.
    // Batch 12 adds the selected-product and cancellation timestamps, three
    // draft timestamps plus its document timestamp, and four timestamps for
    // insurer-defined product requirements and the customer's answers.
    // Effective dates remain `date` values. Batch 13 adds eight: the chosen
    // version's state change, reply due date and pause, the information
    // request's four, and the internal note's creation; its second part adds
    // when a product was assigned and when its owner was warned, and then
    // when a quote was withdrawn and when the customer chose one, and
    // finally when an inspection was decided.
    // Batch 15 adds account anonymisation and the two document deletion instants.
    // Batch 16 adds claim history, NCD declaration acceptance, code revocation and evidence creation.
    // Later inspection reports add their creation instant.
    // Reviews, appeals and insurer profile revisions add 13 instants.
    // Certificate badge snapshots and suspension state add six instants.
    expect(timestampColumns).toHaveLength(206);
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
