import { asc, eq, ne, sql } from 'drizzle-orm';
import {
  createCredentialUser,
  normalizeEmail,
} from '../src/auth/credential-user.js';
import { databaseUrl } from '../src/config/env.js';
import type { Database, Transaction } from '../src/db/database.module.js';
import {
  authUsers,
  customers,
  insurers,
  staffUsers,
} from '../src/db/schema.js';
import { DEMO_CUSTOMER, resetDemoData, seedDemoData } from './demo-data.js';
import { seedReferenceData } from './reference-data.js';
import { SeedConfigurationError, SeedDataError } from './seed-errors.js';

const PLACEHOLDER = 'CHANGE_ME';

export interface SeedOptions {
  password: string;
  resetPasswords: boolean;
  demoData: boolean;
  resetDemo: boolean;
  log: (line: string) => void;
}

interface StaffSeed {
  email: string;
  fullName: string;
  role: 'SUPER_ADMIN' | 'INSURER_USER';
  insurerId?: string;
}

function refusePlaceholder(env: NodeJS.ProcessEnv, name: string) {
  if (env[name]?.includes(PLACEHOLDER)) {
    throw new SeedConfigurationError(
      `${name} still contains the ${PLACEHOLDER} placeholder`,
    );
  }
}

export function seedOptionsFromEnv(env: NodeJS.ProcessEnv): SeedOptions {
  refusePlaceholder(env, 'SEED_STAFF_PASSWORD');
  const password = env.SEED_STAFF_PASSWORD;
  if (!password)
    throw new SeedConfigurationError(
      'SEED_STAFF_PASSWORD must be set to seed staff and demo accounts',
    );
  return {
    password,
    resetPasswords: env.SEED_RESET_PASSWORDS === 'true',
    demoData: env.SEED_DEMO_DATA !== 'false',
    resetDemo: env.SEED_RESET_DEMO === 'true',
    log: (line) => console.log(line),
  };
}

// Configuration messages name the variable and the rule, never the value.
export function seedDatabaseUrl(): string {
  try {
    return databaseUrl();
  } catch (error) {
    throw new SeedConfigurationError((error as Error).message, {
      cause: error,
    });
  }
}

function accountConflict(kind: string, email: string): SeedDataError {
  return new SeedDataError(
    `Cannot seed ${kind}: ${email} belongs to an existing account.`,
  );
}

async function ensureStaffCanBeSeeded(
  tx: Transaction,
  seed: StaffSeed,
): Promise<void> {
  const email = normalizeEmail(seed.email);
  const [customer] = await tx
    .select({ id: customers.id })
    .from(customers)
    .where(eq(sql`lower(${customers.email})`, email));
  if (customer) throw accountConflict('staff account', email);

  const [staff] = await tx
    .select({ userId: staffUsers.userId })
    .from(staffUsers)
    .where(eq(sql`lower(${staffUsers.email})`, email));
  const [user] = await tx
    .select({ id: authUsers.id })
    .from(authUsers)
    .where(eq(authUsers.email, email));

  if (staff?.userId) {
    if (!user || user.id !== staff.userId)
      throw accountConflict('staff account', email);
    const [linkedCustomer] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.userId, user.id));
    if (linkedCustomer) throw accountConflict('staff account', email);
    return;
  }
  if (user) throw accountConflict('staff account', email);
}

async function ensureDemoCustomerCanBeSeeded(tx: Transaction): Promise<void> {
  const email = normalizeEmail(DEMO_CUSTOMER.email);
  const [staff] = await tx
    .select({ id: staffUsers.id })
    .from(staffUsers)
    .where(eq(sql`lower(${staffUsers.email})`, email));
  if (staff) throw accountConflict('demo customer', email);

  const [customer] = await tx
    .select({
      userId: customers.userId,
      fullName: customers.fullName,
      phone: customers.phone,
    })
    .from(customers)
    .where(eq(sql`lower(${customers.email})`, email));
  const [user] = await tx
    .select({ id: authUsers.id })
    .from(authUsers)
    .where(eq(authUsers.email, email));

  if (!customer) {
    if (user) throw accountConflict('demo customer', email);
    return;
  }
  if (
    customer.fullName !== DEMO_CUSTOMER.fullName ||
    customer.phone !== DEMO_CUSTOMER.phone
  ) {
    throw accountConflict('demo customer', email);
  }
  if (customer.userId) {
    if (!user || user.id !== customer.userId)
      throw accountConflict('demo customer', email);
    const [linkedStaff] = await tx
      .select({ id: staffUsers.id })
      .from(staffUsers)
      .where(eq(staffUsers.userId, user.id));
    if (linkedStaff) throw accountConflict('demo customer', email);
    return;
  }
  if (user) throw accountConflict('demo customer', email);
}

async function seedStaff(
  tx: Transaction,
  seed: StaffSeed,
  options: SeedOptions,
): Promise<void> {
  const email = normalizeEmail(seed.email);
  const [existing] = await tx
    .select({ id: staffUsers.id, userId: staffUsers.userId })
    .from(staffUsers)
    .where(eq(sql`lower(${staffUsers.email})`, email));

  if (existing?.userId && !options.resetPasswords) return;

  if (existing?.userId) {
    await tx
      .update(staffUsers)
      .set({ userId: null })
      .where(eq(staffUsers.id, existing.id));
    await tx.delete(authUsers).where(eq(authUsers.id, existing.userId));
  }
  const user = await createCredentialUser(tx, {
    email,
    name: seed.fullName,
    password: options.password,
  });

  if (existing) {
    await tx
      .update(staffUsers)
      .set({
        userId: user.id,
        role: seed.role,
        insurerId: seed.insurerId ?? null,
        isActive: true,
      })
      .where(eq(staffUsers.id, existing.id));
  } else {
    await tx.insert(staffUsers).values({ ...seed, email, userId: user.id });
  }
}

async function seedDemoCustomer(
  tx: Transaction,
  options: SeedOptions,
): Promise<string> {
  const email = normalizeEmail(DEMO_CUSTOMER.email);
  const [existing] = await tx
    .select({ id: customers.id, userId: customers.userId })
    .from(customers)
    .where(eq(sql`lower(${customers.email})`, email));

  if (existing?.userId && !options.resetPasswords) return existing.id;

  if (existing?.userId) {
    await tx
      .update(customers)
      .set({ userId: null })
      .where(eq(customers.id, existing.id));
    await tx.delete(authUsers).where(eq(authUsers.id, existing.userId));
  }
  const user = await createCredentialUser(tx, {
    email,
    name: DEMO_CUSTOMER.fullName,
    password: options.password,
  });

  if (existing) {
    await tx
      .update(customers)
      .set({ userId: user.id, deletedAt: null })
      .where(eq(customers.id, existing.id));
    return existing.id;
  }
  const [customer] = await tx
    .insert(customers)
    .values({ ...DEMO_CUSTOMER, email, userId: user.id })
    .returning({ id: customers.id });
  return customer.id;
}

export async function seedDatabase(
  db: Database,
  options: SeedOptions,
): Promise<void> {
  const { log } = options;
  await db.transaction((tx) => seedReferenceData(tx, log));

  await db.transaction(async (tx) => {
    const portalInsurers = await tx
      .select({ id: insurers.id, name: insurers.name })
      .from(insurers)
      .where(ne(insurers.status, 'DELETED'))
      .orderBy(asc(insurers.name));
    const staff = [
      {
        email: 'admin@insurshield.zm',
        fullName: 'InsurShield Administrator',
        role: 'SUPER_ADMIN' as const,
      },
      ...portalInsurers.map((insurer): StaffSeed => ({
        email: `insurer@${insurer.name.toLowerCase().replace(/[^a-z0-9]+/g, '')}.zm`,
        fullName: `${insurer.name} portal`,
        role: 'INSURER_USER',
        insurerId: insurer.id,
      })),
    ];

    // Reject every unsafe linkage before creating any account or demo record.
    for (const seed of staff) await ensureStaffCanBeSeeded(tx, seed);
    if (options.demoData) await ensureDemoCustomerCanBeSeeded(tx);

    for (const seed of staff) {
      await seedStaff(tx, seed, options);
      log(`Staff ready: ${seed.email} (${seed.role})`);
    }

    if (!options.demoData) return;
    const customerId = await seedDemoCustomer(tx, options);
    if (options.resetDemo) {
      await resetDemoData(tx);
      log('Demo data reset.');
    }
    await seedDemoData(tx, log, customerId);
  });
}
