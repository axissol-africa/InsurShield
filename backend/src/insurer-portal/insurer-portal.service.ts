import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import { ApiException } from '../common/errors/api.exception.js';
import {
  ClaimStatus,
  DeliveryStatus,
  NcdStatus,
  PolicyStatus,
  QuoteRequestStatus,
} from '../generated/prisma/enums.js';
import type {
  AcknowledgeClaimDto,
  ExtendQuoteDto,
  IssueCertificateDto,
  NcdDecisionDto,
  SubmitQuoteDto,
} from './dto/portal.dto.js';

/** Ten percent per claim-free year, matching the customer-facing NCD tiers. */
const NCD_PERCENTAGE_PER_YEAR = 10;
const MAX_NCD_PERCENTAGE = 50;

const addDays = (from: Date, days: number) =>
  new Date(from.getTime() + days * 24 * 60 * 60 * 1000);

/**
 * Everything the insurer portal does.
 *
 * Every method takes the insurer resolved from the caller's token and filters
 * on it. No endpoint accepts an insurer id from the client, so one insurer can
 * never read or act on another's work — the scoping is not something a request
 * can influence.
 */
@Injectable()
export class InsurerPortalService {
  private readonly logger = new Logger(InsurerPortalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
  ) {}

  // ── Quote requests ──────────────────────────────────────────────

  /** Requests delivered to this insurer, newest first, with its own reply. */
  async listQuoteRequests(insurerId: string) {
    const recipients = await this.prisma.quoteRequestRecipient.findMany({
      where: { insurerId },
      orderBy: { quoteRequest: { submittedAt: 'desc' } },
      select: {
        status: true,
        deliveredAt: true,
        quoteRequest: {
          include: {
            customer: { select: { fullName: true, email: true, phone: true } },
            vehicle: true,
            inspectionShots: { select: { shotKey: true } },
            // Only this insurer's reply; the others are none of its business.
            quotes: {
              where: { insurerId },
              include: { document: true },
            },
          },
        },
      },
    });

    return Promise.all(recipients.map((row) => this.toPortalRequest(row.quoteRequest, row.status)));
  }

  private async toPortalRequest(
    request: NonNullable<Awaited<ReturnType<InsurerPortalService['loadRequest']>>>,
    deliveryStatus: DeliveryStatus,
  ) {
    const reply = request.quotes[0] ?? null;

    return {
      id: request.id,
      status: request.status,
      deliveryStatus,
      submittedAt: request.submittedAt.toISOString(),
      expiresAt: request.expiresAt.toISOString(),
      vehicle: `${request.vehicle.year} ${request.vehicle.make} ${request.vehicle.model}`.trim(),
      vehicleDetails: {
        plateNumber: request.vehicle.plateNumber,
        make: request.vehicle.make,
        model: request.vehicle.model,
        year: request.vehicle.year,
        chassisNumber: request.vehicle.chassisNumber,
      },
      vehicleValue: request.vehicleValue.toNumber(),
      vehicleUsage: request.vehicleUsage,
      insuranceType: request.insuranceType,
      coverageDurationId: request.coverageDuration,
      policyDates:
        request.policyStartDate && request.policyEndDate
          ? {
              startDate: request.policyStartDate.toISOString(),
              endDate: request.policyEndDate.toISOString(),
              daysTotal: request.coverageDays,
            }
          : null,
      customer: request.customer,
      inspectionShots: request.inspectionShots.map((shot) => shot.shotKey),
      photosCapturedAt: request.photosCapturedAt?.toISOString() ?? null,
      reply: reply
        ? {
            premium: reply.premium.toNumber(),
            notes: reply.notes,
            insurerReference: reply.insurerReference,
            validityDays: reply.validityDays,
            sentAt: reply.sentAt.toISOString(),
            validUntil: reply.validUntil.toISOString(),
            extendedAt: reply.extendedAt?.toISOString() ?? null,
            document: await this.documents.record(reply.documentId),
          }
        : null,
    };
  }

  private loadRequest(id: string, insurerId: string) {
    return this.prisma.quoteRequest.findFirst({
      where: { id, recipients: { some: { insurerId } } },
      include: {
        customer: { select: { fullName: true, email: true, phone: true } },
        vehicle: true,
        inspectionShots: { select: { shotKey: true } },
        quotes: { where: { insurerId }, include: { document: true } },
      },
    });
  }

  /** The insurer's single final reply to a request. */
  async submitQuote(insurerId: string, requestId: string, dto: SubmitQuoteDto) {
    const request = await this.loadRequest(requestId, insurerId);
    if (!request) throw ApiException.notFound('Quote request', requestId);

    if (request.quotes.length > 0) {
      throw ApiException.conflict(
        'ALREADY_QUOTED',
        'You have already sent a final quote for this request. Extend it instead of replacing it.',
      );
    }
    if (request.expiresAt < new Date()) {
      throw ApiException.conflict(
        'REQUEST_EXPIRED',
        'This request has expired and can no longer be quoted.',
      );
    }

    await this.documents.requireExists(dto.documentId);

    const insurer = await this.prisma.insurer.findUniqueOrThrow({
      where: { id: insurerId },
      select: { quoteValidityDays: true },
    });
    const validityDays = dto.validityDays ?? insurer.quoteValidityDays;
    const sentAt = new Date();

    const [quote] = await this.prisma.$transaction([
      this.prisma.insurerQuote.create({
        data: {
          quoteRequestId: requestId,
          insurerId,
          premium: dto.premium,
          notes: dto.notes ?? null,
          insurerReference: dto.insurerReference ?? null,
          documentId: dto.documentId,
          validityDays,
          sentAt,
          validUntil: addDays(sentAt, validityDays),
        },
        include: { document: true },
      }),
      // The request is "Quoted" as soon as one insurer replies; others may
      // still reply afterwards.
      this.prisma.quoteRequest.update({
        where: { id: requestId },
        data: { status: QuoteRequestStatus.QUOTED },
      }),
      this.prisma.quoteRequestRecipient.updateMany({
        where: { quoteRequestId: requestId, insurerId },
        data: { status: DeliveryStatus.ACKNOWLEDGED, acknowledgedAt: sentAt },
      }),
    ]);

    this.logger.log(`Quote sent for ${requestId} by insurer ${insurerId}`);

    return {
      premium: quote.premium.toNumber(),
      notes: quote.notes,
      insurerReference: quote.insurerReference,
      validityDays: quote.validityDays,
      sentAt: quote.sentAt.toISOString(),
      validUntil: quote.validUntil.toISOString(),
      extendedAt: null,
      document: await this.documents.record(quote.documentId),
    };
  }

  /** Keeps an open quote available for longer. An expired quote cannot be revived. */
  async extendQuote(insurerId: string, requestId: string, dto: ExtendQuoteDto) {
    const quote = await this.prisma.insurerQuote.findUnique({
      where: { quoteRequestId_insurerId: { quoteRequestId: requestId, insurerId } },
    });
    if (!quote) throw ApiException.notFound('Quote for request', requestId);

    if (quote.validUntil < new Date()) {
      throw ApiException.conflict(
        'QUOTE_EXPIRED',
        'This quote has already expired. The customer needs to request new quotes.',
      );
    }

    const updated = await this.prisma.insurerQuote.update({
      where: { id: quote.id },
      data: {
        validUntil: addDays(quote.validUntil, dto.extraDays),
        validityDays: quote.validityDays + dto.extraDays,
        extendedAt: new Date(),
      },
    });

    return {
      premium: updated.premium.toNumber(),
      validityDays: updated.validityDays,
      validUntil: updated.validUntil.toISOString(),
      extendedAt: updated.extendedAt!.toISOString(),
    };
  }

  // ── Paid policies ───────────────────────────────────────────────

  async listPolicies(insurerId: string) {
    const policies = await this.prisma.policy.findMany({
      where: { insurerId },
      orderBy: { receivedAt: 'desc' },
      include: {
        customer: { select: { fullName: true, email: true, phone: true } },
        vehicle: true,
        payment: true,
      },
    });

    return Promise.all(
      policies.map(async (policy) => ({
        policyNumber: policy.policyNumber,
        insurerPolicyNumber: policy.insurerPolicyNumber,
        status: policy.status,
        coverage: policy.coverage,
        plan: policy.plan,
        premium: policy.premium.toNumber(),
        customerName: policy.customer.fullName,
        customerEmail: policy.customer.email,
        customerPhone: policy.customer.phone,
        vehicle: `${policy.vehicle.year} ${policy.vehicle.make} ${policy.vehicle.model}`.trim(),
        vehicleDetails: { plateNumber: policy.vehicle.plateNumber },
        policyDates:
          policy.policyStartDate && policy.policyEndDate
            ? {
                startDate: policy.policyStartDate.toISOString(),
                endDate: policy.policyEndDate.toISOString(),
              }
            : null,
        quoteRequestId: policy.quoteRequestId,
        insurerQuoteReference: policy.insurerQuoteReference,
        quoteDocument: policy.quoteDocumentId
          ? await this.documents.record(policy.quoteDocumentId)
          : null,
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
      })),
    );
  }

  /**
   * Uploading the official certificate is what activates the policy. Payment
   * alone never does — see INSURER_API_INTEGRATION.md.
   */
  async issueCertificate(insurerId: string, policyNumber: string, dto: IssueCertificateDto) {
    const policy = await this.prisma.policy.findFirst({ where: { policyNumber, insurerId } });
    if (!policy) throw ApiException.notFound('Policy', policyNumber);

    if (policy.status === PolicyStatus.ACTIVE) {
      throw ApiException.conflict(
        'ALREADY_ISSUED',
        'This policy has already been issued and is active.',
      );
    }

    await this.documents.requireExists(dto.certificateDocumentId);

    const updated = await this.prisma.policy.update({
      where: { policyNumber },
      data: {
        certificateDocumentId: dto.certificateDocumentId,
        insurerPolicyNumber: dto.insurerPolicyNumber ?? null,
        status: PolicyStatus.ACTIVE,
        issuedAt: new Date(),
      },
    });

    this.logger.log(`Policy ${policyNumber} activated by insurer ${insurerId}`);

    return {
      policyNumber: updated.policyNumber,
      insurerPolicyNumber: updated.insurerPolicyNumber,
      status: updated.status,
      issuedAt: updated.issuedAt!.toISOString(),
      certificateDocument: await this.documents.record(dto.certificateDocumentId),
    };
  }

  // ── Claims ──────────────────────────────────────────────────────

  async listClaims(insurerId: string) {
    const claims = await this.prisma.claimNotification.findMany({
      where: { insurerId },
      orderBy: { submittedAt: 'desc' },
      include: { attachments: { select: { documentId: true } } },
    });

    return Promise.all(
      claims.map(async (claim) => ({
        claimNumber: claim.claimNumber,
        status: claim.status,
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
        lateReason: claim.lateReason,
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

  /** The insurer confirms it has the notification; the claim then continues in its own system. */
  async acknowledgeClaim(insurerId: string, claimNumber: string, dto: AcknowledgeClaimDto) {
    const claim = await this.prisma.claimNotification.findFirst({
      where: { claimNumber, insurerId },
    });
    if (!claim) throw ApiException.notFound('Claim', claimNumber);

    if (claim.status === ClaimStatus.RECEIVED_BY_INSURER) {
      // Acknowledging twice is harmless, so this returns the existing state
      // rather than failing a retry.
      return this.claimAck(claim.claimNumber, claim.status, claim.receivedAt, claim.insurerClaimReference);
    }

    const updated = await this.prisma.claimNotification.update({
      where: { claimNumber },
      data: {
        status: ClaimStatus.RECEIVED_BY_INSURER,
        receivedAt: new Date(),
        insurerClaimReference: dto.insurerClaimReference ?? claim.insurerClaimReference,
      },
    });

    return this.claimAck(
      updated.claimNumber,
      updated.status,
      updated.receivedAt,
      updated.insurerClaimReference,
    );
  }

  private claimAck(
    claimNumber: string,
    status: ClaimStatus,
    receivedAt: Date | null,
    insurerClaimReference: string | null,
  ) {
    return {
      claimNumber,
      status,
      receivedAt: receivedAt?.toISOString() ?? null,
      insurerClaimReference,
    };
  }

  // ── No-claim discount ───────────────────────────────────────────

  async listNcdApplications(insurerId: string) {
    const applications = await this.prisma.ncdApplication.findMany({
      where: { insurerId },
      orderBy: { submittedAt: 'desc' },
      include: { approvedCode: true },
    });

    return applications.map((application) => ({
      id: application.id,
      applicationNumber: application.applicationNumber,
      policyNumber: application.policyNumber,
      fullName: application.fullName,
      phone: application.phone,
      yearsClaimFree: application.yearsClaimFree,
      status: application.status,
      approvedCode: application.approvedCode?.code ?? null,
      submittedAt: application.submittedAt.toISOString(),
      decidedAt: application.decidedAt?.toISOString() ?? null,
    }));
  }

  /**
   * Approving issues a discount code that only this insurer honours. The code
   * is created in the same transaction as the decision, so an approved
   * application can never exist without one.
   */
  async decideNcdApplication(insurerId: string, applicationId: string, dto: NcdDecisionDto) {
    const application = await this.prisma.ncdApplication.findFirst({
      where: { id: applicationId, insurerId },
      include: { approvedCode: true },
    });
    if (!application) throw ApiException.notFound('NCD application', applicationId);

    if (application.status === NcdStatus.APPROVED) {
      throw ApiException.conflict(
        'ALREADY_DECIDED',
        'This application has already been approved and its code issued.',
      );
    }

    if (dto.status !== NcdStatus.APPROVED) {
      const updated = await this.prisma.ncdApplication.update({
        where: { id: applicationId },
        data: {
          status: dto.status,
          decidedAt: dto.status === NcdStatus.UNDER_REVIEW ? null : new Date(),
        },
      });
      return {
        id: updated.id,
        status: updated.status,
        approvedCode: null,
        decidedAt: updated.decidedAt?.toISOString() ?? null,
      };
    }

    const percentage =
      dto.percentage ??
      Math.min(application.yearsClaimFree * NCD_PERCENTAGE_PER_YEAR, MAX_NCD_PERCENTAGE);
    const code = `NCD-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

    const [, updated] = await this.prisma.$transaction([
      this.prisma.ncdCode.create({
        data: {
          code,
          insurerId,
          percentage,
          yearsClaimFree: application.yearsClaimFree,
        },
      }),
      this.prisma.ncdApplication.update({
        where: { id: applicationId },
        data: { status: NcdStatus.APPROVED, decidedAt: new Date(), approvedCodeId: code },
      }),
    ]);

    this.logger.log(`NCD ${application.applicationNumber} approved at ${percentage}%`);

    return {
      id: updated.id,
      status: updated.status,
      approvedCode: code,
      percentage,
      decidedAt: updated.decidedAt!.toISOString(),
    };
  }
}
