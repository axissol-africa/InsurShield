import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'node:crypto';
import { DocumentsService } from '../documents/documents.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { auditActor, type AuditActor } from '../common/audit/audit.types.js';
import { ApiException } from '../common/errors/api.exception.js';
import { fromContract } from '../common/contract.js';
import { kwachaToNgwee } from '../common/money.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import type { Env } from '../config/env.js';
import type { Transaction } from '../db/database.module.js';
import { newReference } from '../common/domain/reference.js';
import type { CoverageDuration, DocumentKind, InsuranceType } from '../common/domain/enums.js';
import type { CustomerPrincipal } from './customer-principal.js';
import { QuoteWorkflowService } from './quote-workflow.service.js';
import { resumedReplyDueAt } from './domain/quote-workflow.js';
import { QuoteProductsRepository } from './quote-products.repository.js';
import { UnderwritingInspectionsService } from './underwriting-inspections.service.js';
import { unacceptedCriticalConditions } from '../insurer-portal/domain/quote-content.js';
import { addDays, coverPeriod, REQUEST_VALIDITY_DAYS, rtsaAnniversaryStart } from './domain/cover-period.js';
import { ncdCodeRefusal, normaliseNcdCode } from './domain/ncd-code.js';
import {
  CHOOSE_A_COVER_PERIOD,
  CHOOSE_A_COVER_TYPE,
  type AnswerInformationRequestDto,
  type SelectQuoteDto,
  type SubmitQuoteRequestDto,
  type VehicleDetailsDto,
} from './dto/customer.dto.js';
import {
  requirementFromStored,
  requirementSignature,
  validateQuestionAnswer,
  type ProductRequirementDefinition,
} from '../products/domain/product-requirements.js';
import { toQuoteRequestResponse, type QuoteRequestResponse, type QuoteWithDocument } from './dto/quote-request.response.js';
import {
  QuoteRequestsRepository,
  type AvailableProductVersion,
  type NewQuoteRequest,
  type NewProductRequirementAnswer,
  type NewProductRequirementDeclaration,
  type NewProductRequirementDocument,
  type NewShot,
  type NewVehicle,
  type RequestWithParties,
  type VehicleRow,
} from './quote-requests.repository.js';

type ValidatedProductRequirements = {
  answers: NewProductRequirementAnswer[];
  declarations: NewProductRequirementDeclaration[];
  documents: NewProductRequirementDocument[];
};

/**
 * A customer's quote requests.
 *
 * One request, one distribution: each active insurer gets an identical copy at
 * the same moment (DEC-016), which is what makes the comparison fair and is why
 * recipients and photos are written in the same transaction as the request.
 */
@Injectable()
export class QuoteRequestsService {
  private readonly logger = new Logger(QuoteRequestsService.name);

  constructor(
    private readonly repository: QuoteRequestsRepository,
    private readonly documents: DocumentsService,
    private readonly config: ConfigService<Env, true>,
    private readonly audit: AuditService,
    private readonly integrations: IntegrationsService,
    private readonly workflow: QuoteWorkflowService,
    private readonly versions: QuoteProductsRepository,
    private readonly underwriting: UnderwritingInspectionsService,
  ) {}

  async list(customerId: string): Promise<QuoteRequestResponse[]> {
    return this.responses(await this.repository.listForCustomer(customerId));
  }

  async get(customerId: string, id: string): Promise<QuoteRequestResponse> {
    const row = await this.repository.findOwned(customerId, id);
    if (!row) throw ApiException.notFound('Quote request', id);
    const [response] = await this.responses([row]);
    return response;
  }

  async submit(
    customer: CustomerPrincipal,
    dto: SubmitQuoteRequestDto,
    transaction?: Transaction,
  ): Promise<QuoteRequestResponse> {
    const insuranceType = fromContract.insuranceType(dto.insuranceType);
    if (!insuranceType) throw new ApiException('BAD_REQUEST', CHOOSE_A_COVER_TYPE);
    const coverageDuration = fromContract.coverageDuration(dto.coverageDurationId);
    if (!coverageDuration) throw new ApiException('BAD_REQUEST', CHOOSE_A_COVER_PERIOD);
    const shots = dto.inspectionShots ?? [];
    const submittedAt = new Date();
    if (dto.matchRtsaAnniversary && !dto.rtsaRegistrationDate) {
      throw new ApiException('BAD_REQUEST', 'The RTSA registration anniversary is required when policy dates are aligned.');
    }
    const policyStartDate = dto.matchRtsaAnniversary
      ? rtsaAnniversaryStart(dto.rtsaRegistrationDate!, submittedAt).toISOString()
      : dto.policyDates?.startDate;
    const dates = coverPeriod(
      policyStartDate ? { startDate: policyStartDate, endDate: dto.policyDates?.endDate ?? policyStartDate } : undefined,
      coverageDuration,
      submittedAt,
    );

    const create = async (tx: Transaction) => {
      // Batch 12 is a clean cutover for new writes.  A browser that still
      // posts the old, generic request shape must reload rather than create a
      // request that would fan out to insurers the customer never chose.
      if (dto.selectedProductVersionIds === undefined) {
        throw ApiException.conflict(
          'RELOAD_REQUIRED',
          'InsurShield has been updated; reload the page and choose the insurance products you want to compare.',
        );
      }
      const selectedVersions = await this.selectedVersions(
        tx,
        dto.selectedProductVersionIds,
        insuranceType,
        coverageDuration,
        submittedAt,
      );
      const productRequirements = await this.validateProductRequirements(
        tx,
        customer,
        selectedVersions,
        dto,
      );
      // A recipient is a delivery target, not a quote.  Two selected versions
      // from one insurer therefore remain one delivery and two independent
      // replies.
      const insurerIds = [...new Set(selectedVersions.map((version) => version.insurerId))];
      await this.documents.assertAttachable(tx, customer, shots.map((shot) => shot.documentId), 'INSPECTION_PHOTO');
      if (dto.whiteBookDocumentId) {
        await this.documents.assertOwnedOfKind(tx, customer, dto.whiteBookDocumentId, 'WHITE_BOOK');
      }
      const vehicle = await this.createVehicle(tx, dto.vehicleDetails);
      const ncd = await this.usableNcdCode(tx, customer.id, dto.ncdCode);
      return this.distribute(
        tx,
        {
          id: newReference('QR', submittedAt, randomInt),
          model: 'PRODUCT_SELECTION',
          status: 'SUBMITTED',
          submittedAt,
          expiresAt: addDays(submittedAt, REQUEST_VALIDITY_DAYS),
          customerId: customer.id,
          vehicleId: vehicle.id,
          vehicleValueMinor: kwachaToNgwee(dto.vehicleValue),
          vehicleUsage: dto.vehicleUsage,
          insuranceType,
          coverageDuration,
          matchRtsaAnniversary: dto.matchRtsaAnniversary ?? false,
          rtsaRegistrationDate: dto.rtsaRegistrationDate ? new Date(dto.rtsaRegistrationDate) : null,
          policyStartDate: dates.startDate,
          policyEndDate: dates.endDate,
          coverageDays: dates.days,
          whiteBookDocumentId: dto.whiteBookDocumentId ?? null,
          ncdCode: ncd?.code ?? null,
          ncdPercentage: ncd?.percentage ?? null,
          photosCapturedAt: dto.photosCapturedAt ? new Date(dto.photosCapturedAt) : null,
        },
        insurerIds,
        shots,
        auditActor(customer),
        selectedVersions,
        productRequirements,
      );
    };
    const response = transaction ? await create(transaction) : await this.repository.transaction(create);

    this.logger.log(
      `Quote request ${response.id} distributed to ${response.insurerIds.length} insurers with ${shots.length} photos`,
    );
    return response;
  }

  /**
   * A fresh request must be built from today's selected products.  We still
   * lock and own-check the original record so a cross-customer probe cannot
   * learn whether it was ever eligible for a requote.
   */
  async requote(customer: CustomerPrincipal, id: string): Promise<QuoteRequestResponse> {
    return this.repository.transaction(async (tx) => {
      const original = await this.repository.lockOwned(tx, customer.id, id);
      if (!original) throw ApiException.notFound('Quote request', id);

      const [sentAgain] = await this.repository.requoteLinksOf([original.id], tx);
      if (sentAgain) {
        throw ApiException.conflict('ALREADY_REQUOTED', `This request was already sent again as ${sentAgain.id}.`);
      }

      // Historic and selected requests alike return the customer to the
      // current product list.  Version availability, terms and insurer
      // standing must be re-evaluated before a new request is written; a
      // requote must never restore the former broadcast-to-all behaviour.
      throw ApiException.conflict(
        'REQUOTE_REQUIRES_PRODUCT_SELECTION',
        'Choose current insurance products before requesting fresh quotes. Your earlier request remains available in your account.',
      );
    });
  }

  /**
   * The customer answers the insurer's open question about one chosen
   * product. The insurer's reply clock starts again, with the time it spent
   * waiting added to its due date.
   */
  async answerInformationRequest(
    customer: CustomerPrincipal,
    id: string,
    productVersionId: string,
    dto: AnswerInformationRequestDto,
  ): Promise<QuoteRequestResponse> {
    const answer = dto.answer.trim();
    if (!answer) {
      throw new ApiException('VALIDATION_FAILED', 'Write your answer before sending it.', HttpStatus.BAD_REQUEST, {
        answer: 'Empty.',
      });
    }
    return this.repository.transaction(async (tx) => {
      const version = await this.versions.lock(tx, id, productVersionId, { customerId: customer.id });
      if (!version) throw ApiException.notFound('Quote request', id);
      const open = await this.versions.lockOpenInformationRequest(tx, id, productVersionId);
      if (version.status !== 'VERIFICATION_REQUIRED' || !open) throw this.workflow.refusal(version.status, 'CUSTOMER_ANSWERED');

      const at = new Date();
      await this.versions.answerInformationRequest(tx, open.id, answer, at);
      await this.workflow.move(tx, version, 'CUSTOMER_ANSWERED', {
        actor: auditActor(customer),
        note: 'Customer answered the insurer\'s question.',
        at,
        patch: {
          pausedAt: null,
          replyDueAt: version.replyDueAt && version.pausedAt ? resumedReplyDueAt(version.replyDueAt, version.pausedAt, at) : version.replyDueAt,
        },
      });
      const row = await this.repository.findOwned(customer.id, id, tx);
      if (!row) throw ApiException.notFound('Quote request', id);
      const [response] = await this.responses([row], tx);
      return response;
    });
  }

  /**
   * The customer chooses one current quote and accepts its conditions. Every
   * purchase-critical condition must be accepted, and only a quote that can
   * still be paid can be chosen. Choosing again replaces the earlier choice.
   */
  async selectQuote(customer: CustomerPrincipal, id: string, dto: SelectQuoteDto): Promise<QuoteRequestResponse> {
    const accepted = [...new Set(dto.acceptedConditionCodes ?? [])];
    const addOnCodes = [...new Set(dto.addOnCodes ?? [])];
    return this.repository.transaction(async (tx) => {
      const request = await this.repository.lockOwned(tx, customer.id, id);
      if (!request) throw ApiException.notFound('Quote request', id);
      // A payment under way or taken was priced from the current choice, so the choice stays as it is.
      const purchase = await this.repository.lockedPurchase(tx, id);
      if (purchase) {
        throw purchase.status === 'CONFIRMED'
          ? ApiException.conflict('ALREADY_PAID', 'This request is already paid for, so its quote can no longer change.')
          : ApiException.conflict('PAYMENT_IN_PROGRESS', 'A payment for this request is under way. Wait for it to finish or cancel it first.', {
              transactionId: purchase.transactionId,
            });
      }
      const quote = await this.repository.lockSelectableQuote(tx, id, dto.insurerQuoteId);
      if (!quote) throw ApiException.notFound('Quote', dto.insurerQuoteId);
      const now = new Date();
      if (quote.status !== 'ACTIVE' || quote.unpayableAt) {
        throw ApiException.conflict('QUOTE_UNAVAILABLE', 'This quote is no longer available. Reload your quotes.');
      }
      if (quote.validUntil <= now) {
        throw ApiException.conflict('QUOTE_EXPIRED', 'This quote has expired. Request fresh quotes to continue.');
      }
      const unknown = accepted.filter((code) => !quote.conditions.some((condition) => condition.code === code));
      if (unknown.length > 0) {
        throw new ApiException('VALIDATION_FAILED', 'Accept only the conditions this quote lists.', HttpStatus.BAD_REQUEST, {
          acceptedConditionCodes: unknown.join(', '),
        });
      }
      const optional = new Set(quote.addOns.filter((addOn) => !addOn.included).map((addOn) => addOn.code));
      const notOffered = addOnCodes.filter((code) => !optional.has(code));
      if (notOffered.length > 0) {
        throw new ApiException('VALIDATION_FAILED', 'Choose only optional add-ons this quote offers.', HttpStatus.BAD_REQUEST, {
          addOnCodes: notOffered.join(', '),
        });
      }
      const missing = unacceptedCriticalConditions(quote.conditions, accepted);
      if (missing.length > 0) {
        throw ApiException.conflict(
          'CONDITIONS_NOT_ACCEPTED',
          'Accept every condition marked as required before choosing this quote.',
          { missing },
        );
      }
      const previous = await this.repository.previousSelection(tx, id);
      await this.repository.upsertSelection(tx, {
        quoteRequestId: id,
        insurerQuoteId: quote.id,
        customerId: customer.id,
        acceptedConditionCodes: accepted,
        selectedAddOnCodes: addOnCodes,
        selectedAt: now,
      });
      await this.audit.write(tx, {
        actor: auditActor(customer),
        action: 'quote.selected',
        entityType: 'QUOTE_REQUEST',
        entityId: id,
        before: previous ? { insurerQuoteId: previous.insurerQuoteId } : null,
        after: { insurerQuoteId: quote.id, acceptedConditionCodes: accepted, selectedAddOnCodes: addOnCodes },
        note: 'Customer chose a quote.',
        correlationId: id,
      });
      const row = await this.repository.findOwned(customer.id, id, tx);
      if (!row) throw ApiException.notFound('Quote request', id);
      const [response] = await this.responses([row], tx);
      return response;
    });
  }

  /** Writes a request with its recipients and photos in `tx` and reads it back for the response. */
  async distribute(
    tx: Transaction,
    request: NewQuoteRequest,
    insurerIds: string[],
    shots: NewShot[] = [],
    actor: AuditActor,
    selectedVersions: AvailableProductVersion[] = [],
    productRequirements: ValidatedProductRequirements = { answers: [], declarations: [], documents: [] },
  ): Promise<QuoteRequestResponse> {
    const created = await this.repository.insertRequest(tx, request);
    await this.repository.insertRecipients(tx, created.id, insurerIds);
    const replyDueAt = selectedVersions.length > 0 ? await this.workflow.replyDueAt(created.submittedAt, tx) : null;
    const chosen = await this.repository.insertSelectedProductVersions(
      tx,
      created.id,
      // Every product starts waiting for its insurer. An inspection a product's terms ask
      // for is optional and never holds up the quote or the purchase; the live photos are enough.
      selectedVersions.map((version) => ({ ...version, status: 'SUBMITTED' as const, replyDueAt, pausedAt: null })),
    );
    await this.repository.insertProductRequirementAnswers(tx, created.id, productRequirements.answers);
    await this.repository.insertProductRequirementDeclarations(tx, created.id, productRequirements.declarations);
    await this.repository.insertProductRequirementDocuments(tx, created.id, productRequirements.documents);
    await this.repository.insertShots(tx, created.id, shots);
    const row = await this.repository.findOwned(created.customerId, created.id, tx);
    if (!row) throw new Error(`Quote request ${created.id} is missing inside its own transaction`);
    // Products whose terms ask for an inspection get an optional one, one per insurer, for the insurer to use if it wants.
    await this.underwriting.openForRequest(
      tx,
      {
        id: created.id,
        customerId: created.customerId,
        vehiclePlate: row.vehicle.plateNumber,
        vehicleLabel: `${row.vehicle.year} ${row.vehicle.make} ${row.vehicle.model}`.trim(),
        submittedAt: created.submittedAt,
      },
      selectedVersions,
      actor,
    );
    if (selectedVersions.length > 0) {
      await this.queueSelectedProductDeliveries(tx, row, insurerIds, selectedVersions, productRequirements);
    }
    const [response] = await this.responses([row], tx);
    const action = request.requotedFromId
      ? 'quote_request.requoted'
      : request.renewalOfPolicyNumber
        ? 'quote_request.renewed'
        : 'quote_request.submitted';
    await this.audit.write(tx, {
      actor,
      action,
      entityType: 'QUOTE_REQUEST',
      entityId: created.id,
      after: {
        insuranceType: created.insuranceType,
        coverageDuration: created.coverageDuration,
        insurerCount: insurerIds.length,
        selectedProductVersionCount: selectedVersions.length,
        inspectionPhotoCount: shots.length,
        requotedFromId: created.requotedFromId,
        renewalOfPolicyNumber: created.renewalOfPolicyNumber,
      },
      note: request.requotedFromId
        ? `Fresh quote request created from ${request.requotedFromId}.`
        : request.renewalOfPolicyNumber
          ? `Renewal quote request created for ${request.renewalOfPolicyNumber}.`
          : 'Quote request submitted to eligible insurers.',
      correlationId: created.id,
    });
    await this.audit.transition(tx, {
      actor,
      entityType: 'QUOTE_REQUEST',
      entityId: created.id,
      fromStatus: null,
      toStatus: created.status,
      note: 'Quote request submitted.',
      correlationId: created.id,
    });
    for (const version of chosen) {
      await this.audit.transition(tx, {
        actor,
        entityType: 'QUOTE_REQUEST_PRODUCT',
        entityId: version.id,
        fromStatus: null,
        toStatus: version.status,
        note: 'Product chosen.',
        correlationId: created.id,
      });
    }
    return response;
  }

  /** One insurer hand-off can contain several product versions that it owns. */
  private async queueSelectedProductDeliveries(
    tx: Transaction,
    row: RequestWithParties,
    insurerIds: string[],
    selectedVersions: AvailableProductVersion[],
    productRequirements: ValidatedProductRequirements,
  ): Promise<void> {
    // A Drizzle transaction uses one connection. Queue sequentially so each
    // durable delivery and its runner job is ordered on that connection.
    for (const insurerId of insurerIds) {
      await this.integrations.queueInsurerQuoteRequest(tx, {
        insurerId,
        quoteRequestId: row.request.id,
        requestPayload: {
          quoteRequestId: row.request.id,
          customer: {
            fullName: row.customer.fullName,
            email: row.customer.email,
            phone: row.customer.phone,
          },
          vehicle: {
            plateNumber: row.vehicle.plateNumber,
            make: row.vehicle.make,
            model: row.vehicle.model,
            year: row.vehicle.year,
            color: row.vehicle.color,
            chassisNumber: row.vehicle.chassisNumber,
          },
          vehicleValueMinor: row.request.vehicleValueMinor,
          vehicleUsage: row.request.vehicleUsage,
          insuranceType: row.request.insuranceType,
          coverageDuration: row.request.coverageDuration,
          policyDates:
            row.request.policyStartDate && row.request.policyEndDate
              ? {
                  startDate: row.request.policyStartDate.toISOString(),
                  endDate: row.request.policyEndDate.toISOString(),
                  daysTotal: row.request.coverageDays,
                }
              : null,
          selectedProducts: selectedVersions
            .filter((version) => version.insurerId === insurerId)
            .map((version) => ({
              productVersionId: version.productVersionId,
              productCode: version.productCode,
              productVersionNumber: version.productVersionNumber,
              productName: version.productName,
              coverType: version.coverType,
              inspection: {
                rule: version.inspectionRule,
                timing: version.inspectionTiming,
                method: version.inspectionMethod,
              },
            })),
          productRequirements: {
            answers: productRequirements.answers.filter((answer) =>
              selectedVersions.some((version) => version.insurerId === insurerId && version.productVersionId === answer.productVersionId),
            ),
            declarations: productRequirements.declarations.filter((declaration) =>
              selectedVersions.some((version) => version.insurerId === insurerId && version.productVersionId === declaration.productVersionId),
            ),
            documents: productRequirements.documents.filter((document) =>
              selectedVersions.some((version) => version.insurerId === insurerId && version.productVersionId === document.productVersionId),
            ),
          },
        },
      });
    }
  }

  /** Validates the exact versions the customer saw before committing a selected request. */
  private async selectedVersions(
    tx: Transaction,
    selectedIds: string[],
    insuranceType: InsuranceType,
    coverageDuration: CoverageDuration,
    now: Date,
  ): Promise<AvailableProductVersion[]> {
    if (selectedIds.length < 1 || selectedIds.length > 5 || new Set(selectedIds).size !== selectedIds.length) {
      throw new ApiException('INVALID_PRODUCT_SELECTION', 'Choose one to five different insurance products.');
    }
    const selected = await this.repository.selectedAvailableProductVersions(tx, selectedIds, insuranceType, now);
    if (selected.length !== selectedIds.length) {
      throw ApiException.conflict(
        'PRODUCT_VERSION_UNAVAILABLE',
        'One or more selected products are no longer available. Reload the product list and choose again.',
      );
    }
    const unsupported = selected.find((version) => !version.allowedDurations.includes(coverageDuration));
    if (unsupported) {
      throw ApiException.conflict(
        'PRODUCT_DURATION_UNAVAILABLE',
        `${unsupported.productName} is not offered for the selected cover period. Choose another product or cover period.`,
      );
    }

    const current = await this.repository.currentVersionsForProducts(
      tx,
      [...new Set(selected.map((version) => version.productId))],
      insuranceType,
      now,
    );
    const versionsByProduct = new Map<string, number>();
    for (const version of current) {
      versionsByProduct.set(version.productId, (versionsByProduct.get(version.productId) ?? 0) + 1);
    }
    const ambiguous = selected.find((version) => versionsByProduct.get(version.productId) !== 1);
    if (ambiguous) {
      throw ApiException.conflict(
        'PRODUCT_CONFIGURATION_AMBIGUOUS',
        `${ambiguous.productName} has more than one active version. It cannot be selected until the insurer corrects its configuration.`,
      );
    }
    return selected;
  }

  /**
   * Re-validates insurer-configured requirements on the server at the same
   * point as product availability.  A browser can never attach an answer,
   * declaration or document to an unselected product version.
   *
   * When matching requirements are byte-for-byte the same, a client may omit
   * `productVersionId` once and the answer is applied to every matching
   * selected version. This keeps the customer journey concise while the
   * relational records still preserve exactly which insurer terms were met.
   */
  private async validateProductRequirements(
    tx: Transaction,
    customer: CustomerPrincipal,
    selectedVersions: AvailableProductVersion[],
    dto: SubmitQuoteRequestDto,
  ): Promise<ValidatedProductRequirements> {
    const stored = await this.repository.productRequirementsForVersions(
      tx,
      selectedVersions.map((version) => version.productVersionId),
    );
    const requirements = stored.map((row) => {
      const requirement = requirementFromStored(row);
      if (!requirement) {
        throw ApiException.conflict(
          'PRODUCT_REQUIREMENT_CONFIGURATION_INVALID',
          'One selected product has an invalid requirement. Remove it and choose the product again after the insurer corrects it.',
        );
      }
      return requirement;
    });

    const byVersionAndKey = new Map(requirements.map((requirement) => [this.requirementId(requirement), requirement]));
    const answers: NewProductRequirementAnswer[] = [];
    const declarations: NewProductRequirementDeclaration[] = [];
    const documents: NewProductRequirementDocument[] = [];
    const answerIds = new Set<string>();
    const declarationIds = new Set<string>();
    const documentIds = new Set<string>();
    const attachableByKind = new Map<DocumentKind, Set<string>>();
    const errors: Record<string, string> = {};

    const resolve = (
      productVersionId: string | undefined,
      key: string,
      kind: ProductRequirementDefinition['kind'],
      field: string,
    ): ProductRequirementDefinition[] => {
      if (productVersionId) {
        const requirement = byVersionAndKey.get(`${productVersionId}:${key}`);
        if (!requirement || requirement.kind !== kind) {
          errors[field] = 'This item is not required by the selected product. Reload the product list and try again.';
          return [];
        }
        return [requirement];
      }

      const matching = requirements.filter((requirement) => requirement.key === key && requirement.kind === kind);
      if (matching.length === 0) {
        errors[field] = 'This item is not required by the selected products. Reload the product list and try again.';
        return [];
      }
      if (new Set(matching.map(requirementSignature)).size !== 1) {
        errors[field] = 'Choose the product this answer belongs to because the selected products use different terms.';
        return [];
      }
      return matching;
    };

    (dto.productRequirementAnswers ?? []).forEach((input, index) => {
      const field = `productRequirementAnswers.${index}`;
      for (const requirement of resolve(input.productVersionId, input.requirementKey, 'QUESTION', field)) {
        const value = validateQuestionAnswer(requirement, input.value);
        if (value === null) {
          errors[`${field}.value`] = `Enter a valid answer for ${requirement.label}.`;
          continue;
        }
        const id = this.requirementId(requirement);
        if (answerIds.has(id)) {
          errors[field] = 'Provide each product question only once.';
          continue;
        }
        answerIds.add(id);
        answers.push({ productVersionId: requirement.productVersionId, requirementKey: requirement.key, value });
      }
    });

    (dto.productRequirementDeclarations ?? []).forEach((input, index) => {
      const field = `productRequirementDeclarations.${index}`;
      for (const requirement of resolve(input.productVersionId, input.requirementKey, 'DECLARATION', field)) {
        if (!input.accepted) continue;
        const id = this.requirementId(requirement);
        if (declarationIds.has(id)) {
          errors[field] = 'Accept each product declaration only once.';
          continue;
        }
        declarationIds.add(id);
        declarations.push({ productVersionId: requirement.productVersionId, requirementKey: requirement.key });
      }
    });

    (dto.productRequirementDocuments ?? []).forEach((input, index) => {
      const field = `productRequirementDocuments.${index}`;
      for (const requirement of resolve(input.productVersionId, input.requirementKey, 'DOCUMENT', field)) {
        const id = this.requirementId(requirement);
        if (documentIds.has(id)) {
          errors[field] = 'Attach one document for each product requirement.';
          continue;
        }
        documentIds.add(id);
        const documentKind = (requirement.config as { documentKind: DocumentKind }).documentKind;
        const ids = attachableByKind.get(documentKind) ?? new Set<string>();
        ids.add(input.documentId);
        attachableByKind.set(documentKind, ids);
        documents.push({ productVersionId: requirement.productVersionId, requirementKey: requirement.key, documentId: input.documentId });
      }
    });

    for (const requirement of requirements) {
      if (!requirement.required) continue;
      const id = this.requirementId(requirement);
      if (requirement.kind === 'QUESTION' && !answerIds.has(id)) {
        errors[`requirements.${id}`] = `Answer ${requirement.label}.`;
      }
      if (requirement.kind === 'DECLARATION' && !declarationIds.has(id)) {
        errors[`requirements.${id}`] = `Accept ${requirement.label}.`;
      }
      if (requirement.kind === 'DOCUMENT' && !documentIds.has(id)) {
        errors[`requirements.${id}`] = `Attach ${requirement.label}.`;
      }
    }

    if (Object.keys(errors).length) {
      throw new ApiException('PRODUCT_REQUIREMENTS_INCOMPLETE', 'Complete the selected products’ requirements before requesting quotes.', 400, errors);
    }
    for (const [kind, ids] of attachableByKind) {
      await this.documents.assertAttachable(tx, customer, [...ids], kind);
    }
    return { answers, declarations, documents };
  }

  private requirementId(requirement: Pick<ProductRequirementDefinition, 'productVersionId' | 'key'>): string {
    return `${requirement.productVersionId}:${requirement.key}`;
  }

  /**
   * A submission owns an immutable vehicle row. A later customer can submit
   * the same plate with newly confirmed details without rewriting their own
   * earlier request, someone else’s request, or an already-issued policy.
   */
  private async createVehicle(tx: Transaction, details: VehicleDetailsDto): Promise<VehicleRow> {
    const vehicle: NewVehicle = {
      plateNumber: details.plateNumber.trim(),
      make: details.make.trim(),
      model: details.model.trim(),
      year: details.year.trim(),
      color: details.color?.trim() ?? null,
      registrationCountry: details.registrationCountry?.trim() || null,
      chassisNumber: details.chassisNumber?.trim() ?? null,
      engineNumber: details.engineNumber?.trim() ?? null,
      registrationDate: details.registrationDate ? new Date(details.registrationDate) : null,
      rtsaAnniversaryDate: details.rtsaAnniversaryDate ? new Date(details.rtsaAnniversaryDate) : null,
    };
    return this.repository.insertVehicle(tx, vehicle);
  }

  /** The customer's own code behind `ncdCode`, if it is still usable. */
  private async usableNcdCode(tx: Transaction, customerId: string, code: string | undefined) {
    if (!code?.trim()) return null;
    const found = await this.repository.findNcdCodeIssuedTo(tx, normaliseNcdCode(code), customerId);
    if (!found || ncdCodeRefusal(found, new Date())) {
      throw ApiException.conflict(
        'INVALID_NCD_CODE',
        'This No Claim Discount code is not available for this quote request.',
      );
    }
    return { code: found.code, percentage: found.percentage };
  }

  private async responses(rows: RequestWithParties[], tx?: Transaction): Promise<QuoteRequestResponse[]> {
    const currentRtsaAnniversaryFeeMinor = this.config.get('RTSA_ANNIVERSARY_FEE_NGWEE', { infer: true });
    const ids = rows.map((row) => row.request.id);
    const recipients = await this.repository.recipientsOf(ids, tx);
    const quotes = await this.repository.quotesOf(ids, tx);
    const selectedProducts = await this.repository.selectedProductVersionsOf(ids, tx);
    const links = await this.repository.requoteLinksOf(ids, tx);
    const informationRequests = await this.versions.informationRequestsFor(ids, undefined, tx);
    const selections = await this.repository.selectionsOf(ids, tx);
    const purchases = await this.repository.purchasesOf(ids, tx);
    const declineCustomerText = selectedProducts.some((selection) => selection.declineReasonCode)
      ? new Map((await this.workflow.declineReasons(new Date(), tx)).map((reason) => [reason.code, reason.customerText]))
      : new Map<string, string>();

    const responses: QuoteRequestResponse[] = [];
    for (const row of rows) {
      const withDocuments: QuoteWithDocument[] = [];
      for (const quote of quotes.filter((candidate) => candidate.quoteRequestId === row.request.id)) {
        withDocuments.push({ ...quote, document: await this.documents.record(quote.documentId) });
      }
      responses.push(
        toQuoteRequestResponse(
          row,
          recipients.filter((recipient) => recipient.quoteRequestId === row.request.id),
          withDocuments,
          selectedProducts.filter((selection) => selection.quoteRequestId === row.request.id),
          links.find((link) => link.requotedFromId === row.request.id)?.id ?? null,
          currentRtsaAnniversaryFeeMinor,
          informationRequests.filter((asked) => asked.quoteRequestId === row.request.id),
          declineCustomerText,
          selections.find((selected) => selected.quoteRequestId === row.request.id) ?? null,
          purchases.find((purchase) => purchase.quoteRequestId === row.request.id) ?? null,
        ),
      );
    }
    return responses;
  }
}
