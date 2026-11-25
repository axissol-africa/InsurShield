import { and, eq, inArray } from 'drizzle-orm';
import { payments, providerStatementImports, reconciliationItems } from '../src/db/schema.js';
import { buildCustomer, buildInsurer, buildPurchasedPolicy, buildStaffUser } from './builders.js';
import { startApp, type TestApp } from './helpers.js';
import { signIn } from './sessions.js';

type Session = Awaited<ReturnType<typeof signIn>>;
const HEADER = 'type,provider_payment_id,provider_refund_id,amount,currency,occurred_at';

describe('provider statement import', () => {
  let testApp: TestApp;
  let session: Session;
  // Each test reconciles its own year, so payments from other tests never fall in its period.
  let year = 2001;

  beforeAll(async () => {
    testApp = await startApp();
    session = await signIn(testApp.http, await buildStaffUser(testApp.db, { role: 'ADMIN', fullName: 'Sipho Statements' }));
  });

  afterAll(async () => {
    await testApp.close();
  });

  const period = () => {
    year += 1;
    return { periodStart: `${year}-03-01T00:00:00.000Z`, periodEnd: `${year}-04-01T00:00:00.000Z`, day: (d: number) => `${year}-03-${String(d).padStart(2, '0')}T08:00:00.000Z` };
  };
  const upload = (window: { periodStart: string; periodEnd: string }, csv: string, fileName = 'statement.csv') =>
    testApp.http.post('/api/v1/admin/reconciliation/statements').set(session).send({ fileName, periodStart: window.periodStart, periodEnd: window.periodEnd, csv });

  /** A confirmed stand-in payment of 1 234.56 on `confirmedAt`. */
  async function payment(confirmedAt: string) {
    const bought = await buildPurchasedPolicy(testApp.db, { insurer: await buildInsurer(testApp.db) });
    const providerPaymentId = `SI-C-123456-${bought.payment.id}`;
    await testApp.db.update(payments).set({ provider: 'STAND_IN', providerPaymentId, confirmedAt: new Date(confirmedAt) }).where(eq(payments.id, bought.payment.id));
    return { ...bought, providerPaymentId };
  }
  const itemsOf = (paymentIds: string[]) => testApp.db.select().from(reconciliationItems).where(inArray(reconciliationItems.paymentId, paymentIds));

  it('matches what agrees, and opens an item for each line that does not and each payment missing from it', async () => {
    const window = period();
    const matching = await payment(window.day(2));
    const wrongAmount = await payment(window.day(3));
    const missing = await payment(window.day(4));
    const beforeTheProvider = await payment(window.day(6));
    await testApp.db.update(payments).set({ providerPaymentId: null }).where(eq(payments.id, beforeTheProvider.payment.id));
    const csv = [
      HEADER,
      `CHARGE,${matching.providerPaymentId},,1234.56,ZMW,${window.day(2)}`,
      `CHARGE,${wrongAmount.providerPaymentId},,1200.00,ZMW,${window.day(3)}`,
      `CHARGE,SI-C-1-unknown-${year},,50.00,ZMW,${window.day(5)}`,
    ].join('\n');

    const imported = await upload(window, csv);

    expect(imported.status).toBe(201);
    expect(imported.body).toMatchObject({ lineCount: 3, newLines: 3, matched: 1, itemsOpened: 3, replayed: false });
    const items = await itemsOf([matching.payment.id, wrongAmount.payment.id, missing.payment.id, beforeTheProvider.payment.id]);
    expect(items.map((item) => [item.paymentId, item.kind]).sort()).toEqual(
      [
        [wrongAmount.payment.id, 'STATEMENT_UNMATCHED'],
        [missing.payment.id, 'MISSING_FROM_STATEMENT'],
      ].sort(),
    );
    const [unknown] = await testApp.db
      .select()
      .from(reconciliationItems)
      .where(and(eq(reconciliationItems.kind, 'STATEMENT_UNMATCHED'), eq(reconciliationItems.amountMinor, 5_000)));
    expect(unknown.reason).toContain(`SI-C-1-unknown-${year}`);

    // The same file again changes nothing.
    const again = await upload(window, csv);
    expect(again.body).toMatchObject({ id: imported.body.id, replayed: true });
    expect(await itemsOf([matching.payment.id, wrongAmount.payment.id, missing.payment.id])).toHaveLength(2);

    // An overlapping statement adds only its new lines: the missing payment is found, a repeat charge is a duplicate.
    const later = await upload(
      window,
      [
        HEADER,
        `CHARGE,${matching.providerPaymentId},,1234.56,ZMW,${window.day(2)}`,
        `CHARGE,${missing.providerPaymentId},,1234.56,ZMW,${window.day(4)}`,
        `CHARGE,${matching.providerPaymentId},,1234.56,ZMW,${window.day(9)}`,
      ].join('\n'),
      'statement-2.csv',
    );
    expect(later.body).toMatchObject({ lineCount: 3, newLines: 2, matched: 1, itemsOpened: 1 });
    const after = await itemsOf([matching.payment.id, missing.payment.id]);
    expect(after.find((item) => item.kind === 'MISSING_FROM_STATEMENT')).toMatchObject({ status: 'RESOLVED', outcome: 'NO_ACTION' });
    expect(after.find((item) => item.kind === 'DUPLICATE')).toMatchObject({ status: 'OPEN', paymentId: matching.payment.id });
  });

  it('refuses a file with a bad line, naming it, and stores nothing', async () => {
    const window = period();
    const refused = await upload(window, `${HEADER}\nCHARGE,SI-C-1,,12.345,ZMW,${window.day(2)}\n`);
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ code: 'STATEMENT_INVALID', details: { lines: ['Line 2: amount must be a positive number in kwacha, to the ngwee.'] } });
    expect(await testApp.db.select().from(providerStatementImports).where(eq(providerStatementImports.periodStart, new Date(window.periodStart)))).toEqual([]);
  });

  it("imports the stand-in's own statement with everything matched", async () => {
    const window = period();
    await payment(window.day(10));
    await payment(window.day(11));
    const statement = await testApp.http
      .get(`/api/v1/admin/reconciliation/stand-in-statement?from=${window.periodStart}&to=${window.periodEnd}`)
      .set(session);
    expect(statement.headers['content-type']).toContain('text/csv');
    const imported = await upload(window, statement.text);
    expect(imported.body).toMatchObject({ newLines: 2, matched: 2, itemsOpened: 0 });
    const listed = await testApp.http.get('/api/v1/admin/reconciliation/statements').set(session);
    expect(listed.body[0]).toMatchObject({ id: imported.body.id, importedBy: 'Sipho Statements' });
  });

  it('is InsurShield administrators only', async () => {
    const window = period();
    const insurer = await buildInsurer(testApp.db);
    const customer = await buildCustomer(testApp.db);
    for (const other of [await signIn(testApp.http, insurer.staff), await signIn(testApp.http, customer)]) {
      const refused = await testApp.http
        .post('/api/v1/admin/reconciliation/statements')
        .set(other)
        .send({ fileName: 'x.csv', periodStart: window.periodStart, periodEnd: window.periodEnd, csv: `${HEADER}\n` });
      expect(refused.status).toBe(403);
    }
  });
});
