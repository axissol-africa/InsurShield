import { asc, ne } from 'drizzle-orm';
import { databaseUrl } from '../src/config/env.js';
import type { Database } from '../src/db/database.module.js';
import { insurers, staffUsers } from '../src/db/schema.js';
import { resetDemoData, seedDemoData } from './demo-data.js';
import { keycloakAdminFromEnv, type KeycloakAdmin } from './keycloak-admin.js';
import { seedReferenceData } from './reference-data.js';
import { SeedConfigurationError } from './seed-errors.js';

const PLACEHOLDER = 'CHANGE_ME';

export interface SeedOptions {
  /** Staff accounts are provisioned in Keycloak, so they are skipped without it. */
  staff?: { keycloak: KeycloakAdmin; password: string };
  demoData: boolean;
  resetDemo: boolean;
  log: (line: string) => void;
}

function refusePlaceholder(env: NodeJS.ProcessEnv, name: string) {
  if (env[name]?.includes(PLACEHOLDER)) {
    throw new SeedConfigurationError(`${name} still contains the ${PLACEHOLDER} placeholder`);
  }
}

export function seedOptionsFromEnv(env: NodeJS.ProcessEnv): SeedOptions {
  refusePlaceholder(env, 'KEYCLOAK_CLIENT_SECRET');
  const keycloak = keycloakAdminFromEnv(env);
  let staff: SeedOptions['staff'];
  if (keycloak) {
    refusePlaceholder(env, 'SEED_STAFF_PASSWORD');
    const password = env.SEED_STAFF_PASSWORD;
    if (!password) throw new SeedConfigurationError('SEED_STAFF_PASSWORD must be set to provision staff accounts');
    staff = { keycloak, password };
  }
  return {
    staff,
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
    throw new SeedConfigurationError((error as Error).message, { cause: error });
  }
}

export async function seedDatabase(db: Database, options: SeedOptions): Promise<void> {
  const { staff, log } = options;
  await db.transaction((tx) => seedReferenceData(tx, log));

  // Credentials live in Keycloak; these rows only carry the link (keycloakId)
  // and the relationships Keycloak knows nothing about, such as insurerId.
  if (!staff) {
    log('Keycloak is not configured: skipping staff accounts and demo data.');
    log('Start it with `npm run infra:up` and run this seed again.');
    return;
  }

  const adminEmail = 'admin@insurshield.zm';
  const adminId = await staff.keycloak.upsertUser({
    email: adminEmail,
    firstName: 'InsurShield',
    lastName: 'Administrator',
    password: staff.password,
    realmRoles: ['super_admin', 'admin'],
  });
  await db
    .insert(staffUsers)
    .values({ keycloakId: adminId, email: adminEmail, fullName: 'InsurShield Administrator', role: 'SUPER_ADMIN' })
    .onConflictDoUpdate({
      target: staffUsers.email,
      set: { keycloakId: adminId, role: 'SUPER_ADMIN', isActive: true },
    });
  log(`Staff ready: ${adminEmail} (SUPER_ADMIN)`);

  // One portal login per insurer, so each sees only its own work.
  const portalInsurers = await db
    .select({ id: insurers.id, name: insurers.name })
    .from(insurers)
    .where(ne(insurers.status, 'DELETED'))
    .orderBy(asc(insurers.name));
  for (const insurer of portalInsurers) {
    const email = `insurer@${insurer.name.toLowerCase().replace(/[^a-z0-9]+/g, '')}.zm`;
    const keycloakId = await staff.keycloak.upsertUser({
      email,
      firstName: insurer.name,
      lastName: 'Portal',
      password: staff.password,
      realmRoles: ['insurer_user'],
    });
    await db
      .insert(staffUsers)
      .values({ keycloakId, email, fullName: `${insurer.name} portal`, role: 'INSURER_USER', insurerId: insurer.id })
      .onConflictDoUpdate({ target: staffUsers.email, set: { keycloakId, insurerId: insurer.id, isActive: true } });
    log(`Staff ready: ${email} (INSURER_USER)`);
  }

  if (options.demoData) {
    await db.transaction(async (tx) => {
      if (options.resetDemo) {
        await resetDemoData(tx);
        log('Demo data reset.');
      }
      await seedDemoData(tx, log);
    });
  }
}
