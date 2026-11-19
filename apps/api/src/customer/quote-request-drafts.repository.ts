import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { customerAvailableProductConditions } from '../products/customer-availability.js';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import {
  documents,
  insurerProductVersions,
  insurerProducts,
  insurers,
  quoteRequestDraftDocuments,
  quoteRequestDrafts,
} from '../db/schema.js';
import type { InsuranceType } from '../common/domain/enums.js';

export type QuoteRequestDraftRow = typeof quoteRequestDrafts.$inferSelect;
export type NewQuoteRequestDraft = typeof quoteRequestDrafts.$inferInsert;
export type DraftDocumentRow = typeof quoteRequestDraftDocuments.$inferSelect;

export interface AvailableDraftProductVersion {
  productVersionId: string;
  productId: string;
  allowedDurations: string[];
}

@Injectable()
export class QuoteRequestDraftsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  listOwnedActive(tx: Transaction, customerId: string, now: Date): Promise<QuoteRequestDraftRow[]> {
    return tx
      .select()
      .from(quoteRequestDrafts)
      .where(and(eq(quoteRequestDrafts.customerId, customerId), gt(quoteRequestDrafts.expiresAt, now)))
      .orderBy(desc(quoteRequestDrafts.updatedAt));
  }

  async findOwnedActive(
    tx: Transaction,
    customerId: string,
    id: string,
    now: Date,
  ): Promise<QuoteRequestDraftRow | undefined> {
    const [draft] = await tx
      .select()
      .from(quoteRequestDrafts)
      .where(
        and(
          eq(quoteRequestDrafts.id, id),
          eq(quoteRequestDrafts.customerId, customerId),
          gt(quoteRequestDrafts.expiresAt, now),
        ),
      );
    return draft;
  }

  documentsForDrafts(tx: Transaction, draftIds: string[]): Promise<DraftDocumentRow[]> {
    if (draftIds.length === 0) return Promise.resolve([]);
    return tx
      .select()
      .from(quoteRequestDraftDocuments)
      .where(inArray(quoteRequestDraftDocuments.quoteRequestDraftId, draftIds))
      .orderBy(asc(quoteRequestDraftDocuments.slot));
  }

  async create(tx: Transaction, draft: NewQuoteRequestDraft): Promise<QuoteRequestDraftRow> {
    const [created] = await tx.insert(quoteRequestDrafts).values(draft).returning();
    return created;
  }

  async update(
    tx: Transaction,
    customerId: string,
    id: string,
    now: Date,
    changes: Partial<Pick<NewQuoteRequestDraft, 'commonAnswers' | 'selectedProductVersionIds' | 'configurableAnswers'>>,
  ): Promise<QuoteRequestDraftRow | undefined> {
    const [updated] = await tx
      .update(quoteRequestDrafts)
      .set({ ...changes, updatedAt: new Date() })
      .where(
        and(
          eq(quoteRequestDrafts.id, id),
          eq(quoteRequestDrafts.customerId, customerId),
          gt(quoteRequestDrafts.expiresAt, now),
        ),
      )
      .returning();
    return updated;
  }

  async deleteOwnedActive(tx: Transaction, customerId: string, id: string, now: Date): Promise<QuoteRequestDraftRow | undefined> {
    const [deleted] = await tx
      .delete(quoteRequestDrafts)
      .where(
        and(
          eq(quoteRequestDrafts.id, id),
          eq(quoteRequestDrafts.customerId, customerId),
          gt(quoteRequestDrafts.expiresAt, now),
        ),
      )
      .returning();
    return deleted;
  }

  async replaceDocuments(
    tx: Transaction,
    draftId: string,
    references: Array<{ slot: string; kind: 'WHITE_BOOK' | 'INSPECTION_PHOTO'; documentId: string }>,
  ): Promise<void> {
    await tx.delete(quoteRequestDraftDocuments).where(eq(quoteRequestDraftDocuments.quoteRequestDraftId, draftId));
    if (references.length > 0) {
      await tx.insert(quoteRequestDraftDocuments).values(
        references.map((reference) => ({ quoteRequestDraftId: draftId, ...reference })),
      );
    }
  }

  /** Checks that a customer's uploaded documents remain clean, owned and of the declared kind. */
  async cleanOwnedDocuments(
    tx: Transaction,
    customerId: string,
    documentIds: string[],
  ): Promise<Array<{ id: string; kind: string }>> {
    if (documentIds.length === 0) return [];
    return tx
      .select({ id: documents.id, kind: documents.kind })
      .from(documents)
      .where(
        and(
          inArray(documents.id, documentIds),
          eq(documents.uploadedByCustomerId, customerId),
          eq(documents.scanStatus, 'CLEAN'),
        ),
      )
      .for('share');
  }

  availableProductVersions(
    tx: Transaction,
    productVersionIds: string[],
    now: Date,
    insuranceType?: InsuranceType,
  ): Promise<AvailableDraftProductVersion[]> {
    if (productVersionIds.length === 0) return Promise.resolve([]);
    return tx
      .select({
        productVersionId: insurerProductVersions.id,
        productId: insurerProducts.id,
        allowedDurations: insurerProductVersions.allowedDurations,
      })
      .from(insurerProductVersions)
      .innerJoin(insurerProducts, eq(insurerProducts.id, insurerProductVersions.productId))
      .innerJoin(insurers, eq(insurers.id, insurerProducts.insurerId))
      .where(and(...customerAvailableProductConditions(tx, now, { productVersionIds, coverType: insuranceType })));
  }

  currentProductVersions(
    tx: Transaction,
    productIds: string[],
    now: Date,
    insuranceType?: InsuranceType,
  ): Promise<Array<{ productId: string; productVersionId: string }>> {
    if (productIds.length === 0) return Promise.resolve([]);
    return tx
      .select({ productId: insurerProducts.id, productVersionId: insurerProductVersions.id })
      .from(insurerProductVersions)
      .innerJoin(insurerProducts, eq(insurerProducts.id, insurerProductVersions.productId))
      .innerJoin(insurers, eq(insurers.id, insurerProducts.insurerId))
      .where(and(...customerAvailableProductConditions(tx, now, { productIds, coverType: insuranceType })));
  }

  /** Bounded physical deletion keeps an overdue retention run from holding long locks. */
  async purgeExpired(now: Date, limit: number): Promise<number> {
    const { rowCount } = await this.db.execute(sql`
      DELETE FROM ${quoteRequestDrafts} WHERE ctid IN (
        SELECT ctid FROM ${quoteRequestDrafts}
        WHERE ${quoteRequestDrafts.expiresAt} <= ${now}
        LIMIT ${limit}
      )
    `);
    return rowCount ?? 0;
  }
}
