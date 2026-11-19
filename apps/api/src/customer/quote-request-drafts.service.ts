import { Injectable } from '@nestjs/common';
import { fromContract } from '../common/contract.js';
import { AuditService } from '../common/audit/audit.service.js';
import { auditActor } from '../common/audit/audit.types.js';
import { ApiException } from '../common/errors/api.exception.js';
import type { CoverageDuration, InsuranceType } from '../common/domain/enums.js';
import { DocumentsService } from '../documents/documents.service.js';
import type { CustomerPrincipal } from './customer-principal.js';
import {
  CreateQuoteRequestDraftDto,
  type QuoteRequestDraftDocumentDto,
  UpdateQuoteRequestDraftDto,
} from './dto/quote-request-draft.dto.js';
import type { QuoteRequestDraftResponse } from './dto/quote-request-draft.response.js';
import {
  QuoteRequestDraftsRepository,
  type DraftDocumentRow,
  type QuoteRequestDraftRow,
} from './quote-request-drafts.repository.js';

export const QUOTE_REQUEST_DRAFT_RETENTION_MS = 30 * 24 * 60 * 60_000;

type UnavailableProduct = QuoteRequestDraftResponse['unavailableProducts'][number];

@Injectable()
export class QuoteRequestDraftsService {
  constructor(
    private readonly repository: QuoteRequestDraftsRepository,
    private readonly documents: DocumentsService,
    private readonly audit: AuditService,
  ) {}

  async list(customer: CustomerPrincipal): Promise<QuoteRequestDraftResponse[]> {
    const now = new Date();
    return this.repository.transaction(async (tx) => {
      const drafts = await this.repository.listOwnedActive(tx, customer.id, now);
      return this.responses(tx, drafts);
    });
  }

  async get(customer: CustomerPrincipal, id: string): Promise<QuoteRequestDraftResponse> {
    const now = new Date();
    return this.repository.transaction(async (tx) => {
      const draft = await this.findOwnedActive(tx, customer.id, id, now);
      const [response] = await this.responses(tx, [draft]);
      return response;
    });
  }

  async create(customer: CustomerPrincipal, dto: CreateQuoteRequestDraftDto): Promise<QuoteRequestDraftResponse> {
    const now = new Date();
    return this.repository.transaction(async (tx) => {
      const references = dto.documentReferences ?? [];
      await this.assertDocumentReferences(tx, customer, references);
      const draft = await this.repository.create(tx, {
        customerId: customer.id,
        commonAnswers: dto.commonAnswers,
        selectedProductVersionIds: dto.selectedProductVersionIds ?? [],
        configurableAnswers: dto.configurableAnswers ?? {},
        expiresAt: new Date(now.getTime() + QUOTE_REQUEST_DRAFT_RETENTION_MS),
      });
      await this.repository.replaceDocuments(tx, draft.id, references);
      await this.audit.write(tx, {
        actor: auditActor(customer),
        action: 'quote_request_draft.created',
        entityType: 'QUOTE_REQUEST_DRAFT',
        entityId: draft.id,
        after: this.auditSummary(draft.selectedProductVersionIds.length, references.length),
        note: 'Customer saved an unfinished quote request.',
        correlationId: draft.id,
      });
      const [response] = await this.responses(tx, [draft]);
      return response;
    });
  }

  async update(customer: CustomerPrincipal, id: string, dto: UpdateQuoteRequestDraftDto): Promise<QuoteRequestDraftResponse> {
    if (!this.hasChanges(dto)) {
      throw new ApiException('BAD_REQUEST', 'Provide at least one draft value to update.');
    }
    const now = new Date();
    return this.repository.transaction(async (tx) => {
      const before = await this.findOwnedActive(tx, customer.id, id, now);
      const beforeDocuments = await this.repository.documentsForDrafts(tx, [before.id]);
      const references = dto.documentReferences;
      if (references !== undefined) await this.assertDocumentReferences(tx, customer, references);
      const draft = await this.repository.update(tx, customer.id, id, now, {
        ...(dto.commonAnswers === undefined ? {} : { commonAnswers: dto.commonAnswers }),
        ...(dto.selectedProductVersionIds === undefined ? {} : { selectedProductVersionIds: dto.selectedProductVersionIds }),
        ...(dto.configurableAnswers === undefined ? {} : { configurableAnswers: dto.configurableAnswers }),
      });
      if (!draft) throw ApiException.notFound('Quote request draft', id);
      if (references !== undefined) await this.repository.replaceDocuments(tx, draft.id, references);
      await this.audit.write(tx, {
        actor: auditActor(customer),
        action: 'quote_request_draft.updated',
        entityType: 'QUOTE_REQUEST_DRAFT',
        entityId: draft.id,
        before: this.auditSummary(before.selectedProductVersionIds.length, beforeDocuments.length),
        after: this.auditSummary(
          draft.selectedProductVersionIds.length,
          references?.length ?? beforeDocuments.length,
        ),
        note: 'Customer updated an unfinished quote request.',
        correlationId: draft.id,
      });
      const [response] = await this.responses(tx, [draft]);
      return response;
    });
  }

  async remove(customer: CustomerPrincipal, id: string): Promise<void> {
    const now = new Date();
    await this.repository.transaction(async (tx) => {
      const draft = await this.repository.deleteOwnedActive(tx, customer.id, id, now);
      if (!draft) throw ApiException.notFound('Quote request draft', id);
      await this.audit.write(tx, {
        actor: auditActor(customer),
        action: 'quote_request_draft.deleted',
        entityType: 'QUOTE_REQUEST_DRAFT',
        entityId: draft.id,
        before: this.auditSummary(draft.selectedProductVersionIds.length, 0),
        note: 'Customer discarded an unfinished quote request.',
        correlationId: draft.id,
      });
    });
  }

  private async findOwnedActive(tx: Parameters<QuoteRequestDraftsRepository['findOwnedActive']>[0], customerId: string, id: string, now: Date) {
    const draft = await this.repository.findOwnedActive(tx, customerId, id, now);
    if (!draft) throw ApiException.notFound('Quote request draft', id);
    return draft;
  }

  private async assertDocumentReferences(
    tx: Parameters<DocumentsService['assertOwnedOfKind']>[0],
    customer: CustomerPrincipal,
    references: QuoteRequestDraftDocumentDto[],
  ): Promise<void> {
    for (const reference of references) {
      await this.documents.assertOwnedOfKind(tx, customer, reference.documentId, reference.kind);
    }
    const clean = await this.repository.cleanOwnedDocuments(
      tx,
      customer.id,
      references.map((reference) => reference.documentId),
    );
    const actual = new Map(clean.map((document) => [document.id, document.kind]));
    if (references.some((reference) => actual.get(reference.documentId) !== reference.kind)) {
      throw ApiException.conflict(
        'DOCUMENT_NOT_ATTACHABLE',
        'That document cannot be attached here. Upload a clean file in the required document category.',
      );
    }
  }

  private async responses(
    tx: Parameters<QuoteRequestDraftsRepository['documentsForDrafts']>[0],
    drafts: QuoteRequestDraftRow[],
  ): Promise<QuoteRequestDraftResponse[]> {
    const documents = await this.repository.documentsForDrafts(tx, drafts.map((draft) => draft.id));
    const now = new Date();
    const responses: QuoteRequestDraftResponse[] = [];
    for (const draft of drafts) responses.push(await this.toResponse(tx, draft, documents, now));
    return responses;
  }

  private async toResponse(
    tx: Parameters<QuoteRequestDraftsRepository['availableProductVersions']>[0],
    draft: QuoteRequestDraftRow,
    documents: DraftDocumentRow[],
    now: Date,
  ): Promise<QuoteRequestDraftResponse> {
    const unavailableProducts = await this.unavailableProducts(tx, draft, now);
    return {
      id: draft.id,
      commonAnswers: draft.commonAnswers,
      selectedProductVersionIds: draft.selectedProductVersionIds,
      configurableAnswers: draft.configurableAnswers,
      documentReferences: documents
        .filter((document) => document.quoteRequestDraftId === draft.id)
        .map((document) => ({
          slot: document.slot,
          kind: document.kind as 'WHITE_BOOK' | 'INSPECTION_PHOTO',
          documentId: document.documentId,
        })),
      unavailableProducts,
      expiresAt: draft.expiresAt.toISOString(),
      createdAt: draft.createdAt.toISOString(),
      updatedAt: draft.updatedAt.toISOString(),
    };
  }

  private async unavailableProducts(
    tx: Parameters<QuoteRequestDraftsRepository['availableProductVersions']>[0],
    draft: QuoteRequestDraftRow,
    now: Date,
  ): Promise<UnavailableProduct[]> {
    const selected = draft.selectedProductVersionIds;
    if (selected.length === 0) return [];
    const insuranceType = this.insuranceTypeOf(draft.commonAnswers);
    const coverageDuration = this.coverageDurationOf(draft.commonAnswers);
    const available = await this.repository.availableProductVersions(tx, selected, now, insuranceType);
    const availableById = new Map(available.map((version) => [version.productVersionId, version]));
    const current = await this.repository.currentProductVersions(
      tx,
      [...new Set(available.map((version) => version.productId))],
      now,
      insuranceType,
    );
    const versionsPerProduct = new Map<string, number>();
    for (const version of current) {
      versionsPerProduct.set(version.productId, (versionsPerProduct.get(version.productId) ?? 0) + 1);
    }

    const unavailable: UnavailableProduct[] = [];
    for (const productVersionId of selected) {
      const version = availableById.get(productVersionId);
      if (!version) {
        unavailable.push({
          productVersionId,
          code: 'PRODUCT_VERSION_UNAVAILABLE',
          message: 'This product is no longer available. Choose a current product before submitting.',
        });
      } else if (coverageDuration && !version.allowedDurations.includes(coverageDuration)) {
        unavailable.push({
          productVersionId,
          code: 'PRODUCT_DURATION_UNAVAILABLE',
          message: 'This product is not offered for the selected cover period. Choose another product or cover period.',
        });
      } else if (versionsPerProduct.get(version.productId) !== 1) {
        unavailable.push({
          productVersionId,
          code: 'PRODUCT_CONFIGURATION_AMBIGUOUS',
          message: 'This product is temporarily unavailable while its insurer corrects its configuration.',
        });
      }
    }
    return unavailable;
  }

  private insuranceTypeOf(answers: Record<string, unknown>): InsuranceType | undefined {
    return typeof answers.insuranceType === 'string' ? fromContract.insuranceType(answers.insuranceType) : undefined;
  }

  private coverageDurationOf(answers: Record<string, unknown>): CoverageDuration | undefined {
    return typeof answers.coverageDurationId === 'string'
      ? fromContract.coverageDuration(answers.coverageDurationId)
      : undefined;
  }

  private hasChanges(dto: UpdateQuoteRequestDraftDto): boolean {
    return dto.commonAnswers !== undefined || dto.selectedProductVersionIds !== undefined ||
      dto.configurableAnswers !== undefined || dto.documentReferences !== undefined;
  }

  private auditSummary(selectedProductCount: number, documentCount: number): Record<string, number> {
    return { selectedProductCount, documentCount };
  }
}
