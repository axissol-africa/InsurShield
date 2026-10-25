import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNull, lt, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { DATABASE, type Database } from '../db/database.module.js';
import {
  claimNotifications,
  consentRecords,
  customers,
  insurers,
  ncdApplications,
  payments,
  policies,
  quoteRequests,
  vehicles,
} from '../db/schema.js';

// Calendar months for business figures are those of Lusaka, whatever the server's time zone.
const LUSAKA = sql.raw(`'Africa/Lusaka'`);

/** The instant the Lusaka calendar month containing `now` began, or `monthsAhead` months after that. */
const lusakaMonthStart = (now: Date, monthsAhead = 0) =>
  sql`((date_trunc('month', ${now}::timestamptz AT TIME ZONE ${LUSAKA}) + make_interval(months => ${monthsAhead}::int)) AT TIME ZONE ${LUSAKA})`;

const count = (table: PgTable, where?: SQL) =>
  sql<number>`(SELECT count(*)::int FROM ${table}${where ? sql` WHERE ${where}` : sql``})`;

// A sum of bigint is numeric in PostgreSQL; as text it reaches the service with no rounding.
const confirmedSum = (where?: SQL) =>
  sql<string>`(SELECT coalesce(sum(${payments.amountMinor}), 0)::text FROM ${payments} WHERE ${and(eq(payments.status, 'CONFIRMED'), where)})`;

export interface OverviewCounts {
  totalPolicies: number;
  activePolicies: number;
  awaitingCertificate: number;
  expiringSoon: number;
  totalInsurers: number;
  activeInsurers: number;
  openClaims: number;
  totalClaims: number;
  openQuoteRequests: number;
  quotedRequests: number;
  openNcd: number;
  totalCustomers: number;
  premiumAllTimeMinor: string;
  premiumThisMonthMinor: string;
}

@Injectable()
export class AdminRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Every figure in one statement, so they all come from one snapshot. */
  async overview(now: Date, expiringBy: Date): Promise<OverviewCounts> {
    const selection: Record<keyof OverviewCounts, SQL> = {
      totalPolicies: count(policies),
      activePolicies: count(policies, eq(policies.status, 'ACTIVE')),
      awaitingCertificate: count(policies, eq(policies.status, 'AWAITING_INSURER_CERTIFICATE')),
      expiringSoon: count(
        policies,
        and(eq(policies.status, 'ACTIVE'), gte(policies.policyEndDate, now), lte(policies.policyEndDate, expiringBy)),
      ),
      totalInsurers: count(insurers, ne(insurers.status, 'DELETED')),
      activeInsurers: count(insurers, eq(insurers.status, 'ACTIVE')),
      openClaims: count(claimNotifications, eq(claimNotifications.status, 'NOTIFIED')),
      totalClaims: count(claimNotifications),
      openQuoteRequests: count(quoteRequests, eq(quoteRequests.status, 'SUBMITTED')),
      quotedRequests: count(quoteRequests, eq(quoteRequests.status, 'QUOTED')),
      openNcd: count(ncdApplications, inArray(ncdApplications.status, ['SUBMITTED', 'UNDER_REVIEW'])),
      totalCustomers: count(customers, isNull(customers.deletedAt)),
      // Premium is taken from confirmed payments, not from policy records, so
      // an unpaid or failed transaction can never appear as revenue.
      premiumAllTimeMinor: confirmedSum(),
      premiumThisMonthMinor: confirmedSum(
        and(gte(payments.confirmedAt, lusakaMonthStart(now)), lt(payments.confirmedAt, lusakaMonthStart(now, 1))),
      ),
    };
    const columns = Object.entries(selection).map(([name, value]) => sql`${value} AS ${sql.identifier(name)}`);
    const result = await this.db.execute<OverviewCounts & Record<string, unknown>>(sql`SELECT ${sql.join(columns, sql`, `)}`);
    return result.rows[0];
  }

  /** Confirmed premium per Lusaka calendar month, for the `months` months ending with the one containing `now`, oldest first. */
  async premiumByMonth(now: Date, months: number) {
    const result = await this.db.execute<{ month: string; total: string }>(sql`
      SELECT to_char(month.start, 'YYYY-MM') AS month, coalesce(sum(${payments.amountMinor}), 0)::text AS total
      FROM generate_series(1 - ${months}::int, 0) AS month_offset(n)
      CROSS JOIN LATERAL (SELECT date_trunc('month', ${now}::timestamptz AT TIME ZONE ${LUSAKA}) + make_interval(months => month_offset.n) AS start) AS month
      LEFT JOIN ${payments}
        ON ${payments.status} = 'CONFIRMED'
        AND ${payments.confirmedAt} >= (month.start AT TIME ZONE ${LUSAKA})
        AND ${payments.confirmedAt} < ((month.start + interval '1 month') AT TIME ZONE ${LUSAKA})
      GROUP BY month.start
      ORDER BY month.start`);
    return result.rows;
  }

  /** Most recent policies across every insurer. */
  async recentPolicies(limit: number) {
    return this.db
      .select({
        policyNumber: policies.policyNumber,
        status: policies.status,
        premiumMinor: policies.premiumMinor,
        receivedAt: policies.receivedAt,
        issuedAt: policies.issuedAt,
        insurerName: insurers.name,
        customerName: customers.fullName,
        vehicleYear: vehicles.year,
        vehicleMake: vehicles.make,
        vehicleModel: vehicles.model,
        plateNumber: vehicles.plateNumber,
      })
      .from(policies)
      .innerJoin(insurers, eq(insurers.id, policies.insurerId))
      .innerJoin(customers, eq(customers.id, policies.customerId))
      .innerJoin(vehicles, eq(vehicles.id, policies.vehicleId))
      .orderBy(desc(policies.receivedAt))
      .limit(limit);
  }

  /** An open account whose email or phone is exactly one of these, with its record counts. */
  async findCustomer(email: string, phone: string) {
    const [customer] = await this.db
      .select({
        id: customers.id,
        fullName: customers.fullName,
        email: customers.email,
        phone: customers.phone,
        createdAt: customers.createdAt,
        quoteRequests: count(quoteRequests, eq(quoteRequests.customerId, customers.id)),
        policies: count(policies, eq(policies.customerId, customers.id)),
        claims: count(claimNotifications, eq(claimNotifications.customerId, customers.id)),
      })
      .from(customers)
      .where(and(isNull(customers.deletedAt), or(eq(customers.email, email), eq(customers.phone, phone))))
      .limit(1);
    return customer;
  }

  async latestConsent(customerId: string) {
    const [consent] = await this.db
      .select({ privacyVersion: consentRecords.privacyVersion, acceptedAt: consentRecords.acceptedAt })
      .from(consentRecords)
      .where(eq(consentRecords.customerId, customerId))
      .orderBy(desc(consentRecords.acceptedAt))
      .limit(1);
    return consent;
  }
}

export type RecentPolicyRow = Awaited<ReturnType<AdminRepository['recentPolicies']>>[number];
export type CustomerMatch = NonNullable<Awaited<ReturnType<AdminRepository['findCustomer']>>>;
export type ConsentRow = Awaited<ReturnType<AdminRepository['latestConsent']>>;
