import { randomBytes, randomUUID } from 'node:crypto';
import type { Database, Transaction } from '../src/db/database.module.js';
import {
  claimNotifications,
  customers,
  documents,
  inspections,
  insurerContacts,
  insurerQuotes,
  insurers,
  ncdCodes,
  payments,
  policies,
  quoteRequestRecipients,
  quoteRequests,
  staffUsers,
  vehicles,
} from '../src/db/schema.js';

/** A database handle or a transaction: builders run in either. */
export type Db = Database | Transaction;

type Insert<T extends { $inferInsert: unknown }> = T['$inferInsert'];
export type Row<T extends { $inferSelect: unknown }> = T['$inferSelect'];

const DAY_MS = 86_400_000;

/** A value no other builder call in this run produces, for unique columns. */
export function unique(prefix: string): string {
  return `${prefix}-${randomBytes(6).toString('hex')}`;
}

// Twelve random digits: a clash within one run is about as likely as a UUID clash.
function uniquePhone(): string {
  return `+260${(BigInt(`0x${randomBytes(6).toString('hex')}`) % 10n ** 12n).toString().padStart(12, '0')}`;
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * DAY_MS);
}

export async function buildCustomer(db: Db, overrides: Partial<Insert<typeof customers>> = {}) {
  const tag = unique('customer');
  const [customer] = await db
    .insert(customers)
    .values({
      fullName: 'Chanda Mwale',
      email: `${tag}@example.invalid`,
      phone: uniquePhone(),
      keycloakId: randomUUID(),
      ...overrides,
    })
    .returning();
  return customer;
}

export async function buildStaffUser(db: Db, overrides: Partial<Insert<typeof staffUsers>> = {}) {
  const tag = unique('staff');
  const [staff] = await db
    .insert(staffUsers)
    .values({
      email: `${tag}@example.invalid`,
      fullName: 'Mutale Banda',
      role: 'ADMIN',
      keycloakId: randomUUID(),
      ...overrides,
    })
    .returning();
  return staff;
}

export interface InsurerOverrides {
  insurer?: Partial<Insert<typeof insurers>>;
  contact?: Partial<Omit<Insert<typeof insurerContacts>, 'insurerId'>>;
  staff?: Partial<Omit<Insert<typeof staffUsers>, 'insurerId'>>;
}

/** An active insurer with its contact and one INSURER_USER staff member. */
export async function buildInsurer(db: Db, overrides: InsurerOverrides = {}) {
  const [insurer] = await db
    .insert(insurers)
    .values({
      name: unique('Insurer'),
      rateBps: 525,
      quoteValidityDays: 14,
      coverage: 'Comprehensive',
      ...overrides.insurer,
    })
    .returning();
  const [contact] = await db
    .insert(insurerContacts)
    .values({
      insurerId: insurer.id,
      contactPerson: 'Bwalya Phiri',
      role: 'Underwriting manager',
      phone: '+260211000000',
      email: `${unique('contact')}@example.invalid`,
      ...overrides.contact,
    })
    .returning();
  const staff = await buildStaffUser(db, { role: 'INSURER_USER', ...overrides.staff, insurerId: insurer.id });
  return { insurer, contact, staff };
}

export async function buildVehicle(db: Db, overrides: Partial<Insert<typeof vehicles>> = {}) {
  const [vehicle] = await db
    .insert(vehicles)
    .values({
      plateNumber: `ABC ${randomBytes(2).readUInt16BE() % 10_000}`,
      make: 'Toyota',
      model: 'Corolla',
      year: '2019',
      ...overrides,
    })
    .returning();
  return vehicle;
}

export type Uploader = { customerId: string } | { staffId: string };

export async function buildDocument(
  db: Db,
  uploader: Uploader,
  overrides: Partial<Omit<Insert<typeof documents>, 'uploadedByCustomerId' | 'uploadedByStaffId'>> = {},
) {
  const [document] = await db
    .insert(documents)
    .values({
      kind: 'QUOTATION',
      fileName: 'document.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      storageKey: unique('fake/document'),
      ...overrides,
      uploadedByCustomerId: 'customerId' in uploader ? uploader.customerId : null,
      uploadedByStaffId: 'staffId' in uploader ? uploader.staffId : null,
    })
    .returning();
  return document;
}

export interface QuoteRequestInput {
  customerId: string;
  /** Insurers the request was sent to; one recipient row each. */
  insurerIds: string[];
  /** A new vehicle when absent. */
  vehicleId?: string;
}

/** A submitted quote request and its recipients. */
export async function buildQuoteRequest(
  db: Db,
  input: QuoteRequestInput,
  overrides: Partial<Omit<Insert<typeof quoteRequests>, 'customerId' | 'vehicleId'>> = {},
) {
  const vehicleId = input.vehicleId ?? (await buildVehicle(db)).id;
  const [quoteRequest] = await db
    .insert(quoteRequests)
    .values({
      id: unique('QR'),
      expiresAt: daysFromNow(7),
      customerId: input.customerId,
      vehicleId,
      vehicleValueMinor: 15_000_000,
      vehicleUsage: 'PRIVATE',
      insuranceType: 'COMPREHENSIVE',
      coverageDuration: 'Q4',
      ...overrides,
    })
    .returning();
  const recipients =
    input.insurerIds.length === 0
      ? []
      : await db
          .insert(quoteRequestRecipients)
          .values(input.insurerIds.map((insurerId) => ({ quoteRequestId: quoteRequest.id, insurerId })))
          .returning();
  return { quoteRequest, recipients };
}

export interface InsurerQuoteInput {
  quoteRequestId: string;
  insurerId: string;
  /** The staff member who uploads the quotation document. */
  staffId: string;
}

/** An insurer's quote with its quotation document, uploaded by that insurer's staff member. */
export async function buildInsurerQuote(
  db: Db,
  input: InsurerQuoteInput,
  overrides: Partial<Omit<Insert<typeof insurerQuotes>, 'quoteRequestId' | 'insurerId' | 'documentId'>> = {},
) {
  const document = await buildDocument(db, { staffId: input.staffId }, { kind: 'QUOTATION' });
  const [quote] = await db
    .insert(insurerQuotes)
    .values({
      quoteRequestId: input.quoteRequestId,
      insurerId: input.insurerId,
      premiumMinor: 123_456,
      validityDays: 14,
      validUntil: daysFromNow(14),
      insurerReference: unique('IQ'),
      ...overrides,
      documentId: document.id,
    })
    .returning();
  return { quote, document };
}

export interface PaymentInput {
  customerId: string;
  quoteRequestId: string;
  insurerQuoteId: string;
}

export async function buildPayment(
  db: Db,
  input: PaymentInput,
  overrides: Partial<Omit<Insert<typeof payments>, keyof PaymentInput>> = {},
) {
  const [payment] = await db
    .insert(payments)
    .values({
      ...input,
      transactionId: unique('TXN'),
      method: 'MOBILE_MONEY',
      amountMinor: 123_456,
      idempotencyKey: randomUUID(),
      ...overrides,
    })
    .returning();
  return payment;
}

export interface PolicyInput {
  insurerId: string;
  customerId: string;
  vehicleId: string;
  paymentId: string;
}

export async function buildPolicy(
  db: Db,
  input: PolicyInput,
  overrides: Partial<Omit<Insert<typeof policies>, keyof PolicyInput>> = {},
) {
  const [policy] = await db
    .insert(policies)
    .values({
      ...input,
      policyNumber: unique('POL'),
      coverage: 'Comprehensive',
      premiumMinor: 123_456,
      ...overrides,
    })
    .returning();
  return policy;
}

/**
 * The whole purchase: a customer's quote request sent to one insurer, that insurer's quote,
 * a confirmed payment and the policy it bought.
 */
export type BuiltInsurer = Awaited<ReturnType<typeof buildInsurer>>;

export async function buildPurchasedPolicy(
  db: Db,
  parties: { customer?: Row<typeof customers>; insurer?: BuiltInsurer } = {},
) {
  const customer = parties.customer ?? (await buildCustomer(db));
  const insurer = parties.insurer ?? (await buildInsurer(db));
  const { quoteRequest, recipients } = await buildQuoteRequest(
    db,
    { customerId: customer.id, insurerIds: [insurer.insurer.id] },
    { status: 'QUOTED' },
  );
  const { quote, document: quotation } = await buildInsurerQuote(db, {
    quoteRequestId: quoteRequest.id,
    insurerId: insurer.insurer.id,
    staffId: insurer.staff.id,
  });
  const payment = await buildPayment(
    db,
    { customerId: customer.id, quoteRequestId: quoteRequest.id, insurerQuoteId: quote.id },
    { status: 'CONFIRMED', confirmedAt: new Date(), amountMinor: quote.premiumMinor },
  );
  const policy = await buildPolicy(
    db,
    { insurerId: insurer.insurer.id, customerId: customer.id, vehicleId: quoteRequest.vehicleId, paymentId: payment.id },
    {
      premiumMinor: quote.premiumMinor,
      quoteRequestId: quoteRequest.id,
      insurerQuoteId: quote.id,
      insurerQuoteReference: quote.insurerReference,
      quoteDocumentId: quotation.id,
    },
  );
  return { customer, insurer, quoteRequest, recipients, quote, quotation, payment, policy };
}

export interface ClaimInput {
  insurerId: string;
  customerId?: string | null;
  policyNumber?: string | null;
}

export async function buildClaim(
  db: Db,
  input: ClaimInput,
  overrides: Partial<Omit<Insert<typeof claimNotifications>, keyof ClaimInput>> = {},
) {
  const [claim] = await db
    .insert(claimNotifications)
    .values({
      ...input,
      claimNumber: unique('CLM'),
      fullName: 'Chanda Mwale',
      phone: '+260971000000',
      plate: 'ABC 1234',
      vehicleLabel: 'Toyota Corolla 2019',
      type: 'COLLISION',
      incidentDate: daysFromNow(-1),
      location: 'Cairo Road, Lusaka',
      description: 'Rear-ended at a junction.',
      ...overrides,
    })
    .returning();
  return claim;
}

export async function buildNcdCode(
  db: Db,
  input: { insurerId: string },
  overrides: Partial<Omit<Insert<typeof ncdCodes>, 'insurerId'>> = {},
) {
  const [code] = await db
    .insert(ncdCodes)
    .values({
      insurerId: input.insurerId,
      code: unique('NCD').toUpperCase(),
      percentage: 20,
      yearsClaimFree: 2,
      expiresAt: daysFromNow(90),
      ...overrides,
    })
    .returning();
  return code;
}

export async function buildInspection(
  db: Db,
  input: { customerId: string; insurerId?: string | null },
  overrides: Partial<Omit<Insert<typeof inspections>, 'customerId' | 'insurerId'>> = {},
) {
  const [inspection] = await db
    .insert(inspections)
    .values({
      ...input,
      id: unique('INS'),
      vehiclePlate: 'ABC 1234',
      vehicleLabel: 'Toyota Corolla 2019',
      ...overrides,
    })
    .returning();
  return inspection;
}
