import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, ne } from 'drizzle-orm';
import { AuditService } from '../common/audit/audit.service.js';
import { auditActor, type AuditActor } from '../common/audit/audit.types.js';
import type { Principal } from '../common/auth/auth.types.js';
import type { ReconciliationKind } from '../common/domain/enums.js';
import { ApiException } from '../common/errors/api.exception.js';
import { ngweeToKwacha } from '../common/money.js';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import {
  insurerQuotes,
  paymentRefunds,
  payments,
  providerStatementImports,
  providerStatementLines,
  reconciliationItems,
  staffUsers,
} from '../db/schema.js';
import { parseStatement, statementCsv, type StatementLine } from './domain/statement.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from './provider/payment-provider.js';

type StaffPrincipal = Extract<Principal, { kind: 'staff' }>;

export interface ImportStatement {
  fileName: string;
  periodStart: Date;
  periodEnd: Date;
  csv: string;
}

/**
 * Compares the provider's statement with InsurShield's records. Every line
 * is stored once; each one either matches a payment or refund, or opens a
 * reconciliation item. Afterwards, any payment confirmed in the period that
 * no statement line accounts for opens an item too. Nothing here moves money
 * or changes a payment.
 */
@Injectable()
export class StatementsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  async import(principal: StaffPrincipal, input: ImportStatement) {
    if (input.periodEnd <= input.periodStart) {
      throw new ApiException('VALIDATION_FAILED', 'The period must end after it starts.', 400, { periodEnd: 'Before the start.' });
    }
    const parsed = parseStatement(input.csv);
    if (!parsed.ok) throw new ApiException('STATEMENT_INVALID', 'The statement could not be read. Nothing was imported.', 400, { lines: parsed.errors });
    const checksum = createHash('sha256').update(input.csv).digest('hex');
    const actor = auditActor(principal);
    const provider = this.provider.name;

    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(providerStatementImports)
        .where(and(eq(providerStatementImports.provider, provider), eq(providerStatementImports.checksum, checksum)));
      if (existing) return { ...toImport(existing), replayed: true };

      const [created] = await tx
        .insert(providerStatementImports)
        .values({
          provider,
          fileName: input.fileName.trim().slice(0, 200) || 'statement.csv',
          checksum,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          lineCount: parsed.lines.length,
          newLines: 0,
          matched: 0,
          itemsOpened: 0,
          importedByStaffId: principal.id,
        })
        .returning();

      let newLines = 0;
      let matched = 0;
      let opened = 0;
      for (const line of parsed.lines) {
        const result = await this.importLine(tx, created.id, line, actor);
        if (!result) continue;
        newLines += 1;
        if (result === 'MATCHED') matched += 1;
        else opened += 1;
      }
      opened += await this.missingFromStatement(tx, input.periodStart, input.periodEnd, actor);

      const [done] = await tx
        .update(providerStatementImports)
        .set({ newLines, matched, itemsOpened: opened })
        .where(eq(providerStatementImports.id, created.id))
        .returning();
      await this.audit.write(tx, {
        actor,
        action: 'reconciliation.statement_imported',
        entityType: 'RECONCILIATION_ITEM',
        entityId: created.id,
        after: { lineCount: parsed.lines.length, newLines, matched, itemsOpened: opened },
        note: `${done.fileName}: ${newLines} new lines, ${matched} matched, ${opened} items opened.`,
        correlationId: created.id,
      });
      return { ...toImport(done), replayed: false };
    });
  }

  list() {
    return this.db
      .select({ statement: providerStatementImports, importedBy: staffUsers.fullName })
      .from(providerStatementImports)
      .innerJoin(staffUsers, eq(staffUsers.id, providerStatementImports.importedByStaffId))
      .orderBy(desc(providerStatementImports.createdAt))
      .limit(50)
      .then((rows) => rows.map((row) => ({ ...toImport(row.statement), importedBy: row.importedBy })));
  }

  /** What the stand-in provider would send for a period, built from InsurShield's own records of its payments. */
  async standInStatement(from: Date, to: Date): Promise<string> {
    const charges = await this.db
      .select({ providerPaymentId: payments.providerPaymentId, amountMinor: payments.amountMinor, currency: payments.currency, confirmedAt: payments.confirmedAt })
      .from(payments)
      .where(and(eq(payments.provider, this.provider.name), inArray(payments.status, ['CONFIRMED', 'REVERSED']), gte(payments.confirmedAt, from), lt(payments.confirmedAt, to)))
      .orderBy(asc(payments.confirmedAt));
    const refunds = await this.db
      .select({ providerPaymentId: payments.providerPaymentId, providerRefundId: paymentRefunds.providerRefundId, amountMinor: paymentRefunds.amountMinor, completedAt: paymentRefunds.completedAt })
      .from(paymentRefunds)
      .innerJoin(payments, eq(payments.id, paymentRefunds.paymentId))
      .where(and(eq(paymentRefunds.status, 'COMPLETED'), gte(paymentRefunds.completedAt, from), lt(paymentRefunds.completedAt, to)))
      .orderBy(asc(paymentRefunds.completedAt));
    return statementCsv([
      ...charges
        .filter((charge) => charge.providerPaymentId)
        .map((charge) => ({ type: 'CHARGE' as const, providerPaymentId: charge.providerPaymentId!, providerRefundId: null, amountMinor: charge.amountMinor, currency: charge.currency, occurredAt: charge.confirmedAt! })),
      ...refunds
        .filter((refund) => refund.providerPaymentId && refund.providerRefundId)
        .map((refund) => ({ type: 'REFUND' as const, providerPaymentId: refund.providerPaymentId!, providerRefundId: refund.providerRefundId, amountMinor: refund.amountMinor, currency: 'ZMW', occurredAt: refund.completedAt! })),
    ]);
  }

  /** One line: stored once, then matched or turned into an item. Null when an earlier statement already had it. */
  private async importLine(tx: Transaction, importId: string, line: StatementLine, actor: AuditActor) {
    const [payment] = await tx
      .select({ id: payments.id, status: payments.status, amountMinor: payments.amountMinor, currency: payments.currency, insurerId: insurerQuotes.insurerId })
      .from(payments)
      .innerJoin(insurerQuotes, eq(insurerQuotes.id, payments.insurerQuoteId))
      .where(and(eq(payments.provider, this.provider.name), eq(payments.providerPaymentId, line.providerPaymentId)));
    const [refund] =
      line.type === 'REFUND' && payment
        ? await tx
            .select({ id: paymentRefunds.id, status: paymentRefunds.status, amountMinor: paymentRefunds.amountMinor })
            .from(paymentRefunds)
            .where(and(eq(paymentRefunds.paymentId, payment.id), eq(paymentRefunds.providerRefundId, line.providerRefundId!)))
        : [];

    let status: 'MATCHED' | 'UNMATCHED' | 'MISMATCH' | 'DUPLICATE' = 'MATCHED';
    let kind: ReconciliationKind | null = null;
    let reason = '';
    const money = `${ngweeToKwacha(line.amountMinor)} ${line.currency}`;
    if (!payment || (line.type === 'REFUND' && !refund)) {
      status = 'UNMATCHED';
      kind = 'STATEMENT_UNMATCHED';
      reason = `The statement has a ${line.type.toLowerCase()} of ${money} for ${line.providerRefundId ?? line.providerPaymentId} that InsurShield has no record of.`;
    } else if (line.type === 'CHARGE') {
      if (await this.alreadyCharged(tx, payment.id)) {
        status = 'DUPLICATE';
        kind = 'DUPLICATE';
        reason = `The statement charges payment ${line.providerPaymentId} a second time (${money}).`;
      } else if (line.amountMinor !== payment.amountMinor || line.currency !== payment.currency || !['CONFIRMED', 'REVERSED'].includes(payment.status)) {
        status = 'MISMATCH';
        kind = 'STATEMENT_UNMATCHED';
        reason = `The statement charges ${money} for ${line.providerPaymentId}; InsurShield has ${ngweeToKwacha(payment.amountMinor)} ${payment.currency}, ${payment.status.toLowerCase()}.`;
      }
    } else if (line.type === 'REFUND') {
      if (line.amountMinor !== refund.amountMinor || refund.status !== 'COMPLETED') {
        status = 'MISMATCH';
        kind = 'STATEMENT_UNMATCHED';
        reason = `The statement refunds ${money} for ${line.providerRefundId}; InsurShield has ${ngweeToKwacha(refund.amountMinor)}, ${refund.status.toLowerCase()}.`;
      }
    } else if (payment.status !== 'REVERSED') {
      status = 'MISMATCH';
      kind = 'REVERSAL';
      reason = `The statement reverses ${money} of payment ${line.providerPaymentId}, which InsurShield still holds as ${payment.status.toLowerCase()}.`;
    }

    const [stored] = await tx
      .insert(providerStatementLines)
      .values({
        importId,
        provider: this.provider.name,
        lineKey: line.lineKey,
        type: line.type,
        providerPaymentId: line.providerPaymentId,
        providerRefundId: line.providerRefundId,
        amountMinor: line.amountMinor,
        currency: line.currency,
        occurredAt: line.occurredAt,
        status,
        paymentId: payment?.id ?? null,
        refundId: refund?.id ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: providerStatementLines.id });
    if (!stored) return null;
    if (!kind) {
      // A payment an earlier statement left out is accounted for now.
      if (line.type === 'CHARGE' && payment) await this.foundLater(tx, payment.id, actor);
      return 'MATCHED' as const;
    }
    await this.openItem(tx, { kind, statementLineId: stored.id, paymentId: payment?.id ?? null, insurerId: payment?.insurerId ?? null, amountMinor: line.amountMinor, reason }, actor);
    return status;
  }

  private async foundLater(tx: Transaction, paymentId: string, actor: AuditActor) {
    const resolved = await tx
      .update(reconciliationItems)
      .set({ status: 'RESOLVED', outcome: 'NO_ACTION', resolvedAt: new Date(), resolutionNote: 'Found on a later provider statement.' })
      .where(and(eq(reconciliationItems.kind, 'MISSING_FROM_STATEMENT'), eq(reconciliationItems.paymentId, paymentId), ne(reconciliationItems.status, 'RESOLVED')))
      .returning({ id: reconciliationItems.id, status: reconciliationItems.status });
    for (const item of resolved) {
      await this.audit.transition(tx, {
        actor,
        entityType: 'RECONCILIATION_ITEM',
        entityId: item.id,
        fromStatus: 'OPEN',
        toStatus: 'RESOLVED',
        note: 'Resolved as NO_ACTION: the payment is on a later provider statement.',
        correlationId: paymentId,
      });
    }
  }

  private async alreadyCharged(tx: Transaction, paymentId: string) {
    const [found] = await tx
      .select({ id: providerStatementLines.id })
      .from(providerStatementLines)
      .where(and(eq(providerStatementLines.paymentId, paymentId), eq(providerStatementLines.type, 'CHARGE'), inArray(providerStatementLines.status, ['MATCHED', 'MISMATCH'])))
      .limit(1);
    return Boolean(found);
  }

  /** Confirmed payments in the period that no statement line accounts for. */
  private async missingFromStatement(tx: Transaction, from: Date, to: Date, actor: AuditActor): Promise<number> {
    const missing = await tx
      .select({ id: payments.id, transactionId: payments.transactionId, amountMinor: payments.amountMinor, insurerId: insurerQuotes.insurerId })
      .from(payments)
      .innerJoin(insurerQuotes, eq(insurerQuotes.id, payments.insurerQuoteId))
      .leftJoin(
        providerStatementLines,
        and(eq(providerStatementLines.paymentId, payments.id), eq(providerStatementLines.type, 'CHARGE')),
      )
      .where(
        and(
          eq(payments.provider, this.provider.name),
          eq(payments.status, 'CONFIRMED'),
          // A payment from before the provider was never on any statement.
          isNotNull(payments.providerPaymentId),
          gte(payments.confirmedAt, from),
          lt(payments.confirmedAt, to),
          isNull(providerStatementLines.id),
        ),
      );
    let opened = 0;
    for (const payment of missing) {
      const done = await this.openItem(
        tx,
        {
          kind: 'MISSING_FROM_STATEMENT',
          paymentId: payment.id,
          statementLineId: null,
          insurerId: payment.insurerId,
          amountMinor: payment.amountMinor,
          reason: `Payment ${payment.transactionId} is confirmed in InsurShield but not on the provider's statement for the period.`,
        },
        actor,
      );
      if (done) opened += 1;
    }
    return opened;
  }

  private async openItem(
    tx: Transaction,
    item: { kind: ReconciliationKind; statementLineId: string | null; paymentId: string | null; insurerId: string | null; amountMinor: number; reason: string },
    actor: AuditActor,
  ): Promise<boolean> {
    const [opened] = await tx.insert(reconciliationItems).values(item).onConflictDoNothing().returning({ id: reconciliationItems.id });
    if (!opened) return false;
    await this.audit.transition(tx, {
      actor,
      entityType: 'RECONCILIATION_ITEM',
      entityId: opened.id,
      fromStatus: null,
      toStatus: 'OPEN',
      note: `${item.kind}: ${item.reason}`,
      correlationId: item.statementLineId ?? item.paymentId ?? opened.id,
    });
    return true;
  }
}

function toImport(row: typeof providerStatementImports.$inferSelect) {
  return {
    id: row.id,
    fileName: row.fileName,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    lineCount: row.lineCount,
    newLines: row.newLines,
    matched: row.matched,
    itemsOpened: row.itemsOpened,
    createdAt: row.createdAt.toISOString(),
  };
}
