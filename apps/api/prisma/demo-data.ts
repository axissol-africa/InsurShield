/**
 * Demo records so the insurer portal has something to work on in development.
 *
 * Everything is keyed on fixed identifiers and upserted, so running the seed
 * repeatedly neither duplicates nor resets work done in the portal. Skipped
 * when SEED_DEMO_DATA=false, and never intended for production.
 */
import type { PrismaClient } from '../src/generated/prisma/client.js';
import {
  ClaimStatus,
  CoverageDuration,
  DeliveryStatus,
  DocumentKind,
  InsuranceType,
  NcdStatus,
  PaymentMethod,
  PaymentStatus,
  PolicyStatus,
  QuoteRequestStatus,
} from '../src/generated/prisma/enums.js';

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000);
const daysAhead = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

const CUSTOMER = {
  keycloakId: 'demo-customer-bwalya',
  fullName: 'Bwalya Mutale',
  email: 'bwalya.mutale@example.zm',
  phone: '+260 97 612 3456',
};

const VEHICLES = [
  { key: 'demo-hilux', plateNumber: 'BAZ 9901', make: 'Toyota', model: 'Hilux', year: '2024', chassisNumber: 'JTEH1234560012345' },
  { key: 'demo-x5', plateNumber: 'BAD 4412', make: 'BMW', model: 'X5', year: '2022', chassisNumber: 'WBAKJ4C50BC123456' },
];

/**
 * Removes the demo records so the next seed recreates them with nothing done
 * to them yet. Only ever touches rows with the DEMO identifiers.
 */
export async function resetDemoData(prisma: PrismaClient): Promise<void> {
  const requestIds = ['QR-DEMO-0001', 'QR-DEMO-0002', 'QR-DEMO-0003'];
  await prisma.policy.deleteMany({ where: { policyNumber: { startsWith: 'POL-DEMO-' } } });
  await prisma.payment.deleteMany({ where: { transactionId: { startsWith: 'TXN-DEMO-' } } });
  await prisma.insurerQuote.deleteMany({ where: { quoteRequestId: { in: requestIds } } });
  await prisma.claimNotification.deleteMany({ where: { claimNumber: { startsWith: 'CLM-DEMO-' } } });
  await prisma.ncdApplication.deleteMany({ where: { applicationNumber: { startsWith: 'NCDA-DEMO-' } } });
  // Requests created by re-requesting a demo one carry its id forward, so
  // they belong to the demo set too and must go with it.
  await prisma.quoteRequest.deleteMany({ where: { requotedFromId: { in: requestIds } } });
  await prisma.quoteRequest.deleteMany({ where: { id: { in: requestIds } } });
  await prisma.document.deleteMany({ where: { storageKey: { contains: '/QR-DEMO-' } } });
}

export async function seedDemoData(prisma: PrismaClient): Promise<void> {
  // Keyed on email, not keycloakId: once this demo customer is linked to a
  // real Keycloak user its `sub` changes, and an upsert on keycloakId would
  // then try to insert and collide on the unique email.
  const customer = await prisma.customer.upsert({
    where: { email: CUSTOMER.email },
    create: CUSTOMER,
    // keycloakId is deliberately not updated, so a real linkage survives.
    update: { fullName: CUSTOMER.fullName, deletedAt: null },
  });

  const vehicles = new Map<string, string>();
  for (const vehicle of VEHICLES) {
    const existing = await prisma.vehicle.findFirst({ where: { plateNumber: vehicle.plateNumber } });
    const record = existing
      ? existing
      : await prisma.vehicle.create({
          data: {
            plateNumber: vehicle.plateNumber,
            make: vehicle.make,
            model: vehicle.model,
            year: vehicle.year,
            chassisNumber: vehicle.chassisNumber,
          },
        });
    vehicles.set(vehicle.key, record.id);
  }

  const insurers = await prisma.insurer.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  if (insurers.length === 0) return;
  const prestige = insurers.find((i) => i.name === 'Prestige Assurance') ?? insurers[0];

  // ── Quote requests, fanned out to every active insurer ──────────
  const requests = [
    { id: 'QR-DEMO-0001', vehicleKey: 'demo-hilux', value: 520000, usage: 'Individual', hours: 2 },
    { id: 'QR-DEMO-0002', vehicleKey: 'demo-x5', value: 685000, usage: 'Commercial (Cars for Hire)', hours: 15 },
  ];

  for (const request of requests) {
    const submittedAt = hoursAgo(request.hours);
    await prisma.quoteRequest.upsert({
      where: { id: request.id },
      create: {
        id: request.id,
        status: QuoteRequestStatus.SUBMITTED,
        submittedAt,
        expiresAt: daysAhead(7),
        customerId: customer.id,
        vehicleId: vehicles.get(request.vehicleKey)!,
        vehicleValue: request.value,
        vehicleUsage: request.usage,
        insuranceType: InsuranceType.COMPREHENSIVE,
        coverageDuration: CoverageDuration.Q4,
        photosCapturedAt: submittedAt,
        // The same brief reaches every insurer at the same moment.
        recipients: {
          create: insurers.map((insurer) => ({
            insurerId: insurer.id,
            status: DeliveryStatus.DELIVERED,
            deliveredAt: submittedAt,
            attempts: 1,
          })),
        },
        inspectionShots: {
          create: ['insp_front', 'insp_back', 'insp_left', 'insp_right', 'insp_dashboard', 'insp_chassis', 'insp_stereo'].map(
            (shotKey) => ({
              shotKey,
              capturedAt: submittedAt,
              document: {
                create: {
                  kind: DocumentKind.INSPECTION_PHOTO,
                  fileName: `${shotKey}.jpg`,
                  mimeType: 'image/jpeg',
                  sizeBytes: 184_320,
                  storageKey: `inspection-shots/${request.id}/${shotKey}/demo.jpg`,
                },
              },
            }),
          ),
        },
      },
      update: {},
    });
  }

  // ── A paid policy waiting for its certificate ───────────────────
  const paidRequestId = 'QR-DEMO-0003';
  const paidAt = hoursAgo(18);
  const existingPolicy = await prisma.policy.findUnique({ where: { policyNumber: 'POL-DEMO-0003' } });

  if (!existingPolicy) {
    await prisma.quoteRequest.create({
      data: {
        id: paidRequestId,
        status: QuoteRequestStatus.QUOTED,
        submittedAt: hoursAgo(48),
        expiresAt: daysAhead(5),
        customerId: customer.id,
        vehicleId: vehicles.get('demo-hilux')!,
        vehicleValue: 300000,
        vehicleUsage: 'Individual',
        insuranceType: InsuranceType.COMPREHENSIVE,
        coverageDuration: CoverageDuration.Q1,
        policyStartDate: hoursAgo(18),
        policyEndDate: daysAhead(91),
        coverageDays: 91,
        recipients: {
          create: insurers.map((insurer) => ({
            insurerId: insurer.id,
            status: DeliveryStatus.DELIVERED,
            deliveredAt: hoursAgo(48),
          })),
        },
      },
    });

    const quotationDocument = await prisma.document.create({
      data: {
        kind: DocumentKind.QUOTATION,
        fileName: 'Prestige-quotation.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 98_304,
        storageKey: `quotations/${paidRequestId}/${prestige.id}/demo.pdf`,
      },
    });

    const quote = await prisma.insurerQuote.create({
      data: {
        quoteRequestId: paidRequestId,
        insurerId: prestige.id,
        premium: 12000,
        insurerReference: 'PA-Q-2026-00412',
        documentId: quotationDocument.id,
        validityDays: 7,
        sentAt: hoursAgo(24),
        validUntil: daysAhead(6),
      },
    });

    const payment = await prisma.payment.create({
      data: {
        transactionId: 'TXN-DEMO-0003',
        status: PaymentStatus.CONFIRMED,
        method: PaymentMethod.MOBILE_MONEY,
        amount: 12000,
        confirmedAt: paidAt,
        idempotencyKey: 'demo-payment-0003',
        customerId: customer.id,
        quoteRequestId: paidRequestId,
        insurerQuoteId: quote.id,
      },
    });

    await prisma.policy.create({
      data: {
        policyNumber: 'POL-DEMO-0003',
        status: PolicyStatus.AWAITING_INSURER_CERTIFICATE,
        insurerId: prestige.id,
        customerId: customer.id,
        vehicleId: vehicles.get('demo-hilux')!,
        coverage: 'Comprehensive Gold Plan',
        premium: 12000,
        policyStartDate: hoursAgo(18),
        policyEndDate: daysAhead(91),
        quoteRequestId: paidRequestId,
        insurerQuoteId: quote.id,
        insurerQuoteReference: 'PA-Q-2026-00412',
        quoteDocumentId: quotationDocument.id,
        paymentId: payment.id,
        receivedAt: paidAt,
      },
    });
  }

  // ── Claim notifications ─────────────────────────────────────────
  const claims = [
    { claimNumber: 'CLM-DEMO-0001', type: 'Accident / Collision', status: ClaimStatus.NOTIFIED, hours: 26 },
    { claimNumber: 'CLM-DEMO-0002', type: 'Theft', status: ClaimStatus.RECEIVED_BY_INSURER, hours: 96 },
  ];
  for (const claim of claims) {
    await prisma.claimNotification.upsert({
      where: { claimNumber: claim.claimNumber },
      create: {
        claimNumber: claim.claimNumber,
        status: claim.status,
        insurerId: prestige.id,
        customerId: customer.id,
        fullName: CUSTOMER.fullName,
        phone: CUSTOMER.phone,
        email: CUSTOMER.email,
        plate: 'BAZ 9901',
        vehicleLabel: '2024 Toyota Hilux',
        type: claim.type,
        incidentDate: hoursAgo(claim.hours + 12),
        location: 'Great East Road, Lusaka',
        description: 'Rear-ended at a junction; both vehicles drivable. No injuries reported.',
        estimatedLoss: 18500,
        policeReport: true,
        policeReportNumber: 'LSK/2026/44812',
        submittedAt: hoursAgo(claim.hours),
        receivedAt: claim.status === ClaimStatus.RECEIVED_BY_INSURER ? hoursAgo(claim.hours - 4) : null,
      },
      update: {},
    });
  }

  // ── NCD applications ────────────────────────────────────────────
  const applications = [
    { applicationNumber: 'NCDA-DEMO-0001', fullName: 'Mwiza Banda', years: 2, status: NcdStatus.SUBMITTED },
    { applicationNumber: 'NCDA-DEMO-0002', fullName: 'Thandiwe Zulu', years: 3, status: NcdStatus.UNDER_REVIEW },
  ];
  for (const application of applications) {
    await prisma.ncdApplication.upsert({
      where: { applicationNumber: application.applicationNumber },
      create: {
        applicationNumber: application.applicationNumber,
        insurerId: prestige.id,
        customerId: customer.id,
        policyNumber: 'PA-2023-0045',
        fullName: application.fullName,
        phone: CUSTOMER.phone,
        yearsClaimFree: application.years,
        status: application.status,
      },
      update: {},
    });
  }

  console.log(`Demo data ready for ${prestige.name}: 3 quote requests, 1 paid policy, 2 claims, 2 NCD applications`);
}
