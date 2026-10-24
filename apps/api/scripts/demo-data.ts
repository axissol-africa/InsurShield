/**
 * Demo records so the portals have something to work on in development.
 *
 * Everything is keyed on fixed identifiers and inserted only when missing, so
 * running the seed repeatedly neither duplicates nor resets work done in the
 * portals. Skipped when SEED_DEMO_DATA=false, and never intended for production.
 */
import { asc, eq, inArray, like } from 'drizzle-orm';
import { kwachaToNgwee } from '../src/common/money.js';
import type { Transaction } from '../src/db/database.module.js';
import {
  claimNotifications,
  customers,
  documents,
  insurerQuotes,
  insurers,
  inspectionShots,
  ncdApplications,
  ncdCodes,
  payments,
  policies,
  quoteRequestRecipients,
  quoteRequests,
  vehicles,
} from '../src/db/schema.js';
import { INSURERS } from './reference-data.js';
import { SeedDataError } from './seed-errors.js';

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

const REQUEST_IDS = ['QR-DEMO-0001', 'QR-DEMO-0002', 'QR-DEMO-0003'];
const SEEDED_NCD_CODES = INSURERS.flatMap((insurer) => insurer.ncdCodes.map((ncd) => ncd.code));
const SHOT_KEYS = ['insp_front', 'insp_back', 'insp_left', 'insp_right', 'insp_dashboard', 'insp_chassis', 'insp_stereo'];

/**
 * Removes the demo records so the next seed recreates them with nothing done
 * to them yet, and makes the seeded NCD codes redeemable again. Only ever
 * touches rows with the DEMO identifiers and the seeded codes.
 */
export async function resetDemoData(tx: Transaction): Promise<void> {
  await tx.delete(policies).where(like(policies.policyNumber, 'POL-DEMO-%'));
  await tx.delete(payments).where(like(payments.transactionId, 'TXN-DEMO-%'));
  await tx.delete(insurerQuotes).where(inArray(insurerQuotes.quoteRequestId, REQUEST_IDS));
  await tx.delete(claimNotifications).where(like(claimNotifications.claimNumber, 'CLM-DEMO-%'));
  await tx.delete(ncdApplications).where(like(ncdApplications.applicationNumber, 'NCDA-DEMO-%'));
  // Requests created by re-requesting a demo one carry its id forward, so
  // they belong to the demo set too and must go with it.
  await tx.delete(quoteRequests).where(inArray(quoteRequests.requotedFromId, REQUEST_IDS));
  await tx.delete(quoteRequests).where(inArray(quoteRequests.id, REQUEST_IDS));
  await tx.delete(documents).where(like(documents.storageKey, '%/QR-DEMO-%'));
  await tx.update(ncdCodes).set({ redeemedAt: null }).where(inArray(ncdCodes.code, SEEDED_NCD_CODES));
}

export function demoVehicleId(vehicleIds: ReadonlyMap<string, string>, key: string): string {
  const id = vehicleIds.get(key);
  if (!id) throw new SeedDataError(`The demo vehicle ${key} is missing`);
  return id;
}

export async function seedDemoData(tx: Transaction, log: (line: string) => void): Promise<void> {
  // Keyed on email, not keycloakId: once this demo customer is linked to a
  // real Keycloak user its `sub` changes, and an upsert on keycloakId would
  // then try to insert and collide on the unique email.
  const [customer] = await tx
    .insert(customers)
    .values(CUSTOMER)
    // keycloakId is deliberately not updated, so a real linkage survives.
    .onConflictDoUpdate({ target: customers.email, set: { fullName: CUSTOMER.fullName, deletedAt: null } })
    .returning({ id: customers.id });

  const vehicleIds = new Map<string, string>();
  for (const { key, ...vehicle } of VEHICLES) {
    const [existing] = await tx
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(eq(vehicles.plateNumber, vehicle.plateNumber))
      .orderBy(asc(vehicles.createdAt), asc(vehicles.id))
      .limit(1);
    const record = existing ?? (await tx.insert(vehicles).values(vehicle).returning({ id: vehicles.id }))[0];
    vehicleIds.set(key, record.id);
  }
  const vehicleId = (key: string) => demoVehicleId(vehicleIds, key);

  const active = await tx
    .select({ id: insurers.id, name: insurers.name })
    .from(insurers)
    .where(eq(insurers.status, 'ACTIVE'))
    .orderBy(asc(insurers.name));
  if (active.length === 0) return;
  const prestige = active.find((insurer) => insurer.name === 'Prestige Assurance') ?? active[0];

  // ── Quote requests, fanned out to every active insurer ──────────
  const requests = [
    { id: 'QR-DEMO-0001', vehicleKey: 'demo-hilux', value: 520000, usage: 'Individual', hours: 2 },
    { id: 'QR-DEMO-0002', vehicleKey: 'demo-x5', value: 685000, usage: 'Commercial (Cars for Hire)', hours: 15 },
  ];

  for (const request of requests) {
    const submittedAt = hoursAgo(request.hours);
    const created = await tx
      .insert(quoteRequests)
      .values({
        id: request.id,
        status: 'SUBMITTED',
        submittedAt,
        expiresAt: daysAhead(7),
        customerId: customer.id,
        vehicleId: vehicleId(request.vehicleKey),
        vehicleValueMinor: kwachaToNgwee(request.value),
        vehicleUsage: request.usage,
        insuranceType: 'COMPREHENSIVE',
        coverageDuration: 'Q4',
        photosCapturedAt: submittedAt,
      })
      .onConflictDoNothing({ target: quoteRequests.id })
      .returning({ id: quoteRequests.id });
    if (created.length === 0) continue;

    // The same brief reaches every insurer at the same moment.
    await tx.insert(quoteRequestRecipients).values(
      active.map((insurer) => ({
        quoteRequestId: request.id,
        insurerId: insurer.id,
        status: 'DELIVERED' as const,
        deliveredAt: submittedAt,
        attempts: 1,
      })),
    );
    for (const shotKey of SHOT_KEYS) {
      const [document] = await tx
        .insert(documents)
        .values({
          kind: 'INSPECTION_PHOTO',
          fileName: `${shotKey}.jpg`,
          mimeType: 'image/jpeg',
          sizeBytes: 184_320,
          storageKey: `inspection-shots/${request.id}/${shotKey}/demo.jpg`,
        })
        .returning({ id: documents.id });
      await tx.insert(inspectionShots).values({
        quoteRequestId: request.id,
        shotKey,
        capturedAt: submittedAt,
        documentId: document.id,
      });
    }
  }

  // ── A paid policy waiting for its certificate ───────────────────
  const paidRequestId = 'QR-DEMO-0003';
  const paidAt = hoursAgo(18);
  const [existingPolicy] = await tx
    .select({ policyNumber: policies.policyNumber })
    .from(policies)
    .where(eq(policies.policyNumber, 'POL-DEMO-0003'));

  if (!existingPolicy) {
    await tx.insert(quoteRequests).values({
      id: paidRequestId,
      status: 'QUOTED',
      submittedAt: hoursAgo(48),
      expiresAt: daysAhead(5),
      customerId: customer.id,
      vehicleId: vehicleId('demo-hilux'),
      vehicleValueMinor: kwachaToNgwee(300000),
      vehicleUsage: 'Individual',
      insuranceType: 'COMPREHENSIVE',
      coverageDuration: 'Q1',
      policyStartDate: paidAt,
      policyEndDate: daysAhead(91),
      coverageDays: 91,
    });
    await tx.insert(quoteRequestRecipients).values(
      active.map((insurer) => ({
        quoteRequestId: paidRequestId,
        insurerId: insurer.id,
        status: 'DELIVERED' as const,
        deliveredAt: hoursAgo(48),
      })),
    );

    const [quotationDocument] = await tx
      .insert(documents)
      .values({
        kind: 'QUOTATION',
        fileName: 'Prestige-quotation.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 98_304,
        storageKey: `quotations/${paidRequestId}/${prestige.id}/demo.pdf`,
      })
      .returning({ id: documents.id });

    const premiumMinor = kwachaToNgwee(12000);
    const [quote] = await tx
      .insert(insurerQuotes)
      .values({
        quoteRequestId: paidRequestId,
        insurerId: prestige.id,
        premiumMinor,
        insurerReference: 'PA-Q-2026-00412',
        documentId: quotationDocument.id,
        validityDays: 7,
        sentAt: hoursAgo(24),
        validUntil: daysAhead(6),
      })
      .returning({ id: insurerQuotes.id });

    const [payment] = await tx
      .insert(payments)
      .values({
        transactionId: 'TXN-DEMO-0003',
        status: 'CONFIRMED',
        method: 'MOBILE_MONEY',
        amountMinor: premiumMinor,
        confirmedAt: paidAt,
        idempotencyKey: 'demo-payment-0003',
        customerId: customer.id,
        quoteRequestId: paidRequestId,
        insurerQuoteId: quote.id,
      })
      .returning({ id: payments.id });

    await tx.insert(policies).values({
      policyNumber: 'POL-DEMO-0003',
      status: 'AWAITING_INSURER_CERTIFICATE',
      insurerId: prestige.id,
      customerId: customer.id,
      vehicleId: vehicleId('demo-hilux'),
      coverage: 'Comprehensive Gold Plan',
      premiumMinor,
      policyStartDate: paidAt,
      policyEndDate: daysAhead(91),
      quoteRequestId: paidRequestId,
      insurerQuoteId: quote.id,
      insurerQuoteReference: 'PA-Q-2026-00412',
      quoteDocumentId: quotationDocument.id,
      paymentId: payment.id,
      receivedAt: paidAt,
    });
  }

  // ── Claim notifications ─────────────────────────────────────────
  const claims = [
    { claimNumber: 'CLM-DEMO-0001', type: 'Accident / Collision', status: 'NOTIFIED' as const, hours: 26 },
    { claimNumber: 'CLM-DEMO-0002', type: 'Theft', status: 'RECEIVED_BY_INSURER' as const, hours: 96 },
  ];
  for (const claim of claims) {
    await tx
      .insert(claimNotifications)
      .values({
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
        estimatedLossMinor: kwachaToNgwee(18500),
        policeReport: true,
        policeReportNumber: 'LSK/2026/44812',
        submittedAt: hoursAgo(claim.hours),
        receivedAt: claim.status === 'RECEIVED_BY_INSURER' ? hoursAgo(claim.hours - 4) : null,
      })
      .onConflictDoNothing({ target: claimNotifications.claimNumber });
  }

  // ── NCD applications awaiting a decision ────────────────────────
  const pending = [
    { applicationNumber: 'NCDA-DEMO-0001', fullName: 'Mwiza Banda', years: 2, status: 'SUBMITTED' as const },
    { applicationNumber: 'NCDA-DEMO-0002', fullName: 'Thandiwe Zulu', years: 3, status: 'UNDER_REVIEW' as const },
  ];
  for (const application of pending) {
    await tx
      .insert(ncdApplications)
      .values({
        applicationNumber: application.applicationNumber,
        insurerId: prestige.id,
        customerId: customer.id,
        policyNumber: 'PA-2023-0045',
        fullName: application.fullName,
        phone: CUSTOMER.phone,
        yearsClaimFree: application.years,
        status: application.status,
      })
      .onConflictDoNothing();
  }

  // ── Approved applications behind the seeded NCD codes ───────────
  // A payment redeems a code only when it was issued on the payer's own application.
  const seededCodes = await tx
    .select({ code: ncdCodes.code, insurerId: ncdCodes.insurerId, yearsClaimFree: ncdCodes.yearsClaimFree })
    .from(ncdCodes)
    .where(inArray(ncdCodes.code, SEEDED_NCD_CODES));
  const codeOrder = (code: string) => SEEDED_NCD_CODES.indexOf(code);
  seededCodes.sort((a, b) => codeOrder(a.code) - codeOrder(b.code));
  for (const ncd of seededCodes) {
    const number = String(101 + codeOrder(ncd.code)).padStart(4, '0');
    await tx
      .insert(ncdApplications)
      .values({
        applicationNumber: `NCDA-DEMO-${number}`,
        insurerId: ncd.insurerId,
        customerId: customer.id,
        policyNumber: `CF-DEMO-${number}`,
        fullName: CUSTOMER.fullName,
        phone: CUSTOMER.phone,
        yearsClaimFree: ncd.yearsClaimFree,
        status: 'APPROVED',
        approvedCodeId: ncd.code,
        submittedAt: hoursAgo(120),
        decidedAt: hoursAgo(96),
      })
      .onConflictDoNothing();
  }

  log(
    `Demo data ready for ${prestige.name}: 3 quote requests, 1 paid policy, 2 claims, 2 NCD applications, ` +
      `${seededCodes.length} approved NCD codes for ${CUSTOMER.email}`,
  );
}

