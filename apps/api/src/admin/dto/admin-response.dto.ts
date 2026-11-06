import { toContract } from '../../common/contract.js';
import { ngweeToKwacha, sumToKwacha } from '../../common/money.js';
import type { AuditLogRow, ConsentRow, CustomerMatch, OverviewCounts, RecentPolicyRow } from '../admin.repository.js';
import { shownPhone } from '../../common/auth/phone.js';

export function toOverviewResponse(counts: OverviewCounts) {
  return {
    policies: {
      total: counts.totalPolicies,
      active: counts.activePolicies,
      awaitingCertificate: counts.awaitingCertificate,
      expiringIn30Days: counts.expiringSoon,
    },
    insurers: {
      total: counts.totalInsurers,
      active: counts.activeInsurers,
      inactive: counts.totalInsurers - counts.activeInsurers,
    },
    claims: { open: counts.openClaims, total: counts.totalClaims },
    quoteRequests: { awaitingQuotes: counts.openQuoteRequests, quoted: counts.quotedRequests },
    ncd: { open: counts.openNcd },
    customers: { total: counts.totalCustomers },
    premium: {
      currency: 'ZMW',
      allTime: sumToKwacha(counts.premiumAllTimeMinor),
      thisMonth: sumToKwacha(counts.premiumThisMonthMinor),
    },
  };
}

export function toRecentPolicyResponse(policy: RecentPolicyRow) {
  return {
    policyNumber: policy.policyNumber,
    status: toContract.policyStatus(policy.status),
    insurer: policy.insurerName,
    customerName: policy.customerName,
    vehicle: `${policy.vehicleYear} ${policy.vehicleMake} ${policy.vehicleModel}`.trim(),
    plateNumber: policy.plateNumber,
    premium: ngweeToKwacha(policy.premiumMinor),
    receivedAt: policy.receivedAt.toISOString(),
    issuedAt: policy.issuedAt?.toISOString() ?? null,
  };
}

export function toCustomerLookupResponse(customer: CustomerMatch, consent: ConsentRow) {
  return {
    id: customer.id,
    fullName: customer.fullName,
    email: customer.email,
    phone: shownPhone(customer.phone),
    createdAt: customer.createdAt.toISOString(),
    consent: consent ? { noticeVersion: consent.privacyVersion, acceptedAt: consent.acceptedAt.toISOString() } : null,
    counts: {
      quoteRequests: customer.quoteRequests,
      policies: customer.policies,
      claims: customer.claims,
    },
  };
}

/** Only field names leave the audit endpoint; the values stay server-side. */
export function toAuditLogResponse(entry: AuditLogRow) {
  const before = asRecord(entry.before);
  const after = asRecord(entry.after);
  const changedFields = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .sort();

  return {
    id: entry.id,
    actorType: entry.actorType,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    note: entry.note,
    correlationId: entry.correlationId,
    changedFields,
    createdAt: entry.createdAt.toISOString(),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
