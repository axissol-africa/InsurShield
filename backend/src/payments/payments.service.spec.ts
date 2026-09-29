import { PaymentsService } from './payments.service.js';
import { ApiException } from '../common/errors/api.exception.js';
import type { PayDto } from './dto/payment.dto.js';

/**
 * What may and may not take a customer's money, against a stand-in Prisma.
 *
 * The rules under test are the ones that protect the customer: the amount is
 * the insurer's, not the caller's; an expired offer cannot be bought; a retry
 * cannot charge twice; and a confirmed payment produces a policy that is still
 * waiting for the insurer's certificate rather than an active one.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const inDays = (days: number) => new Date(Date.now() + days * DAY_MS);

const decimal = (value: number) => ({ toNumber: () => value });

const quoteRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'quote-1',
  premium: decimal(10900),
  notes: null,
  insurerReference: 'PA-Q-2026-00412',
  documentId: 'doc-1',
  validUntil: inDays(5),
  insurer: { id: 'insurer-1', name: 'Prestige Assurance' },
  ...overrides,
});

const requestRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'QR-1',
  vehicleId: 'vehicle-1',
  insuranceType: 'COMPREHENSIVE',
  policyStartDate: inDays(0),
  policyEndDate: inDays(365),
  ncdCode: null,
  quotes: [quoteRow()],
  policies: [],
  vehicle: { plateNumber: 'BAA 1234' },
  ...overrides,
});

const payDto = (overrides: Partial<PayDto> = {}): PayDto => ({
  quoteRequestId: 'QR-1',
  insurer: 'Prestige Assurance',
  amount: 10900,
  method: 'Mobile money',
  ...overrides,
});

/** Only the calls the payment path makes. */
const buildService = (
  request: ReturnType<typeof requestRow> | null,
  existingPayment: Record<string, unknown> | null = null,
) => {
  const payments: Record<string, unknown>[] = [];
  const policies: Record<string, unknown>[] = [];
  const redeemed: Record<string, unknown>[] = [];

  const tx = {
    payment: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        payments.push(data);
        return { ...data, id: 'payment-1', amount: decimal(data.amount as number) };
      },
    },
    policy: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        policies.push(data);
        return data;
      },
    },
    ncdCode: { updateMany: async (args: Record<string, unknown>) => redeemed.push(args) },
  };

  const prisma = {
    payment: {
      findUnique: async () => existingPayment,
      findFirst: async () => existingPayment,
    },
    quoteRequest: { findFirst: async () => request },
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
  };

  return { service: new PaymentsService(prisma as never), payments, policies, redeemed };
};

describe('paying for a quote', () => {
  it('confirms the payment and creates a policy awaiting the certificate', async () => {
    const { service, payments, policies } = buildService(requestRow());

    const receipt = await service.pay('customer-1', 'key-1', payDto());

    expect(receipt.status).toBe('Confirmed');
    expect(receipt.method).toBe('Mobile money');
    expect(receipt.amount).toBe(10900);
    expect(receipt.transactionId).toMatch(/^TXN-/);
    expect(receipt.policyNumber).toMatch(/^POL-/);

    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ status: 'CONFIRMED', method: 'MOBILE_MONEY', idempotencyKey: 'key-1' });

    // Payment alone never issues cover: the insurer's certificate does that.
    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatchObject({
      status: 'AWAITING_INSURER_CERTIFICATE',
      insurerId: 'insurer-1',
      quoteRequestId: 'QR-1',
      insurerQuoteReference: 'PA-Q-2026-00412',
      quoteDocumentId: 'doc-1',
    });
  });

  it('adds the RTSA anniversary fee to the premium it expects', async () => {
    const { service } = buildService(requestRow());

    const receipt = await service.pay(
      'customer-1',
      'key-1',
      payDto({ amount: 11400, rtsaAnniversaryFee: 500 }),
    );

    expect(receipt.amount).toBe(11400);
  });

  it('refuses an amount that is not the quoted premium', async () => {
    const { service, payments } = buildService(requestRow());

    await expect(service.pay('customer-1', 'key-1', payDto({ amount: 1 }))).rejects.toMatchObject({
      code: 'AMOUNT_MISMATCH',
    });
    expect(payments).toHaveLength(0);
  });

  it('refuses an expired quote and says so', async () => {
    const { service, payments } = buildService(
      requestRow({ quotes: [quoteRow({ validUntil: inDays(-1) })] }),
    );

    await expect(service.pay('customer-1', 'key-1', payDto())).rejects.toMatchObject({
      code: 'QUOTE_EXPIRED',
    });
    expect(payments).toHaveLength(0);
  });

  it('refuses a second payment for a request that already has a policy', async () => {
    const { service } = buildService(requestRow({ policies: [{ policyNumber: 'POL-1' }] }));

    await expect(service.pay('customer-1', 'key-1', payDto())).rejects.toMatchObject({
      code: 'ALREADY_PAID',
    });
  });

  it('replays the original receipt when the same idempotency key comes back', async () => {
    const { service, payments } = buildService(requestRow(), {
      transactionId: 'TXN-ORIGINAL',
      status: 'CONFIRMED',
      method: 'MOBILE_MONEY',
      amount: decimal(10900),
      currency: 'ZMW',
      confirmedAt: new Date(),
      quoteRequestId: 'QR-1',
      customerId: 'customer-1',
      policy: { policyNumber: 'POL-ORIGINAL' },
    });

    const receipt = await service.pay('customer-1', 'key-1', payDto());

    expect(receipt.transactionId).toBe('TXN-ORIGINAL');
    expect(receipt.policyNumber).toBe('POL-ORIGINAL');
    expect(payments).toHaveLength(0); // nothing new was charged
  });

  it('will not replay another customer’s payment', async () => {
    const { service } = buildService(requestRow(), {
      transactionId: 'TXN-OTHER',
      customerId: 'customer-2',
      status: 'CONFIRMED',
      method: 'CARD',
      amount: decimal(10900),
      currency: 'ZMW',
      confirmedAt: new Date(),
      quoteRequestId: 'QR-1',
      policy: null,
    });

    await expect(service.pay('customer-1', 'key-1', payDto())).rejects.toBeInstanceOf(ApiException);
  });

  it('redeems the NCD code the request was quoted with', async () => {
    const { service, redeemed } = buildService(requestRow({ ncdCode: 'NCD-ABCDE' }));

    await service.pay('customer-1', 'key-1', payDto());

    expect(redeemed).toHaveLength(1);
    expect(redeemed[0]).toMatchObject({ where: { code: 'NCD-ABCDE', redeemedAt: null } });
  });

  it('reports an unknown request rather than charging anything', async () => {
    const { service, payments } = buildService(null);

    await expect(service.pay('customer-1', 'key-1', payDto())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(payments).toHaveLength(0);
  });
});
