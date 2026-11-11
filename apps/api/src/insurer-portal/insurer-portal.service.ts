import { Inject, Injectable, Logger } from '@nestjs/common';
import { DocumentsService } from '../documents/documents.service.js';
import { ApiException } from '../common/errors/api.exception.js';
import { INSURER_UNAVAILABLE, insurerUnavailable, takesNewBusiness } from '../common/insurer-standing.js';
import { kwachaToNgwee, ngweeToKwacha } from '../common/money.js';
import { isRequestOpen } from '../common/domain/quote-request.js';
import type { Principal } from '../common/auth/auth.types.js';
import { isInsurerRole } from '../common/domain/enums.js';

/** Insurer staff, with the insurer they act for resolved. */
export type InsurerStaff = Extract<Principal, { kind: 'staff' }> & { insurerId: string };
import type { Transaction } from '../db/database.module.js';
import { PiaService } from '../pia/pia.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { auditActor } from '../common/audit/audit.types.js';
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
import { coverTermLabel, premiumFloorMinor } from './domain/premium-floor.js';
import { NotificationsService } from '../notifications/notifications.service.js';
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
    private readonly pia: PiaService,
    @Inject(NCD_CODE_PICK) private readonly pick: (n: number) => number,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * The insurer staff member this caller is, or a refusal.
   *
   * Any insurer role qualifies, not just the one the portal began with: which
   * functions each role may reach is the permission matrix's business, and
   * testing for a single role here left the roles added for decision 7 able to
   * pass the guard and then be refused by every service behind it.
   */
  staffOf(principal: Principal): InsurerStaff {
    if (principal.kind !== 'staff' || !isInsurerRole(principal.role) || !principal.insurerId) {
      throw ApiException.forbidden('This account is not linked to an insurer.');
    }
    return { ...principal, insurerId: principal.insurerId };
  }

  /** The insurer this caller acts for, or a refusal if the account has none. */
  insurerOf(principal: Principal): string {
    return this.staffOf(principal).insurerId;
  }

  /**
   * A record this insurer cannot see answers as absent. When it exists and
   * belongs to another insurer, US-VEN-001 asks for the attempt to be audited:
   * the row names who reached and what they reached for, never anything about
   * the record, which they never saw.
   *
   * The audit is written on its own connection, because this returns an error
   * the caller throws and that rollback would take the row with it.
   */
  private async absent(
    principal: Principal,
    entity: { type: string; label: string },
    entityId: string,
    exists: boolean,
  ): Promise<ApiException> {
    if (exists) {
      const staff = this.staffOf(principal);
      await this.audit.refusal({
        actor: auditActor(staff),
        action: 'access.refused',
        entityType: entity.type,
        entityId,
        note: "Reached for another insurer's record.",
        correlationId: staff.insurerId,
      });
    }
    return ApiException.notFound(entity.label, entityId);
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
          request.whiteBookDocumentId ? await this.documents.record(request.whiteBookDocumentId) : null,
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
      const standing = await this.portal.insurerStanding(tx, insurerId);
      if (!standing) throw ApiException.notFound('Insurer', insurerId);
      if (!takesNewBusiness(standing, new Date())) {
        throw ApiException.conflict(INSURER_UNAVAILABLE, insurerUnavailable(standing.name));
      }

      const delivery = await this.portal.lockDelivery(tx, requestId, insurerId);
      if (!delivery) {
        throw await this.absent(
          principal,
          { type: 'QUOTE_REQUEST', label: 'Quote request' },
          requestId,
          await this.portal.quoteRequestExists(requestId, tx),
        );
      }

      if (await this.portal.hasQuote(requestId, insurerId, tx)) {
        throw ApiException.conflict(
          'ALREADY_QUOTED',
          'You have already sent a final quote for this request. Extend it instead of replacing it.',
        );
      }
      const sentAt = new Date();
      if (!isRequestOpen(delivery.status, delivery.expiresAt, sentAt)) throw requestExpired();

      const minimumPremiumMinor = premiumFloorMinor(
        delivery.vehicleValueMinor,
        await this.pia.currentRateBps(tx),
        delivery.coverageDuration,
      );
      if (premiumMinor < minimumPremiumMinor) {
        throw ApiException.conflict(
          'PREMIUM_BELOW_PIA_FLOOR',
          `The minimum PIA premium for this ${coverTermLabel(delivery.coverageDuration)} cover is ZMW ${ngweeToKwacha(minimumPremiumMinor).toFixed(2)}.`,
        );
      }

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
      await this.audit.write(tx, {
        actor: auditActor(principal),
        action: 'insurer_quote.issued',
        entityType: 'INSURER_QUOTE',
        entityId: quote.id,
        after: {
          quoteRequestId: quote.quoteRequestId,
          insurerId: quote.insurerId,
          premiumMinor: quote.premiumMinor,
          validityDays: quote.validityDays,
        },
        note: 'Insurer issued a final quote.',
        correlationId: requestId,
      });
      if (delivery.status !== 'QUOTED') {
        await this.audit.transition(tx, {
          actor: auditActor(principal),
          entityType: 'QUOTE_REQUEST',
          entityId: requestId,
          fromStatus: delivery.status,
          toStatus: 'QUOTED',
          note: 'First insurer quote received.',
          correlationId: requestId,
        });
      }

      // Told once the insurer has actually quoted, in the same transaction, so
      // a rolled-back reply never reaches the customer.
      await this.notifications.notify(tx, {
        customerId: delivery.customerId,
        key: 'quote.ready',
        entity: { type: 'QUOTE_REQUEST', id: requestId },
        values: { insurer: delivery.insurerName },
      });
      return toReply(quote, await this.documents.record(quote.documentId, tx));
    });

    this.logger.log(`Quote sent for ${requestId} by insurer ${insurerId}`);
    return reply;
  }

  /** Keeps an open quote available for longer. An expired quote cannot be revived. */
  async extendQuote(principal: Principal, requestId: string, dto: ExtendQuoteDto) {
    const insurerId = this.insurerOf(principal);

    const extended = await this.portal.transaction(async (tx) => {
      const extendedAt = new Date();
      const standing = await this.portal.insurerStanding(tx, insurerId);
      if (!standing) throw ApiException.notFound('Insurer', insurerId);
      if (!takesNewBusiness(standing, extendedAt)) {
        throw ApiException.conflict(INSURER_UNAVAILABLE, insurerUnavailable(standing.name));
      }
      const result = await this.portal.extendOpenQuote(tx, requestId, insurerId, dto.extraDays, extendedAt);
      if (result) {
        await this.audit.write(tx, {
          actor: auditActor(principal),
          action: 'insurer_quote.extended',
          entityType: 'INSURER_QUOTE',
          entityId: result.id,
          after: { validityDays: result.validityDays },
          note: `Insurer extended a quote by ${dto.extraDays} day${dto.extraDays === 1 ? '' : 's'}.`,
          correlationId: requestId,
        });
      }
      return result;
    });
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
      if (!policy) {
        throw await this.absent(
          principal,
          { type: 'POLICY', label: 'Policy' },
          policyNumber,
          await this.portal.policyExists(policyNumber, tx),
        );
      }
      if (policy.status === 'ACTIVE') throw alreadyIssued();

      await this.documents.assertAttachable(tx, principal, [dto.certificateDocumentId], 'CERTIFICATE');

      const activated = await this.portal.activatePolicy(tx, policyNumber, insurerId, {
        certificateDocumentId: dto.certificateDocumentId,
        insurerPolicyNumber: dto.insurerPolicyNumber ?? null,
        issuedAt: new Date(),
      });
      if (!activated) throw alreadyIssued();
      await this.audit.write(tx, {
        actor: auditActor(principal),
        action: 'policy.certificate_issued',
        entityType: 'POLICY',
        entityId: activated.policyNumber,
        after: { hasCertificate: true, hasInsurerPolicyNumber: Boolean(activated.insurerPolicyNumber) },
        note: 'Insurer uploaded the official policy certificate.',
        correlationId: activated.policyNumber,
      });
      await this.audit.transition(tx, {
        actor: auditActor(principal),
        entityType: 'POLICY',
        entityId: activated.policyNumber,
        fromStatus: policy.status,
        toStatus: activated.status,
        note: 'Policy activated when the insurer certificate was issued.',
        correlationId: activated.policyNumber,
      });

      await this.notifications.notify(tx, {
        customerId: policy.customerId,
        key: 'policy.certificate_issued',
        entity: { type: 'POLICY', id: activated.policyNumber },
        values: { insurer: policy.insurerName, policyNumber: activated.policyNumber },
      });
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

    const acknowledged = await this.portal.transaction(async (tx) => {
      const receipt = { receivedAt: new Date(), insurerClaimReference: dto.insurerClaimReference ?? undefined };
      const result = await this.portal.acknowledgeClaim(tx, claimNumber, insurerId, receipt);
      if (result) {
        await this.audit.write(tx, {
          actor: auditActor(principal),
          action: 'claim.received_by_insurer',
          entityType: 'CLAIM',
          entityId: result.claimNumber,
          after: { hasInsurerReference: Boolean(result.insurerClaimReference) },
          note: 'Insurer acknowledged receipt of the claim notification.',
          correlationId: result.claimNumber,
        });
        await this.audit.transition(tx, {
          actor: auditActor(principal),
          entityType: 'CLAIM',
          entityId: result.claimNumber,
          fromStatus: 'NOTIFIED',
          toStatus: result.status,
          note: 'Insurer acknowledged the claim notification.',
          correlationId: result.claimNumber,
        });

        // A claim may have no account behind it — a guest can notify one, and
        // closing an account sets the link to null — so there may be nobody to
        // tell. The claim is still acknowledged either way.
        if (result.customerId) {
          await this.notifications.notify(tx, {
            customerId: result.customerId,
            key: 'claim.acknowledged',
            entity: { type: 'CLAIM', id: result.claimNumber },
            values: { insurer: await this.portal.insurerName(tx, insurerId), claimNumber: result.claimNumber },
          });
        }
      }
      return result;
    });
    if (acknowledged) return toAcknowledgement(acknowledged);

    const claim = await this.portal.findAcknowledgement(claimNumber, insurerId);
    if (!claim) {
      throw await this.absent(
        principal,
        { type: 'CLAIM', label: 'Claim' },
        claimNumber,
        await this.portal.claimExists(claimNumber),
      );
    }
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
    if (dto.status !== 'APPROVED' && dto.percentage !== undefined) {
      throw new ApiException('BAD_REQUEST', 'A discount percentage can be set only when approving an NCD application.');
    }
    const alreadyDecided = () =>
      ApiException.conflict('ALREADY_DECIDED', 'This application has already been approved and its code issued.');

    const { decision, applicationNumber } = await this.portal.transaction(async (tx) => {
      const application = await this.portal.lockNcdApplication(tx, applicationId, insurerId);
      if (!application) {
        throw await this.absent(
          principal,
          { type: 'NCD_APPLICATION', label: 'NCD application' },
          applicationId,
          await this.portal.ncdApplicationExists(applicationId, tx),
        );
      }
      if (!canDecideNcd(application.status)) throw alreadyDecided();

      const decidedOn = new Date();
      const decidedAt = ncdDecidedAt(dto.status, decidedOn);
      const { applicationNumber } = application;
      if (dto.status !== 'APPROVED') {
        const decided = await this.portal.decideNcdApplication(tx, applicationId, insurerId, application.status, {
          status: dto.status,
          decidedAt,
        });
        if (!decided) throw alreadyDecided();
        await this.audit.transition(tx, {
          actor: auditActor(principal),
          entityType: 'NCD_APPLICATION',
          entityId: applicationId,
          fromStatus: application.status,
          toStatus: decided.status,
          note: 'Insurer recorded an NCD decision.',
          correlationId: applicationNumber,
        });

        if (application.customerId) {
          await this.notifications.notify(tx, {
            customerId: application.customerId,
            key: 'ncd.decided',
            entity: { type: 'NCD_APPLICATION', id: applicationNumber },
            values: { insurer: await this.portal.insurerName(tx, insurerId) },
          });
        }
        return { decision: toNcdDecision(decided), applicationNumber };
      }

      // An approved code is a priced offer to a customer, so it is new business
      // and follows the same rule as a quote. Declining stays open to an insurer
      // that may no longer sell: answering an application it already holds is
      // servicing, and leaving it undecidable would strand the customer.
      const standing = await this.portal.insurerStanding(tx, insurerId);
      if (!standing) throw ApiException.notFound('Insurer', insurerId);
      if (!takesNewBusiness(standing, decidedOn)) {
        throw ApiException.conflict(INSURER_UNAVAILABLE, insurerUnavailable(standing.name));
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
      await this.audit.write(tx, {
        actor: auditActor(principal),
        action: 'ncd_code.issued',
        entityType: 'NCD_APPLICATION',
        entityId: applicationId,
        after: { percentage },
        note: 'Insurer issued a No Claim Discount code.',
        correlationId: applicationNumber,
      });
      await this.audit.transition(tx, {
        actor: auditActor(principal),
        entityType: 'NCD_APPLICATION',
        entityId: applicationId,
        fromStatus: application.status,
        toStatus: approved.status,
        note: 'Insurer approved the NCD application.',
        correlationId: applicationNumber,
      });
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
