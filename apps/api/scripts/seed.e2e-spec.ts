import { eq, inArray, sql } from 'drizzle-orm';
import { escapeIdentifier, Pool, type ClientBase } from 'pg';
import { createAuth, type AuthSettings } from '../src/auth/auth.instance.js';
import {
  CREDENTIAL_PROVIDER,
  createCredentialUser,
} from '../src/auth/credential-user.js';
import { createDatabase, type Database } from '../src/db/database.module.js';
import { migrateDatabase } from '../src/db/migrator.js';
import * as schema from '../src/db/schema.js';
import { PaymentsRepository } from '../src/payments/payments.repository.js';
import {
  createScratchDatabase,
  type ScratchDatabase,
} from '../test/scratch-database.js';
import { DEMO_CUSTOMER } from './demo-data.js';
import { INSURERS, seedReferenceData } from './reference-data.js';
import { seedDatabase, type SeedOptions } from './seed-database.js';
import { MailFake } from '../test/mail-fake.js';

const SEEDED_CODES = INSURERS.flatMap((insurer) =>
  insurer.ncdCodes.map((ncd) => ncd.code),
);
const SEED_PASSWORD = 'a-local-password';
const AUTH_SETTINGS: AuthSettings = {
  NODE_ENV: 'test',
  API_PREFIX: 'api/v1',
  CORS_ORIGINS: ['http://localhost:5173'],
  BETTER_AUTH_SECRET: 'a-seed-test-secret-of-at-least-32-characters',
  BETTER_AUTH_URL: 'http://localhost:4000',
  AUTH_RATE_LIMIT: 'off',
};

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
  password: SEED_PASSWORD,
  resetPasswords: false,
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
    Object.entries(state).map(([table, rows]) => [
      table,
      rows === '' ? 0 : rows.split('\n').length,
    ]),
  );
}

async function demoCustomerId(): Promise<string> {
  const [customer] = await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(eq(schema.customers.email, 'bwalya.mutale@example.zm'));
  return customer.id;
}

async function assertSeededAccountCanSignIn(
  email: string,
  userId: string,
): Promise<void> {
  const [account] = await db
    .select({
      providerId: schema.authAccounts.providerId,
      accountId: schema.authAccounts.accountId,
      password: schema.authAccounts.password,
    })
    .from(schema.authAccounts)
    .where(eq(schema.authAccounts.userId, userId));
  expect(account).toMatchObject({
    providerId: CREDENTIAL_PROVIDER,
    accountId: userId,
  });
  expect(account.password).toEqual(expect.any(String));

  await expect(
    createAuth(db, AUTH_SETTINGS, new MailFake()).api.signInEmail({
      body: { email, password: SEED_PASSWORD },
      headers: new Headers({ Origin: AUTH_SETTINGS.CORS_ORIGINS[0] }),
    }),
  ).resolves.toMatchObject({ user: { email } });
}

class RolledBack extends Error {}

async function redeemable(code: string, customerId: string): Promise<boolean> {
  const [ncd] = await db
    .select()
    .from(schema.ncdCodes)
    .where(eq(schema.ncdCodes.code, code));
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
  it('creates the super admin, every insurer portal user and the demo customer with a working credential account', async () => {
    await seedDatabase(db, options());

    const staff = await db
      .select({
        email: schema.staffUsers.email,
        userId: schema.staffUsers.userId,
      })
      .from(schema.staffUsers);
    const [customer] = await db
      .select({
        email: schema.customers.email,
        userId: schema.customers.userId,
      })
      .from(schema.customers)
      .where(eq(schema.customers.email, DEMO_CUSTOMER.email));
    const accounts = [...staff, customer];

    expect(staff).toHaveLength(INSURERS.length + 1);
    expect(customer).toBeDefined();
    for (const account of accounts) {
      if (!account?.userId)
        throw new Error(
          `The seeded account ${account?.email ?? 'unknown'} has no login`,
        );
      await assertSeededAccountCanSignIn(account.email, account.userId);
    }
  });

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

  it('keeps seeded passwords until SEED_RESET_PASSWORDS asks to replace them', async () => {
    await seedDatabase(db, options());
    const [admin] = await db
      .select({ userId: schema.staffUsers.userId })
      .from(schema.staffUsers)
      .where(eq(schema.staffUsers.email, 'admin@insurshield.zm'));
    if (!admin.userId) throw new Error('The seeded administrator has no login');
    const [before] = await db
      .select({ password: schema.authAccounts.password })
      .from(schema.authAccounts)
      .where(eq(schema.authAccounts.userId, admin.userId));

    await seedDatabase(db, options({ resetPasswords: true }));

    const [after] = await db
      .select({
        password: schema.authAccounts.password,
        userId: schema.authAccounts.userId,
      })
      .from(schema.authAccounts)
      .innerJoin(
        schema.staffUsers,
        eq(schema.staffUsers.userId, schema.authAccounts.userId),
      )
      .where(eq(schema.staffUsers.email, 'admin@insurshield.zm'));
    expect(after.password).not.toBe(before.password);
    await assertSeededAccountCanSignIn('admin@insurshield.zm', after.userId);
  });

  it('relinks a case-variant legacy staff row by email without creating a duplicate', async () => {
    await db.transaction((tx) => seedReferenceData(tx, () => {}));
    const [legacy] = await db
      .insert(schema.staffUsers)
      .values({
        email: 'ADMIN@INSURSHIELD.ZM',
        fullName: 'InsurShield Administrator',
        role: 'SUPER_ADMIN',
      })
      .returning({ id: schema.staffUsers.id });

    await seedDatabase(db, options({ demoData: false }));

    const admins = await db
      .select({ id: schema.staffUsers.id, userId: schema.staffUsers.userId })
      .from(schema.staffUsers)
      .where(eq(sql`lower(${schema.staffUsers.email})`, 'admin@insurshield.zm'));
    expect(admins).toEqual([{ id: legacy.id, userId: expect.any(String) }]);
  });

  it('does not write the seeded password to its output', async () => {
    const password = 'seed-password-that-must-never-appear';
    const output: string[] = [];

    await seedDatabase(
      db,
      options({ password, log: (line) => output.push(line) }),
    );

    expect(output.join('\n')).not.toContain(password);
  });

  it('stops before linking a case-variant customer-created staff email to a seeded staff account', async () => {
    const email = 'ADMIN@INSURSHIELD.ZM';
    const user = await createCredentialUser(db, {
      email,
      name: 'Existing customer',
      password: SEED_PASSWORD,
    });
    const [customer] = await db
      .insert(schema.customers)
      .values({
        email,
        fullName: 'Existing customer',
        phone: '+260971234567',
        userId: user.id,
      })
      .returning({ id: schema.customers.id, userId: schema.customers.userId });

    await expect(seedDatabase(db, options())).rejects.toThrow(
      'admin@insurshield.zm',
    );

    expect(
      await db
        .select({ id: schema.staffUsers.id })
        .from(schema.staffUsers)
        .where(eq(schema.staffUsers.email, email)),
    ).toEqual([]);
    expect(
      await db
        .select({ id: schema.customers.id, userId: schema.customers.userId })
        .from(schema.customers)
        .where(eq(schema.customers.id, customer.id)),
    ).toEqual([customer]);
  });

  it('stops before writing demo data onto a case-variant customer-created account', async () => {
    const user = await createCredentialUser(db, {
      email: DEMO_CUSTOMER.email,
      name: 'Existing customer',
      password: SEED_PASSWORD,
    });
    const [customer] = await db
      .insert(schema.customers)
      .values({
        email: DEMO_CUSTOMER.email.toUpperCase(),
        fullName: 'Existing customer',
        phone: '+260971234568',
        userId: user.id,
      })
      .returning({ id: schema.customers.id });

    await expect(seedDatabase(db, options())).rejects.toThrow(
      DEMO_CUSTOMER.email,
    );

    expect(
      await db
        .select({ id: schema.quoteRequests.id })
        .from(schema.quoteRequests)
        .where(eq(schema.quoteRequests.customerId, customer.id)),
    ).toEqual([]);
  });

  it('relinks a case-variant legacy demo customer without creating another row', async () => {
    const [legacy] = await db
      .insert(schema.customers)
      .values({
        email: DEMO_CUSTOMER.email.toUpperCase(),
        fullName: DEMO_CUSTOMER.fullName,
        phone: DEMO_CUSTOMER.phone,
      })
      .returning({ id: schema.customers.id });

    await seedDatabase(db, options());

    const rows = await db
      .select({ id: schema.customers.id, userId: schema.customers.userId })
      .from(schema.customers)
      .where(eq(sql`lower(${schema.customers.email})`, DEMO_CUSTOMER.email));
    expect(rows).toEqual([{ id: legacy.id, userId: expect.any(String) }]);
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
      .innerJoin(
        schema.ncdCodes,
        eq(schema.ncdCodes.code, schema.ncdApplications.approvedCodeId),
      )
      .where(inArray(schema.ncdApplications.approvedCodeId, SEEDED_CODES));

    expect(applications).toHaveLength(SEEDED_CODES.length);
    expect(
      new Set(applications.map((application) => application.code)),
    ).toEqual(new Set(SEEDED_CODES));
    for (const application of applications) {
      expect(application).toMatchObject({
        status: 'APPROVED',
        customerId,
        insurerId: application.codeInsurerId,
      });
    }
    for (const code of SEEDED_CODES) {
      expect(await redeemable(code, customerId)).toBe(true);
    }
  });

  it('stores money in ngwee and rates in basis points', async () => {
    await seedDatabase(db, options());

    const [pia] = await db.select().from(schema.piaConfig);
    const [prestige] = await db
      .select()
      .from(schema.insurers)
      .where(eq(schema.insurers.name, 'Prestige Assurance'));
    const [request] = await db
      .select()
      .from(schema.quoteRequests)
      .where(eq(schema.quoteRequests.id, 'QR-DEMO-0001'));
    const [policy] = await db
      .select()
      .from(schema.policies)
      .where(eq(schema.policies.policyNumber, 'POL-DEMO-0003'));
    const [payment] = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.transactionId, 'TXN-DEMO-0003'));
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
    await db
      .update(schema.ncdCodes)
      .set({ redeemedAt: new Date() })
      .where(eq(schema.ncdCodes.code, 'NCD-A1B2C'));
    await db
      .delete(schema.claimNotifications)
      .where(eq(schema.claimNotifications.claimNumber, 'CLM-DEMO-0001'));
    const before = await rowCounts();

    await seedDatabase(db, options({ resetDemo: true }));

    expect(await redeemable('NCD-A1B2C', customerId)).toBe(true);
    expect(await rowCounts()).toEqual({ ...before, claim_notifications: 2 });
  });

  it('creates staff accounts while demo records are disabled', async () => {
    await seedDatabase(db, options({ demoData: false }));

    expect(await rowCounts()).toMatchObject({
      pia_config: 1,
      insurers: 5,
      insurer_contacts: 5,
      ncd_codes: 5,
      staff_users: INSURERS.length + 1,
      customers: 0,
    });
  });
});
