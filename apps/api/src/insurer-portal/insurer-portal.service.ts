import { Inject, Injectable, Logger } from '@nestjs/common';
import { DocumentsService } from '../documents/documents.service.js';
import { ApiException } from '../common/errors/api.exception.js';
import { kwachaToNgwee } from '../common/money.js';
import { isRequestOpen } from '../common/domain/quote-request.js';
import type { Principal } from '../common/auth/auth.types.js';
import type { Transaction } from '../db/database.module.js';
import {
  addDays,
  canDecideNcd,
  ncdDecidedAt,
  ncdPercentage,
  newNcdCode,
} from './domain/portal.js';
import { InsurerPortalRepository, type NewNcdCode } from './insurer-portal.repository.js';
import {
  toAcknowledgement,
  toExtension,
  toIssuedPolicy,
  toNcdApplication,
  toNcdApproval,
  toNcdDecision,
  toPortalClaim,
  toPortalPolicy,
  toPortalRequest,
  toReply,
} from './dto/portal.response.js';
import type {
  AcknowledgeClaimDto,
  ExtendQuoteDto,
  IssueCertificateDto,
  NcdDecisionDto,
  SubmitQuoteDto,
} from './dto/portal.dto.js';

/** Chooses one of `n` characters for a new NCD code; `crypto.randomInt` outside tests. */
export const NCD_CODE_PICK = Symbol('NCD_CODE_PICK');

const NCD_CODE_ATTEMPTS = 5;

/**
 * Everything the insurer portal does.
 *
 * Every method resolves the insurer from the caller's own staff record and
 * filters on it. No endpoint accepts an insurer id from the client, so one
 * insurer can never read or act on another's work.
 */
@Injectable()
export class InsurerPortalService {
  private readonly logger = new Logger(InsurerPortalService.name);

  constructor(
    private readonly portal: InsurerPortalRepository,
    private readonly documents: DocumentsService,
    @Inject(NCD_CODE_PICK) private readonly pick: (n: number) => number,
  ) {}

  /** The insurer this caller acts for, or a refusal if the account has none. */
  insurerOf(principal: Principal): string {
    if (principal.kind !== 'staff' || principal.role !== 'INSURER_USER' || !principal.insurerId) {
      throw ApiException.forbidden('This account is not linked to an insurer.');
    }
    return principal.insurerId;
  }

  // ── Quote requests ──────────────────────────────────────────────

  /** Requests delivered to this insurer, newest first, with its own reply. */
  async listQuoteRequests(principal: Principal) {
    const insurerId = this.insurerOf(principal);
    const requests = await this.portal.listRequests(insurerId);
    const shots = await this.portal.shotKeys(insurerId, requests.map((request) => request.id));

    return Promise.all(
      requests.map(async (request) =>
        toPortalRequest(
          request,
          shots.filter((shot) => shot.quoteRequestId === request.id).map((shot) => shot.shotKey),
          request.reply ? await this.documents.record(request.reply.documentId) : null,
        ),
      ),
    );
  }

  /** The insurer's single final reply to a request. */
  async submitQuote(principal: Principal, requestId: string, dto: SubmitQuoteDto) {
    const insurerId = this.insurerOf(principal);
    const premiumMinor = kwachaToNgwee(dto.premium);
    const requestExpired = () =>
      ApiException.conflict('REQUEST_EXPIRED', 'This request has expired and can no longer be quoted.');

    const reply = await this.portal.transaction(async (tx) => {
      const delivery = await this.portal.lockDelivery(tx, requestId, insurerId);
      if (!delivery) throw ApiException.notFound('Quote request', requestId);

      if (await this.portal.hasQuote(requestId, insurerId, tx)) {
        throw ApiException.conflict(
          'ALREADY_QUOTED',
          'You have already sent a final quote for this request. Extend it instead of replacing it.',
        );
      }
      const sentAt = new Date();
      if (!isRequestOpen(delivery.status, delivery.expiresAt, sentAt)) throw requestExpired();

      await this.documents.assertAttachable(tx, principal, [dto.documentId], 'QUOTATION');

      const validityDays = dto.validityDays ?? delivery.quoteValidityDays;
      const quote = await this.portal.insertQuote(tx, {
        quoteRequestId: requestId,
        insurerId,
        premiumMinor,
        notes: dto.notes ?? null,
        insurerReference: dto.insurerReference ?? null,
        documentId: dto.documentId,
        validityDays,
        sentAt,
        validUntil: addDays(sentAt, validityDays),
      });
      // The request is "Quoted" as soon as one insurer replies; others may still reply afterwards.
      if (!(await this.portal.markQuoted(tx, requestId, insurerId, sentAt))) throw requestExpired();
      return toReply(quote, await this.documents.record(quote.documentId, tx));
    });

    this.logger.log(`Quote sent for ${requestId} by insurer ${insurerId}`);
    return reply;
  }

  /** Keeps an open quote available for longer. An expired quote cannot be revived. */
  async extendQuote(principal: Principal, requestId: string, dto: ExtendQuoteDto) {
    const insurerId = this.insurerOf(principal);

    const extended = await this.portal.extendOpenQuote(requestId, insurerId, dto.extraDays, new Date());
    if (extended) return toExtension(extended);

    if (!(await this.portal.hasQuote(requestId, insurerId))) {
      throw ApiException.notFound('Quote for request', requestId);
    }
    throw ApiException.conflict(
      'QUOTE_EXPIRED',
      'This quote has already expired. The customer needs to request new quotes.',
    );
  }

  // ── Paid policies ───────────────────────────────────────────────

  async listPolicies(principal: Principal) {
    const policies = await this.portal.listPolicies(this.insurerOf(principal));

    return Promise.all(
      policies.map(async (policy) =>
        toPortalPolicy(
          policy,
          policy.quoteDocumentId ? await this.documents.record(policy.quoteDocumentId) : null,
          policy.certificateDocumentId ? await this.documents.record(policy.certificateDocumentId) : null,
        ),
      ),
    );
  }

  /**
   * Uploading the official certificate is what activates the policy. Payment
   * alone never does — see INSURER_API_INTEGRATION.md.
   */
  async issueCertificate(principal: Principal, policyNumber: string, dto: IssueCertificateDto) {
    const insurerId = this.insurerOf(principal);
    const alreadyIssued = () =>
      ApiException.conflict('ALREADY_ISSUED', 'This policy has already been issued and is active.');

    const issued = await this.portal.transaction(async (tx) => {
      const policy = await this.portal.lockPolicy(tx, policyNumber, insurerId);
      if (!policy) throw ApiException.notFound('Policy', policyNumber);
      if (policy.status === 'ACTIVE') throw alreadyIssued();

      await this.documents.assertAttachable(tx, principal, [dto.certificateDocumentId], 'CERTIFICATE');

      const activated = await this.portal.activatePolicy(tx, policyNumber, insurerId, {
        certificateDocumentId: dto.certificateDocumentId,
        insurerPolicyNumber: dto.insurerPolicyNumber ?? null,
        issuedAt: new Date(),
      });
      if (!activated) throw alreadyIssued();
      return toIssuedPolicy(activated, await this.documents.record(dto.certificateDocumentId, tx));
    });

    this.logger.log(`Policy ${policyNumber} activated by insurer ${insurerId}`);
    return issued;
  }

  // ── Claims ──────────────────────────────────────────────────────

  async listClaims(principal: Principal) {
    const insurerId = this.insurerOf(principal);
    const claims = await this.portal.listClaims(insurerId);
    const attachments = await this.portal.attachmentIds(insurerId, claims.map((claim) => claim.claimNumber));

    return Promise.all(
      claims.map(async (claim) =>
        toPortalClaim(
          claim,
          await Promise.all(
            attachments
              .filter((attachment) => attachment.claimNumber === claim.claimNumber)
              .map((attachment) => this.documents.record(attachment.documentId)),
          ),
        ),
      ),
    );
  }

  /**
   * The insurer confirms it has the notification; the claim then continues in
   * its own system. Acknowledging twice is harmless, so a repeat answers the
   * state the first one recorded rather than failing a retry.
   */
  async acknowledgeClaim(principal: Principal, claimNumber: string, dto: AcknowledgeClaimDto) {
    const insurerId = this.insurerOf(principal);

    const acknowledged = await this.portal.acknowledgeClaim(claimNumber, insurerId, {
      receivedAt: new Date(),
      insurerClaimReference: dto.insurerClaimReference ?? undefined,
    });
    if (acknowledged) return toAcknowledgement(acknowledged);

    const claim = await this.portal.findAcknowledgement(claimNumber, insurerId);
    if (!claim) throw ApiException.notFound('Claim', claimNumber);
    return toAcknowledgement(claim);
  }

  // ── No-claim discount ───────────────────────────────────────────

  async listNcdApplications(principal: Principal) {
    const applications = await this.portal.listNcdApplications(this.insurerOf(principal));
    return applications.map(toNcdApplication);
  }

  /**
   * Approving issues a discount code that only this insurer honours. The code
   * is created in the same transaction as the decision, so an approved
   * application can never exist without one.
   */
  async decideNcdApplication(principal: Principal, applicationId: string, dto: NcdDecisionDto) {
    const insurerId = this.insurerOf(principal);
    const alreadyDecided = () =>
      ApiException.conflict('ALREADY_DECIDED', 'This application has already been approved and its code issued.');

    const { decision, applicationNumber } = await this.portal.transaction(async (tx) => {
      const application = await this.portal.lockNcdApplication(tx, applicationId, insurerId);
      if (!application) throw ApiException.notFound('NCD application', applicationId);
      if (!canDecideNcd(application.status)) throw alreadyDecided();

      const decidedAt = ncdDecidedAt(dto.status, new Date());
      const { applicationNumber } = application;
      if (dto.status !== 'APPROVED') {
        const decided = await this.portal.decideNcdApplication(tx, applicationId, insurerId, application.status, {
          status: dto.status,
          decidedAt,
        });
        if (!decided) throw alreadyDecided();
        return { decision: toNcdDecision(decided), applicationNumber };
      }

      const percentage = ncdPercentage(application.yearsClaimFree, dto.percentage);
      const code = await this.insertUnusedNcdCode(tx, {
        insurerId,
        percentage,
        yearsClaimFree: application.yearsClaimFree,
      });
      const approved = await this.portal.decideNcdApplication(tx, applicationId, insurerId, application.status, {
        status: 'APPROVED',
        decidedAt,
        approvedCodeId: code,
      });
      // Rolling back here also removes the code inserted above, so a lost race leaves no code behind.
      if (!approved) throw alreadyDecided();
      return { decision: toNcdApproval(approved, { code, percentage }), applicationNumber };
    });

    if ('percentage' in decision) {
      this.logger.log(`NCD ${applicationNumber} approved at ${decision.percentage}%`);
    }
    return decision;
  }

  /** Inserts a new code and returns it, drawing again while the drawn code is already taken. */
  private async insertUnusedNcdCode(tx: Transaction, code: Omit<NewNcdCode, 'code'>): Promise<string> {
    for (let attempt = 0; attempt < NCD_CODE_ATTEMPTS; attempt++) {
      const drawn = newNcdCode(this.pick);
      if (await this.portal.insertNcdCode(tx, { ...code, code: drawn })) return drawn;
    }
    throw new Error(`No unused NCD code was found in ${NCD_CODE_ATTEMPTS} attempts.`);
  }
}
