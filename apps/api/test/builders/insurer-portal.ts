import { ncdApplications } from '../../src/db/schema.js';
import { unique, type Db } from '../builders.js';

export async function buildNcdApplication(
  db: Db,
  input: { insurerId: string; customerId?: string | null },
  overrides: Partial<Omit<typeof ncdApplications.$inferInsert, 'insurerId' | 'customerId'>> = {},
) {
  const [application] = await db
    .insert(ncdApplications)
    .values({
      ...input,
      applicationNumber: unique('NCDA'),
      policyNumber: unique('OLD-POL'),
      fullName: 'Chanda Mwale',
      phone: '+260971000000',
      yearsClaimFree: 3,
      ...overrides,
    })
    .returning();
  return application;
}
