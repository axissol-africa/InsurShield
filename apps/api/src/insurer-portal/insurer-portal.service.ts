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
import { quoteContent } from './domain/quote-content.js';
import type { CoverageDuration } from '../common/domain/enums.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { QuoteProductsRepository, type VersionRow } from '../customer/quote-products.repository.js';
import { customerDate, QuoteWorkflowService } from '../customer/quote-workflow.service.js';
import { slaState } from '../customer/domain/quote-workflow.js';
import { UnderwritingInspectionsRepository } from '../customer/underwriting-inspections.repository.js';
import { UnderwritingInspectionsService, type InspectionAction } from '../customer/underwriting-inspections.service.js';
import type { InspectionEvent } from '../inspections/domain/underwriting.js';
import { toContract } from '../common/contract.js';
import { QUOTE_PRODUCT_STATUSES, type QuoteProductStatus } from '../common/domain/enums.js';
import type {
  AcknowledgeClaimDto,
  AssignProductDto,
  DeclineProductDto,
  ProductPriorityDto,
  QueueQueryDto,
  InternalNoteDto,
  RequestInformationDto,
  ExtendQuoteDto,
  IssueCertificateDto,
  AcceptIssuanceDto,
  IssuanceFailureDto,
  NcdDecisionDto,
  SubmitQuoteDto,
  WithdrawQuoteDto,
} from './dto/portal.dto.js';

/** Chooses one of `n` characters for a new NCD code; `crypto.randomInt` outside tests. */
export const NCD_CODE_PICK = Symbol('NCD_CODE_PICK');

const NCD_CODE_ATTEMPTS = 5;
/** The queue answers its most urgent rows; filters narrow it further. */
const QUEUE_LIMIT = 200;

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
    private readonly inspectionRecords: UnderwritingInspectionsRepository,
    private readonly underwriting: UnderwritingInspectionsService,
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
    const now = new Date();
    const [shots, selectedProducts, informationRequests, reasons, warning] = await Promise.all([
      this.portal.shotKeys(insurerId, requestIds),
      this.portal.selectedProductsForRequests(insurerId, requestIds),
      this.versions.informationRequestsFor(requestIds, insurerId),
      this.workflow.declineReasons(now),
      this.workflow.slaWarning(now),
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
          { hoursBeforeDue: warning.value.hoursBeforeDue, now },
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

      const quote = await this.portal.insertQuote(
        tx,
        await this.newQuote(tx, principal, { requestId, insurerId, productVersionId, delivery, dto, premiumMinor, sentAt }),
      );
      // The request is "Quoted" as soon as one insurer replies; others may still reply afterwards.
      if (!(await this.portal.markQuoted(tx, requestId, insurerId, sentAt))) throw requestExpired();
      if (version) {
        await this.ownIfUnowned(tx, principal, version, sentAt);
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

  /**
   * Everything a new final quote must pass before it is stored, shared by a
   * first quote and a replacement: the PIA floor, the content against its
   * premium and the add-on catalogue, and the quotation document.
   */
  private async newQuote(
    tx: Transaction,
    principal: Principal,
    input: {
      requestId: string;
      insurerId: string;
      productVersionId: string | null;
      delivery: { vehicleValueMinor: number; coverageDuration: CoverageDuration; quoteValidityDays: number };
      dto: SubmitQuoteDto;
      premiumMinor: number;
      sentAt: Date;
    },
  ) {
    const { delivery, dto, premiumMinor, sentAt } = input;
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
    const content = quoteContent(premiumMinor, dto, await this.workflow.addOnCatalogue(sentAt, tx));
    if ('errors' in content) {
      throw new ApiException('VALIDATION_FAILED', Object.values(content.errors)[0], HttpStatus.BAD_REQUEST, content.errors);
    }

    await this.documents.assertAttachable(tx, principal, [dto.documentId], 'QUOTATION');

    const validityDays = dto.validityDays ?? delivery.quoteValidityDays;
    return {
      quoteRequestId: input.requestId,
      insurerId: input.insurerId,
      productVersionId: input.productVersionId,
      premiumMinor,
      notes: dto.notes ?? null,
      insurerReference: dto.insurerReference ?? null,
      documentId: dto.documentId,
      validityDays,
      sentAt,
      validUntil: addDays(sentAt, validityDays),
      ...content.value,
    };
  }

  /**
   * Withdraws this insurer's current quote for a chosen product. Refused once
   * the customer has chosen it, paid for it, or it has expired: a quote the
   * customer is acting on is never pulled from under them.
   */
  async withdrawQuote(principal: Principal, requestId: string, productVersionId: string, dto: WithdrawQuoteDto) {
    const reason = dto.reason.trim();
    return this.portal.transaction(async (tx) => {
      const { version, insurerId } = await this.ownVersion(tx, principal, requestId, productVersionId);
      const at = new Date();
      const quote = await this.changeableQuote(tx, requestId, insurerId, productVersionId, at);
      await this.portal.withdrawQuote(tx, quote.id, reason, at);
      const status = await this.workflow.move(tx, version, 'WITHDRAW_QUOTE', {
        actor: auditActor(principal),
        note: 'Insurer withdrew its quote.',
        at,
      });
      await this.audit.write(tx, {
        actor: auditActor(principal),
        action: 'insurer_quote.withdrawn',
        entityType: 'INSURER_QUOTE',
        entityId: quote.id,
        after: { status: 'WITHDRAWN', reason },
        note: 'Insurer withdrew a final quote.',
        correlationId: requestId,
      });
      await this.notifications.notify(tx, {
        customerId: version.customerId,
        key: 'quote.withdrawn',
        entity: { type: 'QUOTE_REQUEST', id: requestId },
        values: { insurer: version.insurerName, product: version.productName, quoteRequestId: requestId },
      });
      return { productVersionId, status };
    });
  }

  /** Replaces this insurer's current quote for a chosen product with a new one, under the same refusals as a withdrawal. */
  async replaceQuote(principal: Principal, requestId: string, productVersionId: string, dto: SubmitQuoteDto) {
    const premiumMinor = kwachaToNgwee(dto.premium);
    return this.portal.transaction(async (tx) => {
      const { version, insurerId } = await this.ownVersion(tx, principal, requestId, productVersionId);
      const delivery = await this.portal.lockDelivery(tx, requestId, insurerId);
      if (!delivery || delivery.cancelledAt) {
        throw ApiException.conflict('REQUEST_UNAVAILABLE', 'This request is no longer available to quote.');
      }
      const sentAt = new Date();
      const old = await this.changeableQuote(tx, requestId, insurerId, productVersionId, sentAt);
      await this.portal.supersedeQuote(tx, old.id);
      const quote = await this.portal.insertQuote(
        tx,
        await this.newQuote(tx, principal, { requestId, insurerId, productVersionId, delivery, dto, premiumMinor, sentAt }),
      );
      await this.portal.linkReplacement(tx, old.id, quote.id);
      await this.audit.write(tx, {
        actor: auditActor(principal),
        action: 'insurer_quote.replaced',
        entityType: 'INSURER_QUOTE',
        entityId: quote.id,
        before: { quoteId: old.id, premiumMinor: old.premiumMinor },
        after: { quoteId: quote.id, premiumMinor: quote.premiumMinor, validityDays: quote.validityDays },
        note: 'Insurer replaced a final quote.',
        correlationId: requestId,
      });
      await this.notifications.notify(tx, {
        customerId: version.customerId,
        key: 'quote.replaced',
        entity: { type: 'QUOTE_REQUEST', id: requestId },
        values: { insurer: version.insurerName, product: version.productName, quoteRequestId: requestId },
      });
      return toReply(quote, await this.documents.record(quote.documentId, tx));
    });
  }

  private async changeableQuote(tx: Transaction, requestId: string, insurerId: string, productVersionId: string, at: Date) {
    const quote = await this.portal.lockActiveQuote(tx, requestId, insurerId, productVersionId);
    if (!quote) throw ApiException.conflict('NO_CURRENT_QUOTE', 'There is no current quote for this product to change.');
    if (quote.paid) throw ApiException.conflict('ALREADY_PAID', 'The customer has paid for this quote, so it can no longer change.');
    if (quote.selected) {
      throw ApiException.conflict('QUOTE_SELECTED', 'The customer has chosen this quote. It can change only if they choose another.');
    }
    if (quote.unpayableAt) throw ApiException.conflict('QUOTE_UNAVAILABLE', 'This quote is no longer available.');
    if (quote.validUntil <= at) throw ApiException.conflict('QUOTE_EXPIRED', 'This quote has expired and can no longer change.');
    return quote;
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

  /** The first person to act on an unowned product becomes its owner. */
  private async ownIfUnowned(tx: Transaction, principal: Principal, version: VersionRow, at: Date): Promise<void> {
    if (!version.assignedStaffId) await this.versions.assign(tx, version.id, this.staffOf(principal).id, at);
  }

  /** Takes a product for yourself and starts work on it. */
  async claimProduct(principal: Principal, requestId: string, productVersionId: string) {
    return this.portal.transaction(async (tx) => {
      const { version } = await this.ownVersion(tx, principal, requestId, productVersionId);
      const staff = this.staffOf(principal);
      if (version.assignedStaffId && version.assignedStaffId !== staff.id) {
        throw ApiException.conflict('ALREADY_ASSIGNED', 'A colleague already owns this product. Ask your administrator to reassign it.');
      }
      const at = new Date();
      await this.versions.assign(tx, version.id, staff.id, at);
      const status = version.status === 'SUBMITTED'
        ? await this.workflow.move(tx, version, 'CLAIM', { actor: auditActor(principal), note: 'Insurer officer claimed the product.', at })
        : version.status;
      await this.audit.write(tx, {
        actor: auditActor(principal),
        action: 'quote_product.assigned',
        entityType: 'QUOTE_REQUEST_PRODUCT',
        entityId: version.id,
        before: { assignedStaffId: version.assignedStaffId },
        after: { assignedStaffId: staff.id },
        note: 'Claimed by the officer.',
        correlationId: requestId,
      });
      return { productVersionId, status, ownerStaffId: staff.id };
    });
  }

  /**
   * Gives a product to a member of this insurer's quoting team, or leaves it
   * unowned. Only the insurer's administrator assigns to someone else.
   */
  async assignProduct(principal: Principal, requestId: string, productVersionId: string, dto: AssignProductDto) {
    const staff = this.staffOf(principal);
    const target = dto.staffId ?? null;
    if (staff.role !== 'INSURER_ADMIN' && target !== staff.id) {
      throw ApiException.forbidden('Only your administrator can assign products to someone else.');
    }
    return this.portal.transaction(async (tx) => {
      const { version, insurerId } = await this.ownVersion(tx, principal, requestId, productVersionId);
      if (target) {
        const member = await this.versions.insurerStaffMember(insurerId, target, tx);
        if (!member || !['INSURER_ADMIN', 'QUOTE_OFFICER', 'INSURER_USER'].includes(member.role)) {
          throw new ApiException('VALIDATION_FAILED', 'Choose an active member of your quoting team.', HttpStatus.BAD_REQUEST, {
            staffId: 'Not on your quoting team.',
          });
        }
      }
      await this.versions.assign(tx, version.id, target, new Date());
      await this.audit.write(tx, {
        actor: auditActor(principal),
        action: 'quote_product.assigned',
        entityType: 'QUOTE_REQUEST_PRODUCT',
        entityId: version.id,
        before: { assignedStaffId: version.assignedStaffId },
        after: { assignedStaffId: target },
        note: target ? 'Product assigned.' : 'Product left unassigned.',
        correlationId: requestId,
      });
      return { productVersionId, ownerStaffId: target };
    });
  }

  /** Marks a product as urgent or normal for the team. Administrator only. */
  async setProductPriority(principal: Principal, requestId: string, productVersionId: string, dto: ProductPriorityDto) {
    if (this.staffOf(principal).role !== 'INSURER_ADMIN') {
      throw ApiException.forbidden('Only your administrator can change a product\'s priority.');
    }
    return this.portal.transaction(async (tx) => {
      const { version } = await this.ownVersion(tx, principal, requestId, productVersionId);
      await this.versions.setPriority(tx, version.id, dto.priority);
      await this.audit.write(tx, {
        actor: auditActor(principal),
        action: 'quote_product.priority_changed',
        entityType: 'QUOTE_REQUEST_PRODUCT',
        entityId: version.id,
        before: { priority: version.priority },
        after: { priority: dto.priority },
        note: `Priority set to ${dto.priority.toLowerCase()}.`,
        correlationId: requestId,
      });
      return { productVersionId, priority: dto.priority };
    });
  }

  /** This insurer's open chosen products, most urgent first, with who owns each and how it stands against its deadline. */
  async queue(principal: Principal, query: QueueQueryDto) {
    const staff = this.staffOf(principal);
    const statuses = query.status
      ?.split(',')
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean);
    const unknown = statuses?.find((value) => !(QUOTE_PRODUCT_STATUSES as readonly string[]).includes(value));
    if (unknown) {
      throw new ApiException('VALIDATION_FAILED', `Unknown status ${unknown}.`, HttpStatus.BAD_REQUEST, { status: 'Unknown status.' });
    }
    const now = new Date();
    const { value } = await this.workflow.slaWarning(now);
    const rows = await this.versions.queue(
      staff.insurerId,
      {
        statuses: statuses as QuoteProductStatus[] | undefined,
        ownerStaffId: query.owner === 'me' ? staff.id : query.owner === 'unassigned' ? null : undefined,
        priority: query.priority,
        search: query.search,
      },
      QUEUE_LIMIT,
    );
    return rows
      .map((row) => ({
        quoteRequestId: row.quoteRequestId,
        productVersionId: row.productVersionId,
        productName: row.productName,
        productVersionNumber: row.productVersionNumber,
        vehicle: row.vehicle,
        plateNumber: row.plateNumber,
        status: row.status,
        priority: row.priority,
        owner: row.owner?.id ? { id: row.owner.id, name: row.owner.fullName } : null,
        submittedAt: row.submittedAt.toISOString(),
        replyDueAt: row.replyDueAt?.toISOString() ?? null,
        sla: slaState(row, value.hoursBeforeDue, now),
      }))
      .filter((row) => !query.sla || row.sla === query.sla);
  }

  // ── Inspections ──────────────────────────────────────────────

  /** Every inspection this insurer carries out, newest first, with the products each one serves. */
  async listInspections(principal: Principal) {
    const insurerId = this.insurerOf(principal);
    const rows = await this.inspectionRecords.listForInsurer(insurerId);
    const products = await this.inspectionRecords.productsOf(rows.map((row) => row.id));
    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      statusLabel: toContract.inspectionStatus(row.status),
      purpose: row.purpose,
      method: row.method,
      stage: row.stage,
      quoteRequestId: row.quoteRequestId,
      vehiclePlate: row.vehiclePlate,
      vehicleLabel: row.vehicleLabel,
      customer: row.customer,
      scheduledDate: row.scheduledDate?.toISOString() ?? null,
      location: row.location,
      inspectorName: row.inspectorName,
      inspectorPhone: row.inspectorPhone,
      predecessorId: row.predecessorId,
      result: row.result,
      resultReason: row.resultReason,
      decidedAt: row.decidedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      products: products
        .filter((product) => product.inspectionId === row.id)
        .map(({ productVersionId, productName, passed }) => ({ productVersionId, productName, passed })),
    }));
  }

  /** Books, staffs or decides one of this insurer's inspections; the products it serves move with it. */
  async actOnInspection(principal: Principal, id: string, event: InspectionEvent, input: InspectionAction) {
    const staff = this.staffOf(principal);
    const result = await this.portal.transaction(async (tx) => {
      const standing = await this.portal.insurerStanding(tx, staff.insurerId);
      if (!standing) throw ApiException.notFound('Insurer', staff.insurerId);
      if (!takesNewBusiness(standing, new Date())) {
        throw ApiException.conflict(INSURER_UNAVAILABLE, insurerUnavailable(standing.name));
      }
      return this.underwriting.act(tx, staff.insurerId, auditActor(principal), staff.id, id, event, input);
    });
    if (!result) {
      throw await this.absent(principal, { type: 'INSPECTION', label: 'Inspection' }, id, await this.inspectionRecords.exists(id));
    }
    return { id: result.id, status: result.status, statusLabel: toContract.inspectionStatus(result.status), result: result.result };
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
      await this.ownIfUnowned(tx, principal, version, at);
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
      await this.ownIfUnowned(tx, principal, version, at);
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
      if (policy.status !== 'AWAITING_INSURER_CERTIFICATE') throw issuanceClosed();

      await this.documents.assertAttachable(tx, principal, [dto.certificateDocumentId], 'CERTIFICATE');

      const activated = await this.portal.activatePolicy(tx, policyNumber, insurerId, {
        certificateDocumentId: dto.certificateDocumentId,
        // The number given at acceptance stands unless the certificate brings one.
        insurerPolicyNumber: dto.insurerPolicyNumber ?? policy.insurerPolicyNumber ?? null,
        issuedAt: new Date(),
      });
      if (!activated) throw alreadyIssued();
      for (const resolved of await this.portal.resolveOverdue(tx, policy.paymentId, activated.issuedAt ?? new Date())) {
        await this.audit.transition(tx, {
          actor: auditActor(principal),
          entityType: 'RECONCILIATION_ITEM',
          entityId: resolved.id,
          fromStatus: 'OPEN',
          toStatus: 'RESOLVED',
          note: 'Resolved as ISSUED: the insurer issued the late policy.',
          correlationId: activated.policyNumber,
        });
      }
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

  /** The insurer takes on issuing a paid policy. Recorded once; a repeat answers what was recorded. */
  async acceptIssuance(principal: Principal, policyNumber: string, dto: AcceptIssuanceDto) {
    const insurerId = this.insurerOf(principal);
    return this.portal.transaction(async (tx) => {
      const policy = await this.issuingPolicy(tx, principal, policyNumber, insurerId);
      if (policy.issuanceAcceptedAt) {
        return { policyNumber, issuanceAcceptedAt: policy.issuanceAcceptedAt.toISOString(), insurerPolicyNumber: policy.insurerPolicyNumber };
      }
      const at = new Date();
      const accepted = await this.portal.acceptIssuance(tx, policyNumber, at, dto.insurerPolicyNumber?.trim() || null);
      if (!accepted) throw issuanceClosed();
      await this.audit.write(tx, {
        actor: auditActor(principal),
        action: 'policy.issuance_accepted',
        entityType: 'POLICY',
        entityId: policyNumber,
        after: { hasInsurerPolicyNumber: Boolean(accepted.insurerPolicyNumber) },
        note: 'The insurer accepted the paid policy for issuing.',
        correlationId: policyNumber,
      });
      await this.notifications.notify(tx, {
        customerId: policy.customerId,
        key: 'policy.issuance_accepted',
        entity: { type: 'POLICY', id: policyNumber },
        values: { insurer: policy.insurerName, policyNumber },
      });
      return { policyNumber, issuanceAcceptedAt: at.toISOString(), insurerPolicyNumber: accepted.insurerPolicyNumber };
    });
  }

  /**
   * The insurer cannot issue a paid policy. The money is the customer's, so
   * the failure opens a reconciliation item that ends in a refund; nothing is
   * refunded from here.
   */
  async reportIssuanceFailure(principal: Principal, policyNumber: string, dto: IssuanceFailureDto) {
    const insurerId = this.insurerOf(principal);
    const message = dto.customerMessage.trim();
    return this.portal.transaction(async (tx) => {
      const policy = await this.issuingPolicy(tx, principal, policyNumber, insurerId);
      const at = new Date();
      const failed = await this.portal.failIssuance(tx, policyNumber, at, message);
      if (!failed) throw issuanceClosed();
      await this.audit.write(tx, {
        actor: auditActor(principal),
        action: 'policy.issuance_failed',
        entityType: 'POLICY',
        entityId: policyNumber,
        after: { reasonCode: dto.reasonCode },
        note: message,
        correlationId: policyNumber,
      });
      await this.audit.transition(tx, {
        actor: auditActor(principal),
        entityType: 'POLICY',
        entityId: policyNumber,
        fromStatus: 'AWAITING_INSURER_CERTIFICATE',
        toStatus: 'ISSUANCE_FAILED',
        note: `The insurer could not issue the policy (${dto.reasonCode}).`,
        correlationId: policyNumber,
      });
      const item = await this.portal.openReconciliationItem(tx, {
        kind: 'ISSUANCE_FAILED',
        paymentId: policy.paymentId,
        policyNumber,
        insurerId,
        amountMinor: policy.amountMinor,
        reason: `${policy.insurerName} could not issue the policy (${dto.reasonCode}): ${message}`,
      });
      if (item) {
        await this.audit.transition(tx, {
          actor: auditActor(principal),
          entityType: 'RECONCILIATION_ITEM',
          entityId: item.id,
          fromStatus: null,
          toStatus: 'OPEN',
          note: 'ISSUANCE_FAILED: a refund is due to the customer.',
          correlationId: policyNumber,
        });
      }
      await this.notifications.notify(tx, {
        customerId: policy.customerId,
        key: 'policy.issuance_failed',
        entity: { type: 'POLICY', id: policyNumber },
        values: { insurer: policy.insurerName, policyNumber, reason: message },
      });
      return { policyNumber, status: toContract.policyStatus('ISSUANCE_FAILED'), issuanceFailedAt: at.toISOString(), reason: message };
    });
  }

  /** The insurer's policy still being issued, locked. Another insurer's answers as absent and is audited. */
  private async issuingPolicy(tx: Transaction, principal: Principal, policyNumber: string, insurerId: string) {
    const policy = await this.portal.lockPolicy(tx, policyNumber, insurerId);
    if (!policy) {
      throw await this.absent(principal, { type: 'POLICY', label: 'Policy' }, policyNumber, await this.portal.policyExists(policyNumber, tx));
    }
    if (policy.status === 'ACTIVE') throw ApiException.conflict('ALREADY_ISSUED', 'This policy has already been issued and is active.');
    if (policy.status !== 'AWAITING_INSURER_CERTIFICATE') throw issuanceClosed();
    return policy;
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

function issuanceClosed() {
  return ApiException.conflict('ISSUANCE_CLOSED', 'This policy could not be issued and is being refunded, so it cannot be issued now.');
}
