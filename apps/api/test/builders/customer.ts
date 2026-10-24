import { ncdApplications, quoteRequests, type ncdCodes } from '../../src/db/schema.js';
import { buildNcdCode, buildQuoteRequest, unique, type Db, type Row } from '../builders.js';

type Insert<T extends { $inferInsert: unknown }> = T['$inferInsert'];

/** A customer's NCD application with an insurer; approved when `approvedCode` is given. */
export async function buildNcdApplication(
  db: Db,
  input: { customerId: string | null; insurerId: string; approvedCode?: Row<typeof ncdCodes> },
  overrides: Partial<Omit<Insert<typeof ncdApplications>, 'customerId' | 'insurerId' | 'approvedCodeId'>> = {},
) {
  const [application] = await db
    .insert(ncdApplications)
    .values({
      applicationNumber: unique('NCDA'),
      insurerId: input.insurerId,
      customerId: input.customerId,
      policyNumber: 'PA-2023-0045',
      fullName: 'Chanda Mwale',
      phone: '+260971000000',
      yearsClaimFree: 3,
      ...(input.approvedCode
        ? { status: 'APPROVED' as const, approvedCodeId: input.approvedCode.code, decidedAt: new Date() }
        : {}),
      ...overrides,
    })
    .returning();
  return application;
}

/** A code the insurer issued by approving this customer's NCD application. */
export async function buildApprovedNcdCode(
  db: Db,
  input: { customerId: string; insurerId: string },
  overrides: Partial<Omit<Insert<typeof ncdCodes>, 'insurerId'>> = {},
) {
  const code = await buildNcdCode(db, { insurerId: input.insurerId }, overrides);
  await buildNcdApplication(db, { ...input, approvedCode: code }, { yearsClaimFree: code.yearsClaimFree });
  return code;
}

/** A renewal request already started for a policy, sent to the given insurers. */
export async function buildRenewalRequest(
  db: Db,
  input: { customerId: string; vehicleId: string; policyNumber: string; insurerIds: string[] },
  overrides: Partial<Omit<Insert<typeof quoteRequests>, 'customerId' | 'vehicleId' | 'renewalOfPolicyNumber'>> = {},
) {
  return buildQuoteRequest(
    db,
    { customerId: input.customerId, vehicleId: input.vehicleId, insurerIds: input.insurerIds },
    { ...overrides, renewalOfPolicyNumber: input.policyNumber },
  );
}
