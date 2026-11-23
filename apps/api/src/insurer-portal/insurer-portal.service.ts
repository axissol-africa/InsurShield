import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
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
  toInformationRequest,
  toPortalRequest,
  toReply,
} from './dto/portal.response.js';
import { coverTermLabel, premiumFloorMinor } from './domain/premium-floor.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { QuoteProductsRepository, type VersionRow } from '../customer/quote-products.repository.js';
import { customerDate, QuoteWorkflowService } from '../customer/quote-workflow.service.js';
import type {
  AcknowledgeClaimDto,
  DeclineProductDto,
  InternalNoteDto,
  RequestInformationDto,
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
    private readonly versions: QuoteProductsRepository,
    private readonly workflow: QuoteWorkflowService,
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
    const requestIds = requests.map((request) => request.id);
    const [shots, selectedProducts, informationRequests, reasons] = await Promise.all([
      this.portal.shotKeys(insurerId, requestIds),
      this.portal.selectedProductsForRequests(insurerId, requestIds),
      this.versions.informationRequestsFor(requestIds, insurerId),
      this.workflow.declineReasons(),
    ]);
    const declineReasons = new Map(reasons.map((reason) => [reason.code, reason]));

    return Promise.all(
      requests.map(async (request) => {
        const requestProducts = selectedProducts.filter((product) => product.quoteRequestId === request.id);
        return toPortalRequest(
          request,
          shots.filter((shot) => shot.quoteRequestId === request.id).map((shot) => shot.shotKey),
          request.reply ? await this.documents.record(request.reply.documentId) : null,
          request.whiteBookDocumentId ? await this.documents.record(request.whiteBookDocumentId) : null,
          await Promise.all(
            requestProducts.map(async (selection) => ({
              selection,
              replyDocument: selection.reply ? await this.documents.record(selection.reply.documentId) : null,
            })),
          ),
          informationRequests.filter((asked) => asked.quoteRequestId === request.id),
          declineReasons,
        );
      }),
    );
  }

  /** The insurer's single final reply to a request. */
  async submitQuote(principal: Principal, requestId: string, dto: SubmitQuoteDto) {
    const insurerId = this.insurerOf(principal);
    const premiumMinor = kwachaToNgwee(dto.premium);
    const requestExpired = () =>
      ApiException.conflict('REQUEST_EXPIRED', 'This request has expired and can no longer be quoted.');
    const requestUnavailable = () =>
      ApiException.conflict('REQUEST_UNAVAILABLE', 'This request is no longer available to quote.');

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

      if (delivery.cancelledAt) throw requestUnavailable();

      const version = await this.productVersionForDelivery(
        tx,
        requestId,
        insurerId,
        delivery,
        dto.productVersionId,
      );
      const productVersionId = version?.productVersionId ?? null;

      if (await this.portal.hasQuote(requestId, insurerId, productVersionId, tx)) {
        throw ApiException.conflict(
          'ALREADY_QUOTED',
          'You have already sent a final quote for this product. Extend it instead of replacing it.',
        );
      }
      const sentAt = new Date();
      if (version) {
        // A chosen product runs on its own reply clock, which waiting for the
        // customer stops, so the request's original expiry does not decide it.
        if (version.status !== 'SUBMITTED' && version.status !== 'INSURER_PROCESSING' && version.status !== 'VERIFICATION_REQUIRED') {
          throw this.workflow.refusal(version.status, 'QUOTE');
        }
        this.workflow.assertWithinDeadline(version, sentAt);
      } else if (!isRequestOpen(delivery.status, delivery.expiresAt, sentAt)) {
        throw requestExpired();
      }

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
        productVersionId,
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
      if (version) {
        await this.workflow.move(tx, version, 'QUOTE', {
          actor: auditActor(principal),
          note: 'Insurer sent a final quote.',
          at: sentAt,
          patch: { pausedAt: null },
        });
      }
      await this.audit.write(tx, {
        actor: auditActor(principal),
        action: 'insurer_quote.issued',
        entityType: 'INSURER_QUOTE',
        entityId: quote.id,
        after: {
          quoteRequestId: quote.quoteRequestId,
          insurerId: quote.insurerId,
          productVersionId: quote.productVersionId,
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

    const outcome = await this.portal.transaction(async (tx) => {
      const extendedAt = new Date();
      const standing = await this.portal.insurerStanding(tx, insurerId);
      if (!standing) throw ApiException.notFound('Insurer', insurerId);
      if (!takesNewBusiness(standing, extendedAt)) {
        throw ApiException.conflict(INSURER_UNAVAILABLE, insurerUnavailable(standing.name));
      }
      const delivery = await this.portal.lockDelivery(tx, requestId, insurerId);
      if (!delivery) return { productVersionId: null, quote: null, missingDelivery: true };
      if (delivery.cancelledAt) {
        throw ApiException.conflict('REQUEST_UNAVAILABLE', 'This request is no longer available to quote.');
      }
      const productVersionId =
        (await this.productVersionForDelivery(tx, requestId, insurerId, delivery, dto.productVersionId))
          ?.productVersionId ?? null;
      const result = await this.portal.extendOpenQuote(
        tx,
        requestId,
        insurerId,
        productVersionId,
        dto.extraDays,
        extendedAt,
      );
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
      return { productVersionId, quote: result, missingDelivery: false };
    });
    if (outcome.missingDelivery) {
      throw await this.absent(
        principal,
        { type: 'QUOTE_REQUEST', label: 'Quote request' },
        requestId,
        await this.portal.quoteRequestExists(requestId),
      );
    }
    if (outcome.quote) return toExtension(outcome.quote);

    const quote = await this.portal.quoteAvailability(requestId, insurerId, outcome.productVersionId);
    if (quote?.unpayableAt) {
      throw ApiException.conflict(
        'QUOTE_UNAVAILABLE',
        'This quote is no longer available for the customer to pay. They need to request fresh quotes.',
      );
    }

    if (!quote) {
      throw ApiException.notFound('Quote for request', requestId);
    }
    throw ApiException.conflict(
      'QUOTE_EXPIRED',
      'This quote has already expired. The customer needs to request new quotes.',
    );
  }

  /**
   * New requests never infer a selected product from an insurer. A legacy
   * request stays actionable without a version so historic customer journeys
   * remain readable, while an outdated new-journey client is told to reload.
   */
  private async productVersionForDelivery(
    tx: Transaction,
    quoteRequestId: string,
    insurerId: string,
    delivery: { model: 'LEGACY' | 'PRODUCT_SELECTION' },
    requestedProductVersionId: string | undefined,
  ): Promise<VersionRow | null> {
    if (delivery.model === 'LEGACY') {
      if (requestedProductVersionId) {
        throw ApiException.conflict(
          'PRODUCT_VERSION_NOT_SELECTED',
          'This historic request does not have a selected product version.',
        );
      }
      return null;
    }
    if (!requestedProductVersionId) {
      throw ApiException.conflict(
        'RELOAD_REQUIRED',
        'InsurShield has been updated; reload the page and choose the product you are quoting.',
      );
    }
    const selection = await this.versions.lock(tx, quoteRequestId, requestedProductVersionId, { insurerId });
    if (!selection || selection.cancelledAt) {
      throw ApiException.conflict(
        'PRODUCT_VERSION_UNAVAILABLE',
        'This selected product is no longer available to quote.',
      );
    }
    return selection;
  }

  /**
   * Locks a chosen version of this insurer for a workflow action. A version
   * of another insurer answers as absent, audited like every other reach.
   */
  private async ownVersion(
    tx: Transaction,
    principal: Principal,
    requestId: string,
    productVersionId: string,
  ): Promise<{ version: VersionRow; insurerId: string }> {
    const insurerId = this.insurerOf(principal);
    const standing = await this.portal.insurerStanding(tx, insurerId);
    if (!standing) throw ApiException.notFound('Insurer', insurerId);
    if (!takesNewBusiness(standing, new Date())) {
      throw ApiException.conflict(INSURER_UNAVAILABLE, insurerUnavailable(standing.name));
    }
    const version = await this.versions.lock(tx, requestId, productVersionId, { insurerId });
    if (!version) {
      throw await this.absent(
        principal,
        { type: 'QUOTE_REQUEST', label: 'Quote request' },
        requestId,
        await this.portal.quoteRequestExists(requestId, tx),
      );
    }
    return { version, insurerId };
  }

  /** The approved reasons an insurer may decline with, as the rule in force states them. */
  async declineReasons(principal: Principal) {
    this.insurerOf(principal);
    return (await this.workflow.declineReasons()).map(({ code, customerText, internalText }) => ({
      code,
      customerText,
      internalText,
    }));
  }

  /** Declines one chosen product with an approved reason. The customer sees only the customer wording. */
  async declineProduct(principal: Principal, requestId: string, productVersionId: string, dto: DeclineProductDto) {
    return this.portal.transaction(async (tx) => {
      const { version, insurerId } = await this.ownVersion(tx, principal, requestId, productVersionId);
      const at = new Date();
      const reason = (await this.workflow.declineReasons(at, tx)).find((candidate) => candidate.code === dto.reasonCode);
      if (!reason) {
        throw new ApiException('VALIDATION_FAILED', 'Choose one of the listed reasons for declining.', HttpStatus.BAD_REQUEST, { reasonCode: 'Unknown reason.' });
      }
      const customerNote = dto.customerNote?.trim() || null;
      const status = await this.workflow.move(tx, version, 'DECLINE', {
        actor: auditActor(principal),
        note: `Declined: ${reason.code}.`,
        at,
        patch: { declineReasonCode: reason.code, declineCustomerNote: customerNote, pausedAt: null },
      });
      const internalNote = dto.internalNote?.trim();
      if (internalNote) {
        await this.versions.insertNote(tx, {
          quoteRequestId: requestId,
          productVersionId,
          insurerId,
          authorStaffId: this.staffOf(principal).id,
          body: internalNote,
        });
      }
      await this.notifications.notify(tx, {
        customerId: version.customerId,
        key: 'quote.version_declined',
        entity: { type: 'QUOTE_REQUEST', id: requestId },
        values: {
          insurer: version.insurerName,
          product: version.productName,
          quoteRequestId: requestId,
          reason: reason.customerText,
        },
      });
      return { productVersionId, status, decline: { reasonCode: reason.code, customerText: reason.customerText, customerNote } };
    });
  }

  /** Asks the customer for more information. The reply clock stops until they answer. */
  async requestInformation(
    principal: Principal,
    requestId: string,
    productVersionId: string,
    dto: RequestInformationDto,
  ) {
    const message = dto.message.trim();
    if (message.length < 5) {
      throw new ApiException('VALIDATION_FAILED', 'Write what you need from the customer.', HttpStatus.BAD_REQUEST, { message: 'Too short.' });
    }
    return this.portal.transaction(async (tx) => {
      const { version, insurerId } = await this.ownVersion(tx, principal, requestId, productVersionId);
      const at = new Date();
      this.workflow.assertWithinDeadline(version, at);
      const status = await this.workflow.move(tx, version, 'REQUEST_INFORMATION', {
        actor: auditActor(principal),
        note: 'Insurer asked the customer for more information.',
        at,
        patch: { pausedAt: at },
      });
      const asked = await this.versions.insertInformationRequest(tx, {
        quoteRequestId: requestId,
        productVersionId,
        insurerId,
        requestedByStaffId: this.staffOf(principal).id,
        message,
        dueAt: addDays(at, dto.dueInDays),
      });
      await this.notifications.notify(tx, {
        customerId: version.customerId,
        key: 'quote.information_requested',
        entity: { type: 'QUOTE_REQUEST', id: requestId },
        values: {
          insurer: version.insurerName,
          product: version.productName,
          quoteRequestId: requestId,
          dueDate: customerDate(asked.dueAt),
        },
      });
      return { productVersionId, status, informationRequest: toInformationRequest(asked) };
    });
  }

  /** This insurer's notes on one chosen product, newest first. */
  async listNotes(principal: Principal, requestId: string, productVersionId: string) {
    const insurerId = this.insurerOf(principal);
    const owned = await this.portal.transaction((tx) => this.versions.lock(tx, requestId, productVersionId, { insurerId }));
    if (!owned) {
      throw await this.absent(
        principal,
        { type: 'QUOTE_REQUEST', label: 'Quote request' },
        requestId,
        await this.portal.quoteRequestExists(requestId),
      );
    }
    const notes = await this.versions.notesFor(requestId, productVersionId, insurerId);
    return notes.map((note) => ({ id: note.id, body: note.body, author: note.authorName, createdAt: note.createdAt.toISOString() }));
  }

  /** Adds an internal note. Notes are append-only and never reach the customer. */
  async addNote(principal: Principal, requestId: string, productVersionId: string, dto: InternalNoteDto) {
    const body = dto.body.trim();
    if (!body) throw new ApiException('VALIDATION_FAILED', 'Write the note before saving it.', HttpStatus.BAD_REQUEST, { body: 'Empty.' });
    const insurerId = this.insurerOf(principal);
    const staff = this.staffOf(principal);
    const created = await this.portal.transaction(async (tx) => {
      const version = await this.versions.lock(tx, requestId, productVersionId, { insurerId });
      if (!version) return null;
      const note = await this.versions.insertNote(tx, {
        quoteRequestId: requestId,
        productVersionId,
        insurerId,
        authorStaffId: staff.id,
        body,
      });
      // The audit row says a note was written, never what it says.
      await this.audit.write(tx, {
        actor: auditActor(principal),
        action: 'quote_note.added',
        entityType: 'QUOTE_REQUEST_PRODUCT',
        entityId: version.id,
        note: 'Insurer added an internal note.',
        correlationId: requestId,
      });
      return note;
    });
    if (!created) {
      throw await this.absent(
        principal,
        { type: 'QUOTE_REQUEST', label: 'Quote request' },
        requestId,
        await this.portal.quoteRequestExists(requestId),
      );
    }
    const author = (await this.versions.notesFor(requestId, productVersionId, insurerId)).find((note) => note.id === created.id)?.authorName;
    return { id: created.id, body: created.body, author: author ?? null, createdAt: created.createdAt.toISOString() };
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
