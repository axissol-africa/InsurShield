import { and, eq, isNotNull, sql, type SQL } from 'drizzle-orm';
import type { Database, Transaction } from '../db/database.module.js';
import { ncdApplications, ncdCodes, policies, vehicles } from '../db/schema.js';

/** Older payment attempts still use the owner recorded on the approved application. */
export function ncdCodeIssuedTo(customerId: string): SQL {
  return sql`exists (select 1 from ${ncdApplications} where ${ncdApplications.approvedCodeId} = ${ncdCodes.code} and ${ncdApplications.customerId} = ${customerId})`;
}

export async function findBoundNcdCode(db: Database | Transaction, code: string, customerId: string) {
  const [row] = await db.select({
    code: ncdCodes.code,
    insurerId: ncdCodes.insurerId,
    percentage: ncdCodes.percentage,
    expiresAt: ncdCodes.expiresAt,
    redeemedAt: ncdCodes.redeemedAt,
    revokedAt: ncdCodes.revokedAt,
    sourcePolicyNumber: policies.policyNumber,
    sourceVehicle: { plateNumber: vehicles.plateNumber, chassisNumber: vehicles.chassisNumber, registrationCountry: vehicles.registrationCountry },
  }).from(ncdCodes)
    .innerJoin(ncdApplications, and(eq(ncdApplications.approvedCodeId, ncdCodes.code),
      eq(ncdApplications.insurerId, ncdCodes.insurerId), eq(ncdApplications.customerId, customerId),
      eq(ncdApplications.status, 'APPROVED'), isNotNull(ncdApplications.declarationAcceptedAt)))
    .innerJoin(policies, and(eq(policies.policyNumber, ncdApplications.sourcePolicyNumber),
      eq(policies.vehicleId, ncdApplications.sourceVehicleId), eq(policies.insurerId, ncdCodes.insurerId),
      eq(policies.customerId, customerId), isNotNull(policies.issuedAt)))
    .innerJoin(vehicles, eq(vehicles.id, policies.vehicleId))
    .where(and(eq(ncdCodes.code, code), isNotNull(ncdCodes.expiresAt)));
  return row;
}
