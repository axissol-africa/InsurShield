import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { createDatabase } from '../src/db/database.module.js';
import { migrateDatabase } from '../src/db/migrator.js';
import * as schema from '../src/db/schema.js';
import type { PaymentEvent } from '../src/payments/provider/payment-provider.js';
import { StandInPaymentProvider } from '../src/payments/provider/stand-in-payment-provider.js';
import { buildCustomer, buildDocument, buildInsurer, buildVehicle, unique } from './builders.js';
import { startApp, type TestApp } from './helpers.js';
import { signIn } from './sessions.js';
import { applyMigrationFiles, createScratchDatabase, migrationTags, recordDrizzleHistory } from './scratch-database.js';

it('replays and confirms a genuinely pre-0048 NCD payment after migration exactly once', async () => {
  const scratch = await createScratchDatabase('legacy_ncd');
  const pool = new Pool({ ...scratch.config, max: 2 });
  let testApp: TestApp | undefined;
  try {
    const tags = migrationTags();
    const through0047 = tags.indexOf('0047_batch_16_claim_lifecycle') + 1;
    expect(through0047).toBeGreaterThan(0);
    const client = await pool.connect();
    const requestId = unique('QR');
    const quoteId = randomUUID();
    const paymentId = randomUUID();
    const applicationId = randomUUID();
    const transactionId = unique('PAY');
    const key = randomUUID();
    const code = unique('NCD').toUpperCase();
    const amountMinor = 123456;
    const providerPaymentId = `SI-P-${amountMinor}-${paymentId}`;
    const initiatedAt = new Date();
    const validUntil = new Date(initiatedAt.getTime() + 86_400_000);
    let customer: Awaited<ReturnType<typeof buildCustomer>>;
    try {
      await applyMigrationFiles(client, through0047);
      await recordDrizzleHistory(client, through0047);
      const { rows: addedColumns } = await client.query(
        `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = $1
         AND ((table_name = $2 AND column_name = $3) OR (table_name = $4 AND column_name = $5)
           OR (table_name = $6 AND column_name = $7))`,
        ['public', 'payments', 'reservedNcdCode', 'insurer_quotes', 'ncdPercentage', 'ncd_applications', 'sourcePolicyNumber'],
      );
      expect(addedColumns).toEqual([]);

      // Only unchanged tables use the current builders. These business rows must have the historical shape.
      const db = createDatabase(pool, { schema });
      customer = await buildCustomer(db);
      const insurer = await buildInsurer(db, { staff: { userId: null } });
      const vehicle = await buildVehicle(db);
      const document = await buildDocument(db, { staffId: insurer.staff.id }, { kind: 'QUOTATION' });
      await client.query(
        `INSERT INTO ncd_codes (code, "insurerId", percentage, "yearsClaimFree", "expiresAt") VALUES ($1, $2, $3, $4, $5)`,
        [code, insurer.insurer.id, 30, 3, validUntil],
      );
      await client.query(
        `INSERT INTO ncd_applications
         (id, "applicationNumber", "insurerId", "customerId", "policyNumber", "fullName", phone, "yearsClaimFree", status, "approvedCodeId", "decidedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [applicationId, unique('NCDA'), insurer.insurer.id, customer.id, unique('LEGACY-POLICY'), customer.fullName, customer.phone, 3, 'APPROVED', code, initiatedAt],
      );
      await client.query(
        `INSERT INTO quote_requests
         (id, status, "expiresAt", "customerId", "vehicleId", "vehicleValueMinor", "vehicleUsage", "insuranceType", "coverageDuration", "ncdCode", "ncdPercentage", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [requestId, 'QUOTED', validUntil, customer.id, vehicle.id, 1000000, 'PRIVATE', 'COMPREHENSIVE', 'Q4', code, 30, initiatedAt],
      );
      await db.insert(schema.quoteRequestRecipients).values({ quoteRequestId: requestId, insurerId: insurer.insurer.id, status: 'ACKNOWLEDGED' });
      await client.query(
        `INSERT INTO insurer_quotes (id, "quoteRequestId", "insurerId", "premiumMinor", "validityDays", "validUntil", "documentId")
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [quoteId, requestId, insurer.insurer.id, amountMinor, 1, validUntil, document.id],
      );
      await client.query(
        `INSERT INTO payments
         (id, "transactionId", status, method, "amountMinor", "idempotencyKey", "customerId", "quoteRequestId", "insurerQuoteId",
          provider, "providerPaymentId", "payerMsisdnMasked", "amountBreakdown", "initiatedAt", "pendingUntil", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15, $14)`,
        [paymentId, transactionId, 'PENDING', 'MOBILE_MONEY', amountMinor, key, customer.id, requestId, quoteId,
          'STAND_IN', providerPaymentId, '***003', JSON.stringify([{ kind: 'PREMIUM', code: 'PREMIUM', label: 'Premium', amountMinor }]), initiatedAt, validUntil],
      );
    } finally {
      client.release();
    }

    const migrated = await migrateDatabase(scratch.config);
    expect(migrated.applied).toEqual(tags.slice(through0047));
    testApp = await startApp({ env: { DATABASE_URL: scratch.url, DATABASE_POOL_SIZE: '2' } });
    const app = testApp;
    const [legacyApplication] = await app.db.select().from(schema.ncdApplications).where(eq(schema.ncdApplications.id, applicationId));
    expect(legacyApplication).toMatchObject({ sourcePolicyNumber: null, sourceVehicleId: null, declarationAcceptedAt: null, approvedCodeId: code });
    const [legacyQuote] = await app.db.select().from(schema.insurerQuotes).where(eq(schema.insurerQuotes.id, quoteId));
    expect(legacyQuote).toMatchObject({ ncdPercentage: null, premiumMinor: amountMinor });
    const payment = async () => (await app.db.select().from(schema.payments).where(eq(schema.payments.id, paymentId)))[0];
    expect(await payment()).toMatchObject({ status: 'PENDING', reservedNcdCode: null, idempotencyKey: key, providerPaymentId });

    const session = await signIn(app.http, customer);
    const retry = () => app.http.post('/api/v1/payments').set(session).set('Idempotency-Key', key).send({
      quoteRequestId: requestId, insurerQuoteId: quoteId, amount: amountMinor / 100, method: 'Mobile money', mobileNumber: '+260970000003',
    });
    const first = await retry();
    const second = await retry();
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ transactionId, status: 'Pending', amount: amountMinor / 100 });
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(await app.db.select().from(schema.payments).where(eq(schema.payments.quoteRequestId, requestId))).toHaveLength(1);

    const provider = app.app.get(StandInPaymentProvider);
    const event: PaymentEvent = { eventId: unique('SIE'), type: 'payment.confirmed', providerPaymentId,
      paymentId, amountMinor, currency: 'ZMW', reference: unique('SIR'), reason: null, occurredAt: new Date() };
    const signed = provider.sign(event);
    const callback = () => app.http.post('/api/v1/payments/callbacks/stand-in').set(signed.headers).send(signed.rawBody.toString('utf8'));
    const confirmed = await callback();
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toEqual({ eventId: event.eventId, outcome: 'POLICY_CREATED', replayed: false });
    const [redeemed] = await app.db.select().from(schema.ncdCodes).where(eq(schema.ncdCodes.code, code));
    expect(redeemed.redeemedAt).toBeInstanceOf(Date);
    const duplicate = await callback();
    expect(duplicate.status).toBe(200);
    expect(duplicate.body).toEqual({ eventId: event.eventId, outcome: 'POLICY_CREATED', replayed: true });
    const [afterReplay] = await app.db.select().from(schema.ncdCodes).where(eq(schema.ncdCodes.code, code));
    expect(afterReplay.redeemedAt).toEqual(redeemed.redeemedAt);
    const issued = await app.db.select().from(schema.policies).where(eq(schema.policies.paymentId, paymentId));
    expect(issued).toHaveLength(1);
    expect(issued[0]).toMatchObject({ quoteRequestId: requestId, insurerQuoteId: quoteId, premiumMinor: amountMinor });
    expect(await app.db.select().from(schema.paymentCallbacks).where(eq(schema.paymentCallbacks.eventId, event.eventId))).toHaveLength(1);
    expect(await payment()).toMatchObject({ status: 'CONFIRMED', reservedNcdCode: null, providerPaymentId });
  } finally {
    try { await testApp?.close(); } finally {
      try { await pool.end(); } finally { await scratch.drop(); }
    }
  }
}, 120_000);
