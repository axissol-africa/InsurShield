import { CustomerService } from './customer.service.js';
import type { NotifyClaimDto, SubmitQuoteRequestDto } from './dto/customer.dto.js';

/**
 * Submitting a quote request and notifying a claim, against a stand-in Prisma.
 *
 * The points worth protecting: one request reaches every active insurer at
 * once, the vehicle is not duplicated when the same plate comes back, and the
 * response speaks the contract's vocabulary rather than the database's.
 */

const vehicleRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'vehicle-1',
  plateNumber: 'BAA 1234',
  make: 'Toyota',
  model: 'Hilux',
  year: '2020',
  color: 'White',
  chassisNumber: null,
  engineNumber: null,
  registrationDate: null,
  rtsaAnniversaryDate: null,
  ...overrides,
});

const submitDto = (overrides: Partial<SubmitQuoteRequestDto> = {}): SubmitQuoteRequestDto => ({
  vehicleDetails: { plateNumber: 'BAA 1234', make: 'Toyota', model: 'Hilux', year: '2020' },
  vehicleValue: 250000,
  vehicleUsage: 'Individual',
  insuranceType: 'Comprehensive',
  coverageDurationId: '4q',
  ...overrides,
});

const claimDto = (overrides: Partial<NotifyClaimDto> = {}): NotifyClaimDto => ({
  insurerId: 'insurer-1',
  fullName: 'Mwiza Banda',
  phone: '0970123456',
  plate: 'BAA 1234',
  vehicle: '2020 Toyota Hilux',
  type: 'Theft',
  incidentDate: new Date().toISOString(),
  location: 'Woodlands, Lusaka',
  description: 'Vehicle stolen from outside the residence overnight.',
  ...overrides,
});

/** Only the calls these paths make. */
const buildService = (options: { insurers?: { id: string }[]; knownVehicles?: Record<string, unknown>[] } = {}) => {
  const insurers = options.insurers ?? [{ id: 'insurer-1' }, { id: 'insurer-2' }, { id: 'insurer-3' }];
  const requests: Record<string, unknown>[] = [];
  const claims: Record<string, unknown>[] = [];
  const createdVehicles: Record<string, unknown>[] = [];
  const updatedVehicles: Record<string, unknown>[] = [];
  const checkedDocuments: string[] = [];

  const prisma = {
    insurer: {
      findMany: async () => insurers,
      findFirst: async () => ({ id: 'insurer-1', name: 'Prestige Assurance' }),
    },
    vehicle: {
      findMany: async () => options.knownVehicles ?? [],
      create: async ({ data }: { data: Record<string, unknown> }) => {
        createdVehicles.push(data);
        return vehicleRow(data);
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        updatedVehicles.push({ id: where.id, ...data });
        return vehicleRow({ ...data, id: where.id });
      },
    },
    ncdCode: { findUnique: async () => null },
    policy: { findFirst: async () => null },
    quoteRequest: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        requests.push(data);
        return {
          ...data,
          customer: { fullName: 'Mwiza Banda', email: 'mwiza.banda@insurshield.zm', phone: '0970123456' },
          vehicle: vehicleRow(),
          recipients: insurers.map((insurer, index) => ({
            insurer: { id: insurer.id, name: `Insurer ${index + 1}` },
          })),
          quotes: [],
          requotedAs: null,
          vehicleValue: { toNumber: () => data.vehicleValue as number },
        };
      },
    },
    claimNotification: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        claims.push(data);
        return {
          ...data,
          estimatedLoss: null,
          insurer: { name: 'Prestige Assurance' },
          customer: { email: 'mwiza.banda@insurshield.zm' },
          attachments: [],
          submittedAt: new Date(),
          status: 'NOTIFIED',
        };
      },
    },
  };

  const documents = {
    record: async () => null,
    requireExists: async (id: string) => {
      checkedDocuments.push(id);
    },
  };

  return {
    service: new CustomerService(prisma as never, documents as never),
    requests,
    claims,
    createdVehicles,
    updatedVehicles,
    checkedDocuments,
  };
};

describe('submitting a quote request', () => {
  it('sends one request to every active insurer', async () => {
    const { service, requests } = buildService();

    const request = await service.submitQuoteRequest('customer-1', submitDto());

    expect(requests).toHaveLength(1);
    expect((requests[0].recipients as { create: unknown[] }).create).toHaveLength(3);
    expect(request.insurers).toHaveLength(3);
    expect(request.id).toMatch(/^QR-/);
  });

  it('answers in the contract’s vocabulary, not the database’s', async () => {
    const { service } = buildService();

    const request = await service.submitQuoteRequest(
      'customer-1',
      submitDto({ insuranceType: 'ThirdParty', coverageDurationId: '2q' }),
    );

    expect(request.status).toBe('Submitted');
    expect(request.insuranceType).toBe('ThirdParty');
    expect(request.coverageDurationId).toBe('2q');
  });

  it('derives the cover period from the duration when the client sends none', async () => {
    const { service, requests } = buildService();

    await service.submitQuoteRequest('customer-1', submitDto({ coverageDurationId: '1q' }));

    const { policyStartDate, policyEndDate, coverageDays } = requests[0] as {
      policyStartDate: Date;
      policyEndDate: Date;
      coverageDays: number;
    };
    expect(policyEndDate.getTime()).toBeGreaterThan(policyStartDate.getTime());
    // One quarter, so somewhere between 89 and 92 days depending on the month.
    expect(coverageDays).toBeGreaterThanOrEqual(89);
    expect(coverageDays).toBeLessThanOrEqual(92);
  });

  it('reuses the vehicle already on file for that plate, however it is spaced', async () => {
    const { service, createdVehicles, updatedVehicles } = buildService({
      knownVehicles: [vehicleRow({ id: 'vehicle-existing', plateNumber: 'baa1234' })],
    });

    await service.submitQuoteRequest('customer-1', submitDto());

    expect(createdVehicles).toHaveLength(0);
    expect(updatedVehicles[0]).toMatchObject({ id: 'vehicle-existing', plateNumber: 'BAA 1234' });
  });

  it('attaches the captured photos and checks each one exists first', async () => {
    const { service, requests, checkedDocuments } = buildService();

    await service.submitQuoteRequest(
      'customer-1',
      submitDto({
        inspectionShots: [
          { shotKey: 'insp_front', documentId: '11111111-1111-4111-8111-111111111111' },
          { shotKey: 'insp_rear', documentId: '22222222-2222-4222-8222-222222222222' },
        ],
      }),
    );

    expect(checkedDocuments).toHaveLength(2);
    expect((requests[0].inspectionShots as { create: unknown[] }).create).toHaveLength(2);
  });

  it('refuses when no insurer is accepting requests', async () => {
    const { service, requests } = buildService({ insurers: [] });

    await expect(service.submitQuoteRequest('customer-1', submitDto())).rejects.toMatchObject({
      code: 'NO_ACTIVE_INSURERS',
    });
    expect(requests).toHaveLength(0);
  });
});

describe('notifying a claim', () => {
  it('issues a claim number and leaves the claim with the insurer', async () => {
    const { service, claims } = buildService();

    const claim = await service.notifyClaim('customer-1', claimDto());

    expect(claim.claimNumber).toMatch(/^CLM-/);
    expect(claim.status).toBe('Notified');
    expect(claim.insurer).toBe('Prestige Assurance');
    expect(claim.receivedAt).toBeNull();
    expect(claims).toHaveLength(1);
  });

  it('records the late-notification reason when the incident is outside the window', async () => {
    const { service, claims } = buildService();

    await service.notifyClaim('customer-1', claimDto({ lateReason: 'I was in hospital.' }));

    expect(claims[0]).toMatchObject({ lateReason: 'I was in hospital.' });
  });

  it('checks every supporting document before recording the claim', async () => {
    const { service, checkedDocuments } = buildService();

    await service.notifyClaim(
      'customer-1',
      claimDto({ supportingDocumentIds: ['33333333-3333-4333-8333-333333333333'] }),
    );

    expect(checkedDocuments).toEqual(['33333333-3333-4333-8333-333333333333']);
  });
});
