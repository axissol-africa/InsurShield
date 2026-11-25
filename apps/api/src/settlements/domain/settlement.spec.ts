import { monthlyPeriod, settlementCsv, settlementTotals, splitBreakdown } from './settlement.js';

describe('monthlyPeriod', () => {
  it('starts and ends at midnight in Lusaka', () => {
    expect(monthlyPeriod('2026-11')).toEqual({
      label: '2026-11',
      start: new Date('2026-10-31T22:00:00.000Z'),
      end: new Date('2026-11-30T22:00:00.000Z'),
    });
    expect(monthlyPeriod('2026-12')?.end).toEqual(new Date('2026-12-31T22:00:00.000Z'));
  });

  it.each(['2026-13', '2026-1', 'November', ''])('refuses %j', (label) => {
    expect(monthlyPeriod(label)).toBeNull();
  });
});

describe('settlementTotals', () => {
  it('takes commission on the gross premium, then moves the net by refunds and adjustments', () => {
    expect(
      settlementTotals({
        payments: [
          { paymentId: 'a', premiumMinor: 100_000, feesMinor: 5_000 },
          { paymentId: 'b', premiumMinor: 50_001, feesMinor: 0 },
        ],
        refunds: [{ refundId: 'r', amountMinor: 10_000 }],
        adjustments: [{ adjustmentId: 'x', amountMinor: -2_500 }, { adjustmentId: 'y', amountMinor: 1_000 }],
        commissionBps: 750,
      }),
    ).toEqual({
      grossPremiumMinor: 150_001,
      feesMinor: 5_000,
      refundsMinor: 10_000,
      adjustmentsMinor: -1_500,
      // 150 001 x 7.5% = 11 250.075, rounded to 11 250.
      commissionMinor: 11_250,
      netPayableMinor: 150_001 - 10_000 - 1_500 - 11_250,
    });
  });

  it('is all zeros for an empty period', () => {
    expect(settlementTotals({ payments: [], refunds: [], adjustments: [], commissionBps: 0 }).netPayableMinor).toBe(0);
  });
});

describe('splitBreakdown', () => {
  it('keeps premium and add-ons for the insurer and sets charges apart', () => {
    expect(
      splitBreakdown([
        { kind: 'PREMIUM', amountMinor: 100_000 },
        { kind: 'ADD_ON', amountMinor: 15_000 },
        { kind: 'CHARGE', amountMinor: 5_000 },
      ]),
    ).toEqual({ premiumMinor: 115_000, feesMinor: 5_000 });
  });
});

describe('settlementCsv', () => {
  it('writes each line and totals that add up, quoting what needs it', () => {
    const csv = settlementCsv(
      { insurer: 'Prestige, Assurance', period: '2026-11', reference: 'SET-1' },
      [{ kind: 'PAYMENT', reference: 'TXN-1', occurredAt: new Date('2026-11-02T08:00:00.000Z'), amountMinor: 123_456, feeMinor: 500 }],
      settlementTotals({ payments: [{ paymentId: 'p', premiumMinor: 123_456, feesMinor: 500 }], refunds: [], adjustments: [], commissionBps: 0 }),
    );
    expect(csv).toContain('insurer,"Prestige, Assurance"');
    expect(csv).toContain('PAYMENT,TXN-1,2026-11-02T08:00:00.000Z,1234.56,5.00');
    expect(csv).toContain('net_payable_zmw,1234.56');
  });
});
