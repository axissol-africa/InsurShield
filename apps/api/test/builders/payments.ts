import { ncdApplications, type customers, type insurerQuotes, type ncdCodes, type quoteRequests } from '../../src/db/schema.js';
import {
  buildCustomer,
  buildInsurer,
  buildInsurerQuote,
  buildNcdCode,
  buildQuoteRequest,
  unique,
  type BuiltInsurer,
  type Db,
  type Row,
} from '../builders.js';

type Insert<T extends { $inferInsert: unknown }> = T['$inferInsert'];

export interface PayableQuoteOverrides {
  customer?: Row<typeof customers>;
  insurer?: BuiltInsurer;
  request?: Partial<Omit<Insert<typeof quoteRequests>, 'customerId' | 'vehicleId'>>;
  quote?: Partial<Omit<Insert<typeof insurerQuotes>, 'quoteRequestId' | 'insurerId' | 'documentId'>>;
}

/** A customer's quoted request with one insurer's quote, not paid yet. */
export async function buildPayableQuote(db: Db, overrides: PayableQuoteOverrides = {}) {
  const customer = overrides.customer ?? (await buildCustomer(db));
  const insurer = overrides.insurer ?? (await buildInsurer(db));
  const { quoteRequest } = await buildQuoteRequest(
    db,
    { customerId: customer.id, insurerIds: [insurer.insurer.id] },
    {
      status: 'QUOTED',
      policyStartDate: new Date('2026-11-01T00:00:00.000Z'),
      policyEndDate: new Date('2027-10-31T00:00:00.000Z'),
      ...overrides.request,
    },
  );
  const { quote, document } = await buildInsurerQuote(
    db,
    { quoteRequestId: quoteRequest.id, insurerId: insurer.insurer.id, staffId: insurer.staff.id },
    overrides.quote,
  );
  return { customer, insurer, quoteRequest, quote, quotation: document };
}

/** A second insurer's quote on an existing request. */
export async function addQuote(
  db: Db,
  quoteRequestId: string,
  overrides: Partial<Omit<Insert<typeof insurerQuotes>, 'quoteRequestId' | 'insurerId' | 'documentId'>> = {},
) {
  const insurer = await buildInsurer(db);
  const { quote } = await buildInsurerQuote(
    db,
    { quoteRequestId, insurerId: insurer.insurer.id, staffId: insurer.staff.id },
    overrides,
  );
  return { insurer, quote };
}

/** A code the insurer issued by approving this customer's NCD application. */
export async function buildApprovedNcdCode(
  db: Db,
  input: { customerId: string; insurerId: string },
  overrides: Partial<Omit<Insert<typeof ncdCodes>, 'insurerId'>> = {},
) {
  const code = await buildNcdCode(db, { insurerId: input.insurerId }, overrides);
  await db.insert(ncdApplications).values({
    applicationNumber: unique('NCDA'),
    insurerId: input.insurerId,
    customerId: input.customerId,
    policyNumber: 'PA-2023-0045',
    fullName: 'Mwiza Banda',
    phone: '+260971234567',
    yearsClaimFree: code.yearsClaimFree,
    status: 'APPROVED',
    approvedCodeId: code.code,
    decidedAt: new Date(),
  });
  return code;
}
