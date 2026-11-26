import { Inject, Injectable } from '@nestjs/common';
import { and, eq, exists, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import { claimNotifications, inspectionRequestProducts, inspections, insurerQuotes, ncdApplications, paymentRefunds, payments, policies, quoteRequestProductVersions, quoteRequestRecipients, quoteRequests, reconciliationItems, settlements } from '../db/schema.js';
import type { ReportMetric, ReportPeriod } from './domain/report.js';

const total = sql<string>`count(*)::text`;
function metric(key: string, label: string, value: string, definition: string, money = false): ReportMetric {
  return { key, label, value, definition, unit: money ? 'minorUnits' : 'count', ...(money ? { currency: 'ZMW' as const } : {}) };
}

@Injectable()
export class ReportingRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  snapshot<T>(work: (tx: Transaction) => Promise<T>) {
    // A single consistent snapshot also commits the generation audit before releasing the report.
    return this.db.transaction(work, { isolationLevel: 'repeatable read' });
  }

  async dataAsOf(tx: Transaction): Promise<string> {
    const result = await tx.execute<{ at: string }>(sql`select transaction_timestamp()::text as at`);
    return new Date(result.rows[0].at).toISOString();
  }

  async operations(tx: Transaction, period: ReportPeriod, insurerId: string | null, asOf: Date): Promise<ReportMetric[]> {
    const requestScope = insurerId === null ? undefined : or(
      exists(tx.select({ id: quoteRequestRecipients.id }).from(quoteRequestRecipients).where(and(eq(quoteRequestRecipients.quoteRequestId, quoteRequests.id), eq(quoteRequestRecipients.insurerId, insurerId)))),
      exists(tx.select({ id: quoteRequestProductVersions.id }).from(quoteRequestProductVersions).where(and(eq(quoteRequestProductVersions.quoteRequestId, quoteRequests.id), eq(quoteRequestProductVersions.insurerId, insurerId)))),
    );
    const [requests] = await tx.select({
      total,
      renewals: sql<string>`count(*) filter (where ${quoteRequests.renewalOfPolicyNumber} is not null)::text`,
    }).from(quoteRequests).where(and(requestScope, gte(quoteRequests.submittedAt, period.start), lt(quoteRequests.submittedAt, period.end)));
    const [quotes] = await tx.select({
      total,
      converted: sql<string>`count(*) filter (where exists (
        select 1 from ${policies} where ${policies.insurerQuoteId} = ${insurerQuotes.id}
        and ${policies.insurerId} = ${insurerQuotes.insurerId} and ${policies.issuedAt} is not null
      ))::text`,
    }).from(insurerQuotes).where(and(insurerId === null ? undefined : eq(insurerQuotes.insurerId, insurerId), gte(insurerQuotes.sentAt, period.start), lt(insurerQuotes.sentAt, period.end)));
    const openStatuses = ['SUBMITTED', 'INSURER_PROCESSING', 'VERIFICATION_REQUIRED', 'INSPECTION_REQUIRED', 'MANUAL_REVIEW'] as const;
    const [work] = await tx.select({
      total,
      open: sql<string>`count(*) filter (where ${inArray(quoteRequestProductVersions.status, [...openStatuses])})::text`,
      overdue: sql<string>`count(*) filter (where ${and(inArray(quoteRequestProductVersions.status, [...openStatuses]), isNull(quoteRequestProductVersions.pausedAt), lt(quoteRequestProductVersions.replyDueAt, asOf))})::text`,
      timedOut: sql<string>`count(*) filter (where ${quoteRequestProductVersions.status} = 'TIMED_OUT')::text`,
    }).from(quoteRequestProductVersions).where(and(insurerId === null ? undefined : eq(quoteRequestProductVersions.insurerId, insurerId), gte(quoteRequestProductVersions.selectedAt, period.start), lt(quoteRequestProductVersions.selectedAt, period.end)));
    const [received] = await tx.select({ total }).from(policies).where(and(insurerId === null ? undefined : eq(policies.insurerId, insurerId), gte(policies.receivedAt, period.start), lt(policies.receivedAt, period.end)));
    const [issued] = await tx.select({ total }).from(policies).where(and(insurerId === null ? undefined : eq(policies.insurerId, insurerId), gte(policies.issuedAt, period.start), lt(policies.issuedAt, period.end)));
    const [claims] = await tx.select({ total }).from(claimNotifications).where(and(insurerId === null ? undefined : eq(claimNotifications.insurerId, insurerId), gte(claimNotifications.submittedAt, period.start), lt(claimNotifications.submittedAt, period.end)));
    const [ncd] = await tx.select({ total }).from(ncdApplications).where(and(insurerId === null ? undefined : eq(ncdApplications.insurerId, insurerId), gte(ncdApplications.submittedAt, period.start), lt(ncdApplications.submittedAt, period.end)));
    const inspectionScope = insurerId === null ? undefined : or(eq(inspections.insurerId, insurerId), and(isNull(inspections.insurerId), exists(
      tx.select({ id: inspectionRequestProducts.id }).from(inspectionRequestProducts)
        .innerJoin(quoteRequestProductVersions, and(eq(quoteRequestProductVersions.quoteRequestId, inspectionRequestProducts.quoteRequestId), eq(quoteRequestProductVersions.productVersionId, inspectionRequestProducts.productVersionId)))
        .where(and(eq(inspectionRequestProducts.inspectionId, inspections.id), eq(quoteRequestProductVersions.insurerId, insurerId))),
    )));
    const [appointments] = await tx.select({ total }).from(inspections).where(and(inspectionScope, gte(inspections.createdAt, period.start), lt(inspections.createdAt, period.end)));
    return [
      metric('quoteRequests', 'Quote requests received', requests.total, 'Distinct requests submitted in the period; insurer scope requires a recipient or selected product belonging to that insurer.'),
      metric('quotesSent', 'Quotes sent', quotes.total, 'Quote records sent in the period, including subsequently withdrawn or superseded versions.'),
      metric('quotesConverted', 'Quotes converted to issued policies', quotes.converted, 'Of quotes sent in the period, the count linked to at least one issued policy of the same insurer as of the data timestamp. This is a cohort count, not a period conversion rate.'),
      metric('productSelections', 'Product selections received', work.total, 'Selected product versions selected in the period; legacy requests without product selections are excluded.'),
      metric('openProductSelections', 'Open product workload', work.open, 'Selections from the period currently submitted, processing, awaiting verification or inspection, or in manual review.'),
      metric('overdueProductSelections', 'Overdue product replies', work.overdue, 'Open selections from the period with an elapsed recorded replyDueAt and no active pause, as of the data timestamp. Legacy requests without a reply deadline are excluded.'),
      metric('timedOutProductSelections', 'Timed-out product replies', work.timedOut, 'Selections from the period currently marked TIMED_OUT by the authoritative workflow.'),
      metric('policiesReceived', 'Policies received', received.total, 'Policies with receivedAt in the period, regardless of current status; receipt does not mean issuance.'),
      metric('policiesIssued', 'Policies issued', issued.total, 'Policies with issuedAt in the period, including any subsequently cancelled policies.'),
      metric('renewalRequests', 'Renewal requests received', requests.renewals, 'Scoped requests submitted in the period that reference a renewal policy; not completed renewals.'),
      metric('claimsNotified', 'Claims notified', claims.total, 'Claim notifications submitted in the period; not claim payouts or adjudication outcomes.'),
      metric('ncdApplications', 'NCD applications received', ncd.total, 'NCD applications submitted in the period, regardless of current decision status.'),
      metric('inspectionsRequested', 'Inspections requested', appointments.total, 'Distinct inspections created in the period, owned by the insurer or shared through its selected products; platform totals count shared inspections once.'),
    ];
  }

  async finance(tx: Transaction, period: ReportPeriod, insurerId: string): Promise<ReportMetric[]> {
    const [paid] = await tx.select({ total, amount: sql<string>`coalesce(sum(${payments.amountMinor}), 0)::text` })
      .from(payments).innerJoin(insurerQuotes, eq(insurerQuotes.id, payments.insurerQuoteId))
      .where(and(eq(insurerQuotes.insurerId, insurerId), eq(payments.currency, 'ZMW'), eq(payments.status, 'CONFIRMED'), gte(payments.confirmedAt, period.start), lt(payments.confirmedAt, period.end)));
    const [premium] = await tx.select({ amount: sql<string>`coalesce(sum(${policies.premiumMinor}), 0)::text` }).from(policies)
      .where(and(eq(policies.insurerId, insurerId), gte(policies.issuedAt, period.start), lt(policies.issuedAt, period.end)));
    const [refunds] = await tx.select({ total, amount: sql<string>`coalesce(sum(${paymentRefunds.amountMinor}), 0)::text` })
      .from(paymentRefunds).innerJoin(payments, eq(payments.id, paymentRefunds.paymentId)).innerJoin(insurerQuotes, eq(insurerQuotes.id, payments.insurerQuoteId))
      .where(and(eq(insurerQuotes.insurerId, insurerId), eq(payments.currency, 'ZMW'), eq(paymentRefunds.status, 'COMPLETED'), gte(paymentRefunds.completedAt, period.start), lt(paymentRefunds.completedAt, period.end)));
    const [settled] = await tx.select({ total, amount: sql<string>`coalesce(sum(${settlements.netPayableMinor}), 0)::text` }).from(settlements)
      .where(and(eq(settlements.insurerId, insurerId), eq(settlements.status, 'FINALISED'), gte(settlements.finalisedAt, period.start), lt(settlements.finalisedAt, period.end)));
    const [exceptions] = await tx.select({ total, resolved: sql<string>`count(*) filter (where ${reconciliationItems.status} = 'RESOLVED')::text` }).from(reconciliationItems)
      .where(and(eq(reconciliationItems.insurerId, insurerId), gte(reconciliationItems.openedAt, period.start), lt(reconciliationItems.openedAt, period.end)));
    return [
      metric('confirmedPayments', 'Confirmed payments', paid.total, 'ZMW payments currently CONFIRMED with confirmedAt in the period, attributed through the purchased insurer quote; reversed payments are excluded.'),
      metric('confirmedPaymentAmount', 'Confirmed payment amount', paid.amount, 'Recorded total ZMW payment amounts for currently confirmed payments confirmed in the period; may include recorded charges and does not imply earned premium.', true),
      metric('issuedPolicyPremium', 'Issued policy premium', premium.amount, 'Recorded policy premium for policies issued in the period, including subsequently cancelled policies; not earned premium or net revenue.', true),
      metric('completedRefunds', 'Completed refunds', refunds.total, 'Completed refunds with completedAt in the period, scoped through the payment and insurer quote.'),
      metric('completedRefundAmount', 'Completed refund amount', refunds.amount, 'Recorded completed ZMW refunds in the period; a separate flow and not subtracted from an unrelated payment-period cohort.', true),
      metric('finalisedSettlements', 'Finalised settlements', settled.total, 'Existing settlement records finalised in the period, not settlement periods overlapping the filter.'),
      metric('recordedSettlementNetPayable', 'Recorded settlement net payable', settled.amount, 'Sum of net payable already recorded on finalised settlements finalised in the period. No commission or fee is calculated; this does not assert remittance or approval of DEC-013.', true),
      metric('reconciliationExceptions', 'Reconciliation exceptions opened', exceptions.total, 'Reconciliation items explicitly assigned to this insurer and opened in the period; unattributed items are excluded.'),
      metric('resolvedReconciliationExceptions', 'Resolved exceptions from period', exceptions.resolved, 'Of exceptions opened in the period, the count currently resolved as of the data timestamp.'),
    ];
  }
}
