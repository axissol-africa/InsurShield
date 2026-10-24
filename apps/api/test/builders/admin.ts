import {
  consentRecords,
  ncdApplications,
  piaConfig,
  type customers,
  type payments,
  type policies,
} from '../../src/db/schema.js';
import {
  buildCustomer,
  buildInsurer,
  buildInsurerQuote,
  buildPayment,
  buildPolicy,
  buildQuoteRequest,
  unique,
  type BuiltInsurer,
  type Db,
  type Row,
} from '../builders.js';

type Insert<T extends { $inferInsert: unknown }> = T['$inferInsert'];

/** The single PIA row, written whether or not one exists. */
export async function buildPiaConfig(db: Db, overrides: Partial<Omit<Insert<typeof piaConfig>, 'id'>> = {}) {
  const values = { piaRateBps: 400, ...overrides };
  const [config] = await db
    .insert(piaConfig)
    .values({ id: 'current', ...values })
    .onConflictDoUpdate({ target: piaConfig.id, set: { ...values, updatedAt: new Date() } })
    .returning();
  return config;
}

export interface Parties {
  customer?: Row<typeof customers>;
  insurer?: BuiltInsurer;
}

/** A customer's quoted request with one insurer's quote, against which payments can be recorded. */
export async function buildPaymentTarget(db: Db, parties: Parties = {}) {
  const customer = parties.customer ?? (await buildCustomer(db));
  const insurer = parties.insurer ?? (await buildInsurer(db));
  const { quoteRequest } = await buildQuoteRequest(
    db,
    { customerId: customer.id, insurerIds: [insurer.insurer.id] },
    { status: 'QUOTED' },
  );
  const { quote } = await buildInsurerQuote(db, {
    quoteRequestId: quoteRequest.id,
    insurerId: insurer.insurer.id,
    staffId: insurer.staff.id,
  });
  return {
    customerId: customer.id,
    quoteRequestId: quoteRequest.id,
    insurerQuoteId: quote.id,
    insurerId: insurer.insurer.id,
    vehicleId: quoteRequest.vehicleId,
  };
}

export type PaymentTarget = Awaited<ReturnType<typeof buildPaymentTarget>>;

/** Confirmed payments of these amounts in ngwee, all confirmed at one instant. */
export async function buildConfirmedPayments(
  db: Db,
  target: PaymentTarget,
  amountsMinor: number[],
  confirmedAt: Date,
) {
  const built: Row<typeof payments>[] = [];
  for (const amountMinor of amountsMinor) {
    built.push(
      await buildPayment(
        db,
        { customerId: target.customerId, quoteRequestId: target.quoteRequestId, insurerQuoteId: target.insurerQuoteId },
        { status: 'CONFIRMED', amountMinor, confirmedAt },
      ),
    );
  }
  return built;
}

/** A policy bought with a confirmed payment, its own fields overridable. */
export async function buildSoldPolicy(
  db: Db,
  parties: Parties = {},
  overrides: Partial<Omit<Insert<typeof policies>, 'insurerId' | 'customerId' | 'vehicleId' | 'paymentId'>> = {},
) {
  const target = await buildPaymentTarget(db, parties);
  const [payment] = await buildConfirmedPayments(db, target, [123_456], new Date());
  const policy = await buildPolicy(
    db,
    { insurerId: target.insurerId, customerId: target.customerId, vehicleId: target.vehicleId, paymentId: payment.id },
    { quoteRequestId: target.quoteRequestId, insurerQuoteId: target.insurerQuoteId, ...overrides },
  );
  return { target, payment, policy };
}

export async function buildConsent(
  db: Db,
  customerId: string,
  overrides: Partial<Omit<Insert<typeof consentRecords>, 'customerId'>> = {},
) {
  const [consent] = await db
    .insert(consentRecords)
    .values({ customerId, privacyVersion: 'privacy-1', termsVersion: 'terms-1', ...overrides })
    .returning();
  return consent;
}

export async function buildNcdApplication(
  db: Db,
  input: { insurerId: string; customerId?: string },
  overrides: Partial<Omit<Insert<typeof ncdApplications>, 'insurerId' | 'customerId'>> = {},
) {
  const [application] = await db
    .insert(ncdApplications)
    .values({
      ...input,
      applicationNumber: unique('NCD'),
      policyNumber: unique('POL'),
      fullName: 'Natasha Zulu',
      phone: '+260977000000',
      yearsClaimFree: 3,
      ...overrides,
    })
    .returning();
  return application;
}
