import { createHash } from 'node:crypto';
import { STATEMENT_LINE_TYPES, type StatementLineType } from '../../common/domain/enums.js';
import { parseKwacha } from '../../common/money.js';

/** The provider-neutral statement format, documented in docs/PAYMENTS.md. */
export const STATEMENT_HEADER = ['type', 'provider_payment_id', 'provider_refund_id', 'amount', 'currency', 'occurred_at'] as const;
export const MAX_STATEMENT_LINES = 20_000;

export interface StatementLine {
  lineNumber: number;
  type: StatementLineType;
  providerPaymentId: string;
  providerRefundId: string | null;
  amountMinor: number;
  currency: string;
  occurredAt: Date;
  /** The same line in any file has the same key, so an overlapping statement adds only what is new. */
  lineKey: string;
}

export type ParsedStatement = { ok: true; lines: StatementLine[] } | { ok: false; errors: string[] };

/**
 * Reads the whole file before anything is stored: a statement with one bad
 * line is refused, with every bad line named, rather than half imported.
 */
export function parseStatement(text: string): ParsedStatement {
  const rows = text.replace(/^﻿/, '').split(/\r?\n/).filter((row) => row.trim().length > 0);
  const header = (rows.shift() ?? '').split(',').map((cell) => cell.trim().toLowerCase());
  if (header.join(',') !== STATEMENT_HEADER.join(',')) {
    return { ok: false, errors: [`The first row must be: ${STATEMENT_HEADER.join(',')}`] };
  }
  if (rows.length > MAX_STATEMENT_LINES) return { ok: false, errors: [`A statement can have at most ${MAX_STATEMENT_LINES} lines.`] };
  const errors: string[] = [];
  const lines: StatementLine[] = [];
  rows.forEach((row, index) => {
    const lineNumber = index + 2;
    const cells = row.split(',').map((cell) => cell.trim());
    if (cells.length !== STATEMENT_HEADER.length) {
      errors.push(`Line ${lineNumber}: expected ${STATEMENT_HEADER.length} values, found ${cells.length}.`);
      return;
    }
    const [type, providerPaymentId, providerRefundId, amount, currency, occurredAt] = cells;
    const problems: string[] = [];
    if (!(STATEMENT_LINE_TYPES as readonly string[]).includes(type)) problems.push(`type must be one of ${STATEMENT_LINE_TYPES.join(', ')}`);
    if (!providerPaymentId || providerPaymentId.length > 200) problems.push('provider_payment_id is required');
    if (type === 'REFUND' && !providerRefundId) problems.push('a refund needs its provider_refund_id');
    let amountMinor = 0;
    try {
      const parsed = parseKwacha(amount);
      if (parsed <= 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError();
      amountMinor = Number(parsed);
    } catch {
      problems.push('amount must be a positive number in kwacha, to the ngwee');
    }
    if (!/^[A-Z]{3}$/.test(currency)) problems.push('currency must be a three-letter code');
    const when = new Date(occurredAt);
    if (!/^\d{4}-\d\d-\d\dT/.test(occurredAt) || Number.isNaN(when.getTime())) problems.push('occurred_at must be an ISO date and time');
    if (problems.length > 0) {
      errors.push(`Line ${lineNumber}: ${problems.join('; ')}.`);
      return;
    }
    lines.push({
      lineNumber,
      type: type as StatementLineType,
      providerPaymentId,
      providerRefundId: providerRefundId || null,
      amountMinor,
      currency,
      occurredAt: when,
      lineKey: createHash('sha256').update([type, providerPaymentId, providerRefundId, amountMinor, currency, when.toISOString()].join('|')).digest('hex'),
    });
  });
  return errors.length > 0 ? { ok: false, errors: errors.slice(0, 50) } : { ok: true, lines };
}

/** The statement the stand-in provider would send: InsurShield's own records of its payments and refunds. */
export function statementCsv(lines: readonly Omit<StatementLine, 'lineNumber' | 'lineKey'>[]): string {
  const money = (minor: number) => (minor / 100).toFixed(2);
  return `${[
    STATEMENT_HEADER.join(','),
    ...lines.map((line) => [line.type, line.providerPaymentId, line.providerRefundId ?? '', money(line.amountMinor), line.currency, line.occurredAt.toISOString()].join(',')),
  ].join('\n')}\n`;
}
