import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import { ApiException } from '../common/errors/api.exception.js';
import {
  CoverageDuration,
  DeliveryStatus,
  InsuranceType,
  InsurerStatus,
  PolicyStatus,
  QuoteRequestStatus,
} from '../generated/prisma/enums.js';

/** How long a new request stays open for insurers to reply. */
const REQUEST_VALIDITY_DAYS = 7;

/**
 * How early a policy is treated as due for renewal. The customer is reminded
 * 30 days out; the window opens earlier so acting on the reminder is never the
 * first moment renewal becomes possible.
 */
const RENEWAL_WINDOW_DAYS = 60;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const addDays = (from: Date, days: number) => new Date(from.getTime() + days * MS_PER_DAY);

const startOfDay = (value: Date) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

/**
 * Calendar days from today until `date`: 0 on the day cover ends, negative
 * once it has passed. Mirrored in the client's `domain/renewal.js`.
 */
const daysUntil = (date: Date, now: Date) =>
  Math.round((startOfDay(date).getTime() - startOfDay(now).getTime()) / MS_PER_DAY);

/** A renewal request still open blocks starting another for the same policy. */
const isOpenRenewal = (request: { status: QuoteRequestStatus; expiresAt: Date }, now: Date) =>
  request.status !== QuoteRequestStatus.EXPIRED && request.expiresAt > now;

/**
 * Everything a signed-in customer can read about their own records.
 *
 * Every query is filtered by the customer resolved from the token. No endpoint
 * takes a customer id from the request, so one customer cannot read another's
 * quotes, policies or claims.
 */
@Injectable()
export class CustomerService {
  private readonly logger = new Logger(CustomerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
  ) {}

  // ── Quote requests ──────────────────────────────────────────────

  private readonly requestInclude = {
    vehicle: true,
    recipients: { include: { insurer: { select: { id: true, name: true } } } },
    quotes: { include: { insurer: { select: { id: true, name: true } }, document: true } },
    requotedAs: { select: { id: true } },
  } as const;

  async listQuoteRequests(customerId: string) {
    const requests = await this.prisma.quoteRequest.findMany({
      where: { customerId },
      orderBy: { submittedAt: 'desc' },
      include: this.requestInclude,
    });
    return Promise.all(requests.map((request) => this.serialiseRequest(request)));
  }

  async getQuoteRequest(customerId: string, id: string) {
    const request = await this.prisma.quoteRequest.findFirst({
      where: { id, customerId },
      include: this.requestInclude,
    });
    if (!request) throw ApiException.notFound('Quote request', id);
    return this.serialiseRequest(request);
  }

  /**
   * Shaped to the `QuoteRequest` type in frontend/src/api/contracts.js, which
   * keys each reply by insurer name.
   */
  private async serialiseRequest(
    request: Awaited<ReturnType<CustomerService['getRequestRow']>>,
  ) {
    const insurerQuotes: Record<string, unknown> = {};
    for (const quote of request.quotes) {
      insurerQuotes[quote.insurer.name] = {
        premium: quote.premium.toNumber(),
        notes: quote.notes,
        insurerReference: quote.insurerReference,
        validityDays: quote.validityDays,
        sentAt: quote.sentAt.toISOString(),
        validUntil: quote.validUntil.toISOString(),
        extendedAt: quote.extendedAt?.toISOString() ?? null,
        document: await this.documents.record(quote.documentId),
      };
    }

    return {
      id: request.id,
      status: request.status,
      submittedAt: request.submittedAt.toISOString(),
      expiresAt: request.expiresAt.toISOString(),
      vehicle: `${request.vehicle.year} ${request.vehicle.make} ${request.vehicle.model}`.trim(),
      vehicleDetails: {
        plateNumber: request.vehicle.plateNumber,
        make: request.vehicle.make,
        model: request.vehicle.model,
        year: request.vehicle.year,
        color: request.vehicle.color,
        chassisNumber: request.vehicle.chassisNumber,
        engineNumber: request.vehicle.engineNumber,
        registrationDate: request.vehicle.registrationDate?.toISOString() ?? null,
        rtsaAnniversaryDate: request.vehicle.rtsaAnniversaryDate?.toISOString() ?? null,
      },
      vehicleValue: request.vehicleValue.toNumber(),
      vehicleUsage: request.vehicleUsage,
      insuranceType: request.insuranceType,
      coverageDurationId: request.coverageDuration,
      matchRtsaAnniversary: request.matchRtsaAnniversary,
      policyDates:
        request.policyStartDate && request.policyEndDate
          ? {
              startDate: request.policyStartDate.toISOString(),
              endDate: request.policyEndDate.toISOString(),
              daysTotal: request.coverageDays,
            }
          : null,
      // Every insurer the request reached, named, as the comparison page expects.
      insurers: request.recipients.map((recipient) => recipient.insurer.name),
      insurerIds: request.recipients.map((recipient) => recipient.insurer.id),
      insurerQuotes,
      photosCapturedAt: request.photosCapturedAt?.toISOString() ?? null,
      requotedFromId: request.requotedFromId,
      requotedAs: request.requotedAs?.id ?? null,
    };
  }

  private getRequestRow(id: string, customerId: string) {
    return this.prisma.quoteRequest.findFirstOrThrow({
      where: { id, customerId },
      include: this.requestInclude,
    });
  }

  /**
   * Sends the same vehicle out again after the original quotes lapsed. The new
   * request links back to the old one, so the history of what was asked and
   * when stays intact rather than being overwritten.
   */
  async requote(customerId: string, id: string) {
    const original = await this.prisma.quoteRequest.findFirst({
      where: { id, customerId },
      include: { requotedAs: { select: { id: true } } },
    });
    if (!original) throw ApiException.notFound('Quote request', id);

    if (original.requotedAs) {
      throw ApiException.conflict(
        'ALREADY_REQUOTED',
        `This request was already sent again as ${original.requotedAs.id}.`,
      );
    }

    const insurers = await this.prisma.insurer.findMany({
      where: { status: InsurerStatus.ACTIVE },
      select: { id: true },
    });
    if (insurers.length === 0) {
      throw ApiException.conflict(
        'NO_ACTIVE_INSURERS',
        'No insurers are currently accepting requests. Please try again later.',
      );
    }

    const submittedAt = new Date();
    const created = await this.prisma.quoteRequest.create({
      data: {
        id: `QR-${Date.now()}`,
        status: QuoteRequestStatus.SUBMITTED,
        submittedAt,
        expiresAt: addDays(submittedAt, REQUEST_VALIDITY_DAYS),
        customerId,
        vehicleId: original.vehicleId,
        vehicleValue: original.vehicleValue,
        vehicleUsage: original.vehicleUsage,
        insuranceType: original.insuranceType,
        coverageDuration: original.coverageDuration,
        matchRtsaAnniversary: original.matchRtsaAnniversary,
        rtsaRegistrationDate: original.rtsaRegistrationDate,
        requotedFromId: original.id,
        recipients: {
          create: insurers.map((insurer) => ({
            insurerId: insurer.id,
            status: DeliveryStatus.PENDING,
          })),
        },
      },
      include: this.requestInclude,
    });

    this.logger.log(`Requote ${original.id} -> ${created.id} for ${insurers.length} insurers`);
    return this.serialiseRequest(created);
  }

  // ── Policies ────────────────────────────────────────────────────

  async listPolicies(customerId: string) {
    const policies = await this.prisma.policy.findMany({
      where: { customerId },
      orderBy: { receivedAt: 'desc' },
      include: {
        insurer: { select: { name: true } },
        vehicle: true,
        payment: true,
        renewals: { select: { id: true, status: true, expiresAt: true }, orderBy: { submittedAt: 'desc' } },
      },
    });
    return Promise.all(policies.map((policy) => this.serialisePolicy(policy)));
  }

  async getPolicy(customerId: string, policyNumber: string) {
    const policy = await this.prisma.policy.findFirst({
      where: { policyNumber, customerId },
      include: {
        insurer: { select: { name: true } },
        vehicle: true,
        payment: true,
        renewals: { select: { id: true, status: true, expiresAt: true }, orderBy: { submittedAt: 'desc' } },
      },
    });
    if (!policy) throw ApiException.notFound('Policy', policyNumber);
    return this.serialisePolicy(policy);
  }

  /**
   * Starts a renewal: a fresh quote request carrying this policy's vehicle and
   * cover forward, sent to every active insurer. Renewal is deliberately a new
   * request rather than an extension — the point is to compare the market
   * again, and the customer may well leave the incumbent.
   */
  async renewPolicy(customerId: string, policyNumber: string) {
    const policy = await this.prisma.policy.findFirst({
      where: { policyNumber, customerId },
      include: {
        vehicle: true,
        quoteRequest: true,
        renewals: { select: { id: true, status: true, expiresAt: true }, orderBy: { submittedAt: 'desc' } },
      },
    });
    if (!policy) throw ApiException.notFound('Policy', policyNumber);

    const now = new Date();
    const open = policy.renewals.find((renewal) => isOpenRenewal(renewal, now));
    if (open) {
      throw ApiException.conflict(
        'RENEWAL_IN_PROGRESS',
        `A renewal for this policy is already open as ${open.id}.`,
      );
    }

    const insurers = await this.prisma.insurer.findMany({
      where: { status: InsurerStatus.ACTIVE },
      select: { id: true },
    });
    if (insurers.length === 0) {
      throw ApiException.conflict(
        'NO_ACTIVE_INSURERS',
        'No insurers are currently accepting requests. Please try again later.',
      );
    }

    // The original request holds the declared value and usage. A policy whose
    // request has since been pruned still renews — the value falls back to the
    // premium basis on the policy, and the customer confirms it in the journey.
    const original = policy.quoteRequest;
    const created = await this.prisma.quoteRequest.create({
      data: {
        id: `QR-${Date.now()}`,
        status: QuoteRequestStatus.SUBMITTED,
        submittedAt: now,
        expiresAt: addDays(now, REQUEST_VALIDITY_DAYS),
        customerId,
        vehicleId: policy.vehicleId,
        vehicleValue: original?.vehicleValue ?? policy.premium,
        vehicleUsage: original?.vehicleUsage ?? 'Individual',
        insuranceType: original?.insuranceType ?? InsuranceType.COMPREHENSIVE,
        coverageDuration: original?.coverageDuration ?? CoverageDuration.Q4,
        matchRtsaAnniversary: original?.matchRtsaAnniversary ?? false,
        rtsaRegistrationDate: original?.rtsaRegistrationDate ?? null,
        // New cover picks up where the expiring policy leaves off.
        policyStartDate: policy.policyEndDate,
        renewalOfPolicyNumber: policy.policyNumber,
        recipients: {
          create: insurers.map((insurer) => ({
            insurerId: insurer.id,
            status: DeliveryStatus.PENDING,
          })),
        },
      },
      include: this.requestInclude,
    });

    this.logger.log(`Renewal ${policy.policyNumber} -> ${created.id} for ${insurers.length} insurers`);
    return this.serialiseRequest(created);
  }

  private async serialisePolicy(
    policy: Awaited<ReturnType<CustomerService['getPolicyRow']>>,
  ) {
    return {
      policyNumber: policy.policyNumber,
      insurerPolicyNumber: policy.insurerPolicyNumber,
      status: policy.status,
      insurer: policy.insurer.name,
      coverage: policy.coverage,
      plan: policy.plan,
      premium: policy.premium.toNumber(),
      vehicle: `${policy.vehicle.year} ${policy.vehicle.make} ${policy.vehicle.model}`.trim(),
      // The whole vehicle, not just the plate: a renewal carries these forward
      // into the new quote request without asking for them again.
      vehicleDetails: {
        plateNumber: policy.vehicle.plateNumber,
        make: policy.vehicle.make,
        model: policy.vehicle.model,
        year: policy.vehicle.year,
        color: policy.vehicle.color,
        chassisNumber: policy.vehicle.chassisNumber,
        engineNumber: policy.vehicle.engineNumber,
        rtsaAnniversaryDate: policy.vehicle.rtsaAnniversaryDate?.toISOString() ?? null,
      },
      renewal: this.renewalState(policy),
      policyDates:
        policy.policyStartDate && policy.policyEndDate
          ? { startDate: policy.policyStartDate.toISOString(), endDate: policy.policyEndDate.toISOString() }
          : null,
      quoteRequestId: policy.quoteRequestId,
      insurerQuoteReference: policy.insurerQuoteReference,
      quoteDocument: policy.quoteDocumentId ? await this.documents.record(policy.quoteDocumentId) : null,
      // Only present once the insurer has issued; that is what makes it Active.
      certificateDocument: policy.certificateDocumentId
        ? await this.documents.record(policy.certificateDocumentId)
        : null,
      paymentProof: {
        transactionId: policy.payment.transactionId,
        status: policy.payment.status,
        method: policy.payment.method,
        amount: policy.payment.amount.toNumber(),
        currency: policy.payment.currency,
        confirmedAt: policy.payment.confirmedAt?.toISOString() ?? null,
      },
      receivedAt: policy.receivedAt.toISOString(),
      issuedAt: policy.issuedAt?.toISOString() ?? null,
    };
  }

  /**
   * Where this policy stands on renewal. `window` is informational — the page
   * uses it to sort and to say how urgent this is — while `renewable` is the
   * only thing that decides whether the button works, so the two can never
   * disagree with the endpoint.
   */
  private renewalState(policy: Awaited<ReturnType<CustomerService['getPolicyRow']>>) {
    const now = new Date();
    const open = policy.renewals.find((renewal) => isOpenRenewal(renewal, now));
    const endDate = policy.policyEndDate;
    const daysRemaining = endDate ? daysUntil(endDate, now) : null;

    let window: 'NOT_DUE' | 'DUE' | 'EXPIRED' = 'NOT_DUE';
    if (daysRemaining !== null) {
      // Cover is still in force on its last day, so only a negative count has lapsed.
      if (daysRemaining < 0) window = 'EXPIRED';
      else if (daysRemaining <= RENEWAL_WINDOW_DAYS) window = 'DUE';
    }

    return {
      window,
      daysRemaining,
      endDate: endDate?.toISOString() ?? null,
      /** Blocked only by a renewal already in flight, never by the date. */
      renewable: !open,
      renewalRequestId: open?.id ?? null,
    };
  }

  private getPolicyRow(policyNumber: string, customerId: string) {
    return this.prisma.policy.findFirstOrThrow({
      where: { policyNumber, customerId },
      include: {
        insurer: { select: { name: true } },
        vehicle: true,
        payment: true,
        renewals: { select: { id: true, status: true, expiresAt: true }, orderBy: { submittedAt: 'desc' } },
      },
    });
  }

  // ── Claims and NCD ──────────────────────────────────────────────

  async listClaims(customerId: string) {
    const claims = await this.prisma.claimNotification.findMany({
      where: { customerId },
      orderBy: { submittedAt: 'desc' },
      include: { insurer: { select: { name: true } }, attachments: { select: { documentId: true } } },
    });

    return Promise.all(
      claims.map(async (claim) => ({
        claimNumber: claim.claimNumber,
        status: claim.status,
        insurer: claim.insurer.name,
        fullName: claim.fullName,
        phone: claim.phone,
        email: claim.email,
        plate: claim.plate,
        vehicle: claim.vehicleLabel,
        type: claim.type,
        incidentDate: claim.incidentDate.toISOString(),
        location: claim.location,
        description: claim.description,
        estimatedLoss: claim.estimatedLoss?.toNumber() ?? null,
        policeReport: claim.policeReport,
        policeReportNumber: claim.policeReportNumber,
        policyNumber: claim.policyNumber,
        insurerClaimReference: claim.insurerClaimReference,
        submittedAt: claim.submittedAt.toISOString(),
        receivedAt: claim.receivedAt?.toISOString() ?? null,
        supportingDocs: await Promise.all(
          claim.attachments.map((attachment) => this.documents.record(attachment.documentId)),
        ),
      })),
    );
  }

  async listNcdApplications(customerId: string) {
    const applications = await this.prisma.ncdApplication.findMany({
      where: { customerId },
      orderBy: { submittedAt: 'desc' },
      include: { insurer: { select: { name: true } }, approvedCode: true },
    });

    return applications.map((application) => ({
      id: application.id,
      applicationNumber: application.applicationNumber,
      insurer: application.insurer.name,
      policyNumber: application.policyNumber,
      fullName: application.fullName,
      phone: application.phone,
      yearsClaimFree: application.yearsClaimFree,
      status: application.status,
      approvedCode: application.approvedCode?.code ?? null,
      submittedAt: application.submittedAt.toISOString(),
    }));
  }

  // ── Closing the account ─────────────────────────────────────────

  /**
   * Closes the account.
   *
   * Refused while cover is in force: a customer with an active policy still
   * has a live insurance contract, and the records behind it must stay
   * reachable. Otherwise the row is soft-deleted — the guard then refuses the
   * token — so quotes, claims and payments remain for audit and regulatory
   * retention rather than being destroyed.
   */
  async closeAccount(customerId: string) {
    const activePolicies = await this.prisma.policy.count({
      where: { customerId, status: PolicyStatus.ACTIVE },
    });
    if (activePolicies > 0) {
      throw ApiException.conflict(
        'ACTIVE_POLICY_EXISTS',
        `This account holds ${activePolicies} active ${activePolicies === 1 ? 'policy' : 'policies'}. Cover must end before the account can be closed.`,
      );
    }

    await this.prisma.customer.update({
      where: { id: customerId },
      data: { deletedAt: new Date() },
    });

    this.logger.log(`Customer ${customerId} closed their account`);
    return { closed: true, closedAt: new Date().toISOString() };
  }
}
