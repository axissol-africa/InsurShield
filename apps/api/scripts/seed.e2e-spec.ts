import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { eq, inArray } from 'drizzle-orm';
import { escapeIdentifier, Pool, type ClientBase } from 'pg';
import { createDatabase, type Database } from '../src/db/database.module.js';
import { migrateDatabase } from '../src/db/migrator.js';
import * as schema from '../src/db/schema.js';
import { PaymentsRepository } from '../src/payments/payments.repository.js';
import { createScratchDatabase, type ScratchDatabase } from '../test/scratch-database.js';
import type { KeycloakAdmin, SeedUser } from './keycloak-admin.js';
import { INSURERS } from './reference-data.js';
import { seedDatabase, type SeedOptions } from './seed-database.js';

const API_ROOT = fileURLToPath(new URL('../', import.meta.url));
const SEEDED_CODES = INSURERS.flatMap((insurer) => insurer.ncdCodes.map((ncd) => ncd.code));

class FakeKeycloak implements KeycloakAdmin {
  readonly users: SeedUser[] = [];

  async upsertUser(user: SeedUser): Promise<string> {
    this.users.push(user);
    return `kc-${user.email}`;
  }
}

let scratch: ScratchDatabase;
let pool: Pool;
let db: Database;

beforeEach(async () => {
  scratch = await createScratchDatabase('seed');
  await migrateDatabase(scratch.config);
  pool = new Pool({ connectionString: scratch.url, max: 2 });
  db = createDatabase(pool, { schema });
});

afterEach(async () => {
  await pool.end();
  await scratch.drop();
});

const options = (overrides: Partial<SeedOptions> = {}): SeedOptions => ({
  staff: { keycloak: new FakeKeycloak(), password: 'a-local-password' },
  demoData: true,
  resetDemo: false,
  log: () => {},
  ...overrides,
});

async function query<T>(run: (client: ClientBase) => Promise<T>): Promise<T> {
  const client = await scratch.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

// updatedAt records when a row was last written, which an upsert does by design.
async function tableRows(client: ClientBase): Promise<Record<string, string>> {
  const { rows: tables } = await client.query<{ name: string }>(
    `SELECT tablename AS name FROM pg_catalog.pg_tables WHERE schemaname = 'public' ORDER BY 1`,
  );
  const state: Record<string, string> = {};
  for (const { name } of tables) {
    const { rows } = await client.query<{ rows: string }>(
      `SELECT coalesce(string_agg((to_jsonb(t) - 'updatedAt')::text, E'\\n' ORDER BY (to_jsonb(t) - 'updatedAt')::text), '') AS rows
       FROM public.${escapeIdentifier(name)} t`,
    );
    state[name] = rows[0].rows;
  }
  return state;
}

async function rowCounts(): Promise<Record<string, number>> {
  const state = await query(tableRows);
  return Object.fromEntries(
    Object.entries(state).map(([table, rows]) => [table, rows === '' ? 0 : rows.split('\n').length]),
  );
}

async function demoCustomerId(): Promise<string> {
  const [customer] = await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(eq(schema.customers.email, 'bwalya.mutale@example.zm'));
  return customer.id;
}

class RolledBack extends Error {}

async function redeemable(code: string, customerId: string): Promise<boolean> {
  const [ncd] = await db.select().from(schema.ncdCodes).where(eq(schema.ncdCodes.code, code));
  let redeemed = false;
  await db
    .transaction(async (tx) => {
      redeemed = await new PaymentsRepository(db).redeemNcdCode(
        tx,
        code,
        { insurerId: ncd.insurerId, customerId },
        new Date(),
      );
      throw new RolledBack();
    })
    .catch((error: unknown) => {
      if (!(error instanceof RolledBack)) throw error;
    });
  return redeemed;
}

describe('seed', () => {
  it('leaves every row as it was when it runs a second time on a freshly migrated database', async () => {
    await seedDatabase(db, options());
    const first = await query(tableRows);
    await seedDatabase(db, options());
    const second = await query(tableRows);

    expect(second).toEqual(first);
    expect(await rowCounts()).toMatchObject({
      pia_config: 1,
      insurers: 5,
      insurer_contacts: 5,
      ncd_codes: 5,
      staff_users: 6,
      customers: 1,
      vehicles: 2,
      quote_requests: 3,
      quote_request_recipients: 15,
      inspection_shots: 14,
      documents: 15,
      insurer_quotes: 1,
      payments: 1,
      policies: 1,
      claim_notifications: 2,
      ncd_applications: 7,
    });
  });

  it('issues every seeded NCD code on an approved application of the seeded customer, so a payment redeems it', async () => {
    await seedDatabase(db, options());
    const customerId = await demoCustomerId();

    const applications = await db
      .select({
        code: schema.ncdApplications.approvedCodeId,
        status: schema.ncdApplications.status,
        customerId: schema.ncdApplications.customerId,
        insurerId: schema.ncdApplications.insurerId,
        codeInsurerId: schema.ncdCodes.insurerId,
      })
      .from(schema.ncdApplications)
      .innerJoin(schema.ncdCodes, eq(schema.ncdCodes.code, schema.ncdApplications.approvedCodeId))
      .where(inArray(schema.ncdApplications.approvedCodeId, SEEDED_CODES));

    expect(applications).toHaveLength(SEEDED_CODES.length);
    expect(new Set(applications.map((application) => application.code))).toEqual(new Set(SEEDED_CODES));
    for (const application of applications) {
      expect(application).toMatchObject({ status: 'APPROVED', customerId, insurerId: application.codeInsurerId });
    }
    for (const code of SEEDED_CODES) {
      expect(await redeemable(code, customerId)).toBe(true);
    }
  });

  it('stores money in ngwee and rates in basis points', async () => {
    await seedDatabase(db, options());

    const [pia] = await db.select().from(schema.piaConfig);
    const [prestige] = await db.select().from(schema.insurers).where(eq(schema.insurers.name, 'Prestige Assurance'));
    const [request] = await db.select().from(schema.quoteRequests).where(eq(schema.quoteRequests.id, 'QR-DEMO-0001'));
    const [policy] = await db.select().from(schema.policies).where(eq(schema.policies.policyNumber, 'POL-DEMO-0003'));
    const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.transactionId, 'TXN-DEMO-0003'));
    const [claim] = await db
      .select()
      .from(schema.claimNotifications)
      .where(eq(schema.claimNotifications.claimNumber, 'CLM-DEMO-0001'));

    expect(pia.piaRateBps).toBe(400);
    expect(prestige.rateBps).toBe(450);
    expect(request.vehicleValueMinor).toBe(52_000_000);
    expect(policy.premiumMinor).toBe(1_200_000);
    expect(payment.amountMinor).toBe(1_200_000);
    expect(claim.estimatedLossMinor).toBe(1_850_000);
  });

  it('gives a redeemed seeded code back and recreates the demo records when asked to reset them', async () => {
    await seedDatabase(db, options());
    const customerId = await demoCustomerId();
    await db.update(schema.ncdCodes).set({ redeemedAt: new Date() }).where(eq(schema.ncdCodes.code, 'NCD-A1B2C'));
    await db.delete(schema.claimNotifications).where(eq(schema.claimNotifications.claimNumber, 'CLM-DEMO-0001'));
    const before = await rowCounts();

    await seedDatabase(db, options({ resetDemo: true }));

    expect(await redeemable('NCD-A1B2C', customerId)).toBe(true);
    expect(await rowCounts()).toEqual({ ...before, claim_notifications: 2 });
  });

  it('seeds only the reference data, twice alike, when the entry point runs without Keycloak', async () => {
    const run = () =>
      promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/seed.ts'], {
        cwd: API_ROOT,
        env: { ...process.env, DATABASE_URL: scratch.url, KEYCLOAK_CLIENT_SECRET: '' },
      });

    await run();
    const first = await query(tableRows);
    await run();

    expect(await query(tableRows)).toEqual(first);
    expect(await rowCounts()).toMatchObject({
      pia_config: 1,
      insurers: 5,
      insurer_contacts: 5,
      ncd_codes: 5,
      staff_users: 0,
      customers: 0,
    });
  });
});
