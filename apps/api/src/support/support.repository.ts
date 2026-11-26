import { Inject, Injectable } from '@nestjs/common';
import { and, ne, desc, eq, gt, gte, inArray, isNull, notExists, or, sql } from 'drizzle-orm';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import { lusakaDay } from '../common/domain/lusaka.js';
import {
  claimNotifications,
  customers,
  inspections,
  insurers,
  ncdApplications,
  payments,
  policies,
  quoteRequests,
  serviceRequests,
} from '../db/schema.js';
import { OPEN_PAYMENT_STATUSES, OPEN_SERVICE_REQUEST_STATUSES } from '../common/domain/enums.js';

/** A record found by the reference a customer reads out to the help desk. */
export interface FoundRecord {
  type: 'QUOTE_REQUEST' | 'POLICY' | 'PAYMENT' | 'CLAIM' | 'SERVICE_REQUEST' | 'NCD_APPLICATION' | 'INSPECTION';
  reference: string;
  status: string;
  customerId: string | null;
  insurerId: string | null;
  createdAt: Date;
}

/** Each kind shows only its most recent few: the help desk needs a reference, not a history. */
const PER_KIND = 10;

@Injectable()
export class SupportRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  /** The customer's records still in progress, newest first per kind. */
  async openRecordsOf(customerId: string, now = new Date()): Promise<FoundRecord[]> {
    const db = this.db;
    const today = new Date(`${lusakaDay(now)}T00:00:00+02:00`);
    const [requests, held, paying, asked, claims, ncd] = await Promise.all([
      db
        .select({ reference: quoteRequests.id, status: quoteRequests.status, createdAt: quoteRequests.createdAt })
        .from(quoteRequests)
        .where(and(
          eq(quoteRequests.customerId, customerId),
          inArray(quoteRequests.status, ['SUBMITTED', 'QUOTED']),
          gt(quoteRequests.expiresAt, now),
          notExists(db.select({ one: sql`1` }).from(payments)
            .where(and(eq(payments.quoteRequestId, quoteRequests.id), eq(payments.status, 'CONFIRMED')))),
        ))
        .orderBy(desc(quoteRequests.createdAt))
        .limit(PER_KIND),
      db
        .select({ reference: policies.policyNumber, status: policies.status, insurerId: policies.insurerId, createdAt: policies.receivedAt })
        .from(policies)
        .where(and(eq(policies.customerId, customerId), or(
          inArray(policies.status, ['AWAITING_INSURER_CERTIFICATE', 'ISSUANCE_FAILED']),
          and(eq(policies.status, 'ACTIVE'), or(isNull(policies.policyEndDate), gte(policies.policyEndDate, today))),
        )))
        .orderBy(desc(policies.receivedAt))
        .limit(PER_KIND),
      db
        .select({ reference: payments.transactionId, status: payments.status, createdAt: payments.createdAt })
        .from(payments)
        .where(and(eq(payments.customerId, customerId), inArray(payments.status, [...OPEN_PAYMENT_STATUSES])))
        .orderBy(desc(payments.createdAt))
        .limit(PER_KIND),
      db
        .select({ reference: serviceRequests.reference, status: serviceRequests.status, insurerId: serviceRequests.insurerId, createdAt: serviceRequests.createdAt })
        .from(serviceRequests)
        .where(and(eq(serviceRequests.customerId, customerId), inArray(serviceRequests.status, [...OPEN_SERVICE_REQUEST_STATUSES])))
        .orderBy(desc(serviceRequests.createdAt))
        .limit(PER_KIND),
      db
        .select({ reference: claimNotifications.claimNumber, status: claimNotifications.status, insurerId: claimNotifications.insurerId, createdAt: claimNotifications.submittedAt })
        .from(claimNotifications)
        .where(and(eq(claimNotifications.customerId, customerId), ne(claimNotifications.status, 'CLOSED')))
        .orderBy(desc(claimNotifications.submittedAt))
        .limit(PER_KIND),
      db
        .select({ reference: ncdApplications.applicationNumber, status: ncdApplications.status, insurerId: ncdApplications.insurerId, createdAt: ncdApplications.submittedAt })
        .from(ncdApplications)
        .where(and(eq(ncdApplications.customerId, customerId), inArray(ncdApplications.status, ['SUBMITTED', 'UNDER_REVIEW', 'VERIFICATION_REQUIRED'])))
        .orderBy(desc(ncdApplications.submittedAt))
        .limit(PER_KIND),
    ]);
    const as = (type: FoundRecord['type']) => (row: { reference: string; status: string; createdAt: Date; insurerId?: string | null }): FoundRecord => ({
      type,
      reference: row.reference,
      status: row.status,
      customerId,
      insurerId: row.insurerId ?? null,
      createdAt: row.createdAt,
    });
    return [
      ...asked.map(as('SERVICE_REQUEST')),
      ...held.map(as('POLICY')),
      ...paying.map(as('PAYMENT')),
      ...requests.map(as('QUOTE_REQUEST')),
      ...claims.map(as('CLAIM')),
      ...ncd.map(as('NCD_APPLICATION')),
    ];
  }

  /** Every record carrying this exact reference. References differ by prefix, so it is usually one. */
  async findByReference(reference: string): Promise<FoundRecord[]> {
    const db = this.db;
    const [request, policy, payment, claim, asked, ncd, inspection] = await Promise.all([
      db.select({ status: quoteRequests.status, customerId: quoteRequests.customerId, createdAt: quoteRequests.createdAt }).from(quoteRequests).where(eq(quoteRequests.id, reference)),
      db.select({ status: policies.status, customerId: policies.customerId, insurerId: policies.insurerId, createdAt: policies.receivedAt }).from(policies).where(eq(policies.policyNumber, reference)),
      db.select({ status: payments.status, customerId: payments.customerId, createdAt: payments.createdAt }).from(payments).where(eq(payments.transactionId, reference)),
      db.select({ status: claimNotifications.status, customerId: claimNotifications.customerId, insurerId: claimNotifications.insurerId, createdAt: claimNotifications.submittedAt }).from(claimNotifications).where(eq(claimNotifications.claimNumber, reference)),
      db.select({ status: serviceRequests.status, customerId: serviceRequests.customerId, insurerId: serviceRequests.insurerId, createdAt: serviceRequests.createdAt }).from(serviceRequests).where(eq(serviceRequests.reference, reference)),
      db.select({ status: ncdApplications.status, customerId: ncdApplications.customerId, insurerId: ncdApplications.insurerId, createdAt: ncdApplications.submittedAt }).from(ncdApplications).where(eq(ncdApplications.applicationNumber, reference)),
      db.select({ status: inspections.status, customerId: inspections.customerId, insurerId: inspections.insurerId, createdAt: inspections.createdAt }).from(inspections).where(eq(inspections.id, reference)),
    ]);
    const as = (type: FoundRecord['type']) => (row: { status: string; customerId: string | null; insurerId?: string | null; createdAt: Date }): FoundRecord => ({
      type,
      reference,
      status: row.status,
      customerId: row.customerId,
      insurerId: row.insurerId ?? null,
      createdAt: row.createdAt,
    });
    return [
      ...request.map(as('QUOTE_REQUEST')),
      ...policy.map(as('POLICY')),
      ...payment.map(as('PAYMENT')),
      ...claim.map(as('CLAIM')),
      ...asked.map(as('SERVICE_REQUEST')),
      ...ncd.map(as('NCD_APPLICATION')),
      ...inspection.map(as('INSPECTION')),
    ];
  }

  async customersById(ids: string[]) {
    if (ids.length === 0) return [];
    return this.db
      .select({ id: customers.id, fullName: customers.fullName, email: customers.email, phone: customers.phone })
      .from(customers)
      .where(inArray(customers.id, ids));
  }

  async insurerNames(ids: string[]) {
    if (ids.length === 0) return [];
    return this.db.select({ id: insurers.id, name: insurers.name }).from(insurers).where(inArray(insurers.id, ids));
  }
}
