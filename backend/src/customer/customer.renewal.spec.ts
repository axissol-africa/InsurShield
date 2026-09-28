import { CustomerService } from './customer.service.js';
import { ApiException } from '../common/errors/api.exception.js';

/**
 * Renewal decisions, exercised against a stand-in Prisma. The rules that
 * matter here are when a policy counts as due and what stops a second renewal
 * being started while one is already open.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const inDays = (days: number) => new Date(Date.now() + days * DAY_MS);

const vehicle = {
  plateNumber: 'BAZ 9901',
  make: 'Toyota',
  model: 'Hilux',
  year: '2020',
  color: 'White',
  chassisNumber: 'JTEH1234560012345',
  engineNumber: null,
  rtsaAnniversaryDate: null,
};

const policyRow = (overrides: Record<string, unknown> = {}) => ({
  policyNumber: 'POL-000001',
  insurerPolicyNumber: null,
  status: 'ACTIVE',
  insurer: { name: 'Global Guard Insurance' },
  coverage: 'Comprehensive',
  plan: 'Elite Security Policy',
  premium: { toNumber: () => 12800 },
  vehicle,
  vehicleId: 'vehicle-1',
  policyStartDate: inDays(-300),
  policyEndDate: inDays(65),
  quoteRequestId: 'QR-1',
  quoteRequest: null,
  insurerQuoteReference: null,
  quoteDocumentId: null,
  certificateDocumentId: null,
  payment: {
    transactionId: 'TXN-1',
    status: 'Confirmed',
    method: 'Mobile money',
    amount: { toNumber: () => 12800 },
    currency: 'ZMW',
    confirmedAt: new Date(),
  },
  receivedAt: new Date(),
  issuedAt: null,
  renewals: [],
  ...overrides,
});

/** Only the calls the renewal paths make. */
const buildService = (policy: ReturnType<typeof policyRow> | null, insurers = [{ id: 'insurer-1' }]) => {
  const created: Record<string, unknown>[] = [];
  const prisma = {
    policy: { findMany: async () => (policy ? [policy] : []), findFirst: async () => policy },
    insurer: { findMany: async () => insurers },
    quoteRequest: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return {
          ...data,
          vehicle,
          recipients: [],
          quotes: [],
          inspectionShots: [],
          requotedAs: null,
          vehicleValue: { toNumber: () => 320000 },
        };
      },
    },
  };
  const documents = { record: async () => null };
  const service = new CustomerService(prisma as never, documents as never);
  return { service, created };
};

describe('policy renewal', () => {
  it('marks a policy far from expiry as not yet due, but still renewable', async () => {
    const { service } = buildService(policyRow({ policyEndDate: inDays(200) }));
    const [policy] = await service.listPolicies('customer-1');

    expect(policy.renewal.window).toBe('NOT_DUE');
    expect(policy.renewal.daysRemaining).toBe(200);
    // Renewing early is allowed; the window only drives how the page presents it.
    expect(policy.renewal.renewable).toBe(true);
  });

  it('marks a policy inside the window as due', async () => {
    const { service } = buildService(policyRow({ policyEndDate: inDays(30) }));
    const [policy] = await service.listPolicies('customer-1');

    expect(policy.renewal.window).toBe('DUE');
    expect(policy.renewal.daysRemaining).toBe(30);
  });

  it('marks a lapsed policy as expired and still lets it be renewed', async () => {
    const { service } = buildService(policyRow({ policyEndDate: inDays(-9) }));
    const [policy] = await service.listPolicies('customer-1');

    expect(policy.renewal.window).toBe('EXPIRED');
    expect(policy.renewal.daysRemaining).toBe(-9);
    expect(policy.renewal.renewable).toBe(true);
  });

  it('treats the last day of cover as still in force, not expired', async () => {
    const { service } = buildService(policyRow({ policyEndDate: inDays(0) }));
    const [policy] = await service.listPolicies('customer-1');

    expect(policy.renewal.daysRemaining).toBe(0);
    expect(policy.renewal.window).toBe('DUE');
  });

  it('reports a renewal already in flight instead of offering another', async () => {
    const { service } = buildService(
      policyRow({ renewals: [{ id: 'QR-9', status: 'SUBMITTED', expiresAt: inDays(5) }] }),
    );
    const [policy] = await service.listPolicies('customer-1');

    expect(policy.renewal.renewable).toBe(false);
    expect(policy.renewal.renewalRequestId).toBe('QR-9');
  });

  it('offers renewal again once the previous renewal request has lapsed', async () => {
    const { service } = buildService(
      policyRow({ renewals: [{ id: 'QR-9', status: 'EXPIRED', expiresAt: inDays(-1) }] }),
    );
    const [policy] = await service.listPolicies('customer-1');

    expect(policy.renewal.renewable).toBe(true);
    expect(policy.renewal.renewalRequestId).toBeNull();
  });

  it('carries the vehicle and cover forward and starts cover when the old policy ends', async () => {
    const endDate = inDays(40);
    const { service, created } = buildService(
      policyRow({
        policyEndDate: endDate,
        quoteRequest: {
          vehicleValue: { toNumber: () => 320000 },
          vehicleUsage: 'Commercial',
          insuranceType: 'THIRD_PARTY',
          coverageDuration: 'Q2',
          matchRtsaAnniversary: true,
          rtsaRegistrationDate: null,
        },
      }),
    );

    await service.renewPolicy('customer-1', 'POL-000001');

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      vehicleId: 'vehicle-1',
      vehicleUsage: 'Commercial',
      insuranceType: 'THIRD_PARTY',
      coverageDuration: 'Q2',
      matchRtsaAnniversary: true,
      renewalOfPolicyNumber: 'POL-000001',
      policyStartDate: endDate,
    });
  });

  it('still renews a policy whose original request is gone, using safe defaults', async () => {
    const { service, created } = buildService(policyRow({ quoteRequest: null }));

    await service.renewPolicy('customer-1', 'POL-000001');

    expect(created[0]).toMatchObject({
      insuranceType: 'COMPREHENSIVE',
      coverageDuration: 'Q4',
      vehicleUsage: 'Individual',
    });
  });

  it('refuses a second renewal while one is open', async () => {
    const { service } = buildService(
      policyRow({ renewals: [{ id: 'QR-9', status: 'SUBMITTED', expiresAt: inDays(5) }] }),
    );

    await expect(service.renewPolicy('customer-1', 'POL-000001')).rejects.toThrow(ApiException);
  });

  it('refuses to renew a policy that is not this customer’s', async () => {
    const { service } = buildService(null);

    await expect(service.renewPolicy('customer-1', 'POL-000001')).rejects.toThrow(ApiException);
  });

  it('refuses when no insurer is accepting requests', async () => {
    const { service } = buildService(policyRow(), []);

    await expect(service.renewPolicy('customer-1', 'POL-000001')).rejects.toThrow(ApiException);
  });
});
