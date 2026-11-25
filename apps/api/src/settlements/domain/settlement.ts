/** Lusaka keeps UTC+2 all year, so a calendar month there starts two hours before UTC midnight. */
const LUSAKA_OFFSET_MS = 2 * 60 * 60 * 1000;

export interface Period {
  label: string;
  start: Date;
  /** Exclusive: the first moment of the next month. */
  end: Date;
}

/** A Lusaka calendar month, from `YYYY-MM`. */
export function monthlyPeriod(label: string): Period | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(label);
  if (!match) return null;
  const [year, month] = [Number(match[1]), Number(match[2])];
  return {
    label,
    start: new Date(Date.UTC(year, month - 1, 1) - LUSAKA_OFFSET_MS),
    end: new Date(Date.UTC(year, month, 1) - LUSAKA_OFFSET_MS),
  };
}

/** One confirmed payment as it lands in a settlement: what is the insurer's, and what is a charge for someone else. */
export interface PaymentLineInput {
  paymentId: string;
  /** Premium and add-ons: the insurer's money. */
  premiumMinor: number;
  /** Approved levies and fees collected with it, which are not the insurer's. */
  feesMinor: number;
}

export interface SettlementInput {
  payments: readonly PaymentLineInput[];
  /** Completed refunds on cover that stayed live, which come out of the insurer's money. */
  refunds: readonly { refundId: string; amountMinor: number }[];
  /** Approved adjustments, signed: positive pays the insurer more. */
  adjustments: readonly { adjustmentId: string; amountMinor: number }[];
  commissionBps: number;
}

export interface SettlementTotals {
  grossPremiumMinor: number;
  feesMinor: number;
  refundsMinor: number;
  adjustmentsMinor: number;
  commissionMinor: number;
  netPayableMinor: number;
}

/**
 * What InsurShield owes an insurer for a period. Commission is taken on the
 * gross premium, rounded half up to the ngwee; refunds and adjustments then
 * move the net. All integers, so the export adds up exactly.
 */
export function settlementTotals(input: SettlementInput): SettlementTotals {
  const grossPremiumMinor = sum(input.payments.map((payment) => payment.premiumMinor));
  const feesMinor = sum(input.payments.map((payment) => payment.feesMinor));
  const refundsMinor = sum(input.refunds.map((refund) => refund.amountMinor));
  const adjustmentsMinor = sum(input.adjustments.map((adjustment) => adjustment.amountMinor));
  const commissionMinor = Math.floor((grossPremiumMinor * input.commissionBps + 5_000) / 10_000);
  return {
    grossPremiumMinor,
    feesMinor,
    refundsMinor,
    adjustmentsMinor,
    commissionMinor,
    netPayableMinor: grossPremiumMinor - refundsMinor + adjustmentsMinor - commissionMinor,
  };
}

/** Splits a payment's stored breakdown into the insurer's money and the charges. */
export function splitBreakdown(lines: readonly { kind: string; amountMinor: number }[]): { premiumMinor: number; feesMinor: number } {
  return {
    premiumMinor: sum(lines.filter((line) => line.kind !== 'CHARGE').map((line) => line.amountMinor)),
    feesMinor: sum(lines.filter((line) => line.kind === 'CHARGE').map((line) => line.amountMinor)),
  };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** The export a finalised settlement is read from: one row per line, then the totals. */
export function settlementCsv(
  header: { insurer: string; period: string; reference: string },
  lines: readonly { kind: string; reference: string; occurredAt: Date; amountMinor: number; feeMinor: number }[],
  totals: SettlementTotals,
): string {
  const money = (minor: number) => (minor / 100).toFixed(2);
  const cell = (value: string) => (/[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
  const rows = [
    ['settlement', header.reference],
    ['insurer', header.insurer],
    ['period', header.period],
    [],
    ['kind', 'reference', 'date', 'amount_zmw', 'fees_zmw'],
    ...lines.map((line) => [line.kind, line.reference, line.occurredAt.toISOString(), money(line.amountMinor), money(line.feeMinor)]),
    [],
    ['gross_premium_zmw', money(totals.grossPremiumMinor)],
    ['fees_zmw', money(totals.feesMinor)],
    ['refunds_zmw', money(totals.refundsMinor)],
    ['adjustments_zmw', money(totals.adjustmentsMinor)],
    ['commission_zmw', money(totals.commissionMinor)],
    ['net_payable_zmw', money(totals.netPayableMinor)],
  ];
  return `${rows.map((row) => row.map((value) => cell(String(value))).join(',')).join('\n')}\n`;
}
