import { parseStatement, statementCsv } from './statement.js';

const HEADER = 'type,provider_payment_id,provider_refund_id,amount,currency,occurred_at';

describe('parseStatement', () => {
  it('reads each line into ngwee with a stable key', () => {
    const parsed = parseStatement(`${HEADER}\nCHARGE,SI-C-1,,1234.56,ZMW,2026-10-02T08:00:00.000Z\r\nREFUND,SI-C-1,SIRF-1,100,ZMW,2026-10-03T08:00:00Z\n`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.lines.map((line) => [line.lineNumber, line.type, line.amountMinor, line.providerRefundId])).toEqual([
      [2, 'CHARGE', 123_456, null],
      [3, 'REFUND', 10_000, 'SIRF-1'],
    ]);
    const again = parseStatement(`${HEADER}\nCHARGE,SI-C-1,,1234.56,ZMW,2026-10-02T08:00:00.000Z\n`);
    expect(again.ok && again.lines[0].lineKey).toBe(parsed.lines[0].lineKey);
  });

  it('refuses the whole file, naming every bad line', () => {
    const parsed = parseStatement(`${HEADER}\nCHARGE,SI-C-1,,12.345,ZMW,2026-10-02T08:00:00Z\nREFUND,SI-C-1,,10,zmw,yesterday\nBONUS,X,,1,ZMW,2026-10-02T08:00:00Z\n`);
    expect(parsed).toEqual({
      ok: false,
      errors: [
        'Line 2: amount must be a positive number in kwacha, to the ngwee.',
        'Line 3: a refund needs its provider_refund_id; currency must be a three-letter code; occurred_at must be an ISO date and time.',
        'Line 4: type must be one of CHARGE, REFUND, REVERSAL.',
      ],
    });
  });

  it('refuses a file without the expected header', () => {
    expect(parseStatement('id,amount\n1,2\n')).toEqual({ ok: false, errors: [`The first row must be: ${HEADER}`] });
  });

  it('reads back what it writes', () => {
    const csv = statementCsv([{ type: 'CHARGE', providerPaymentId: 'SI-C-9', providerRefundId: null, amountMinor: 500, currency: 'ZMW', occurredAt: new Date('2026-10-02T08:00:00.000Z') }]);
    const parsed = parseStatement(csv);
    expect(parsed.ok && parsed.lines[0]).toMatchObject({ providerPaymentId: 'SI-C-9', amountMinor: 500 });
  });
});
