import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, exists, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import type { Principal } from '../common/auth/auth.types.js';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import {
  claimAttachments,
  claimNotifications,
  documents,
  inspectionPhotos,
  inspections,
  inspectionShots,
  insurerQuotes,
  policies,
  quoteRequestRecipients,
  quoteRequests,
} from '../db/schema.js';

export type NewDocument = typeof documents.$inferInsert;
export type DocumentRow = typeof documents.$inferSelect;

const ONE = { one: sql`1` };

@Injectable()
export class DocumentsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async insert(document: NewDocument): Promise<DocumentRow> {
    const [created] = await this.db.insert(documents).values(document).returning();
    return created;
  }

  async find(documentId: string): Promise<DocumentRow | undefined> {
    const [document] = await this.db.select().from(documents).where(eq(documents.id, documentId));
    return document;
  }

  async findVisibleTo(principal: Principal, documentId: string): Promise<DocumentRow | undefined> {
    const [document] = await this.db
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId), this.visibleTo(principal)));
    return document;
  }

  /** Locks in id order, so two requests naming the same documents cannot deadlock. */
  async lockForAttach(tx: Transaction, documentIds: string[]) {
    return await tx
      .select({
        id: documents.id,
        kind: documents.kind,
        uploadedByCustomerId: documents.uploadedByCustomerId,
        uploadedByStaffId: documents.uploadedByStaffId,
      })
      .from(documents)
      .where(inArray(documents.id, documentIds))
      .orderBy(asc(documents.id))
      .for('update');
  }

  async referencedIds(tx: Transaction, documentIds: string[]): Promise<Set<string>> {
    const rows = await tx
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          inArray(documents.id, documentIds),
          or(
            exists(tx.select(ONE).from(insurerQuotes).where(eq(insurerQuotes.documentId, documents.id))),
            exists(
              tx
                .select(ONE)
                .from(policies)
                .where(
                  or(
                    eq(policies.quoteDocumentId, documents.id),
                    eq(policies.certificateDocumentId, documents.id),
                  ),
                ),
            ),
            exists(tx.select(ONE).from(inspectionShots).where(eq(inspectionShots.documentId, documents.id))),
            exists(tx.select(ONE).from(inspectionPhotos).where(eq(inspectionPhotos.documentId, documents.id))),
            exists(tx.select(ONE).from(claimAttachments).where(eq(claimAttachments.documentId, documents.id))),
          ),
        ),
      );
    return new Set(rows.map((row) => row.id));
  }

  private visibleTo(principal: Principal): SQL | undefined {
    if (principal.kind === 'staff' && (principal.role === 'SUPER_ADMIN' || principal.role === 'ADMIN')) {
      return undefined;
    }

    // A customer can upload any kind, so only a logo staff uploaded is public.
    const always = [and(eq(documents.kind, 'INSURER_LOGO'), isNotNull(documents.uploadedByStaffId))];
    if (principal.kind === 'customer') {
      return or(...always, eq(documents.uploadedByCustomerId, principal.id), ...this.ownedByCustomer(principal.id));
    }
    const uploaded = eq(documents.uploadedByStaffId, principal.id);
    if (!principal.insurerId) return or(...always, uploaded);
    return or(...always, uploaded, ...this.sentToInsurer(principal.insurerId));
  }

  private ownedByCustomer(customerId: string): SQL[] {
    const db = this.db;
    return [
      exists(
        db
          .select(ONE)
          .from(insurerQuotes)
          .innerJoin(quoteRequests, eq(quoteRequests.id, insurerQuotes.quoteRequestId))
          .where(and(eq(insurerQuotes.documentId, documents.id), eq(quoteRequests.customerId, customerId))),
      ),
      exists(
        db
          .select(ONE)
          .from(policies)
          .where(and(this.policyDocument(), eq(policies.customerId, customerId))),
      ),
      exists(
        db
          .select(ONE)
          .from(inspectionShots)
          .innerJoin(quoteRequests, eq(quoteRequests.id, inspectionShots.quoteRequestId))
          .where(and(eq(inspectionShots.documentId, documents.id), eq(quoteRequests.customerId, customerId))),
      ),
      exists(
        db
          .select(ONE)
          .from(claimAttachments)
          .innerJoin(claimNotifications, eq(claimNotifications.claimNumber, claimAttachments.claimNumber))
          .where(
            and(eq(claimAttachments.documentId, documents.id), eq(claimNotifications.customerId, customerId)),
          ),
      ),
      exists(
        db
          .select(ONE)
          .from(inspectionPhotos)
          .innerJoin(inspections, eq(inspections.id, inspectionPhotos.inspectionId))
          .where(and(eq(inspectionPhotos.documentId, documents.id), eq(inspections.customerId, customerId))),
      ),
    ];
  }

  private sentToInsurer(insurerId: string): SQL[] {
    const db = this.db;
    return [
      exists(
        db
          .select(ONE)
          .from(insurerQuotes)
          .where(and(eq(insurerQuotes.documentId, documents.id), eq(insurerQuotes.insurerId, insurerId))),
      ),
      exists(
        db
          .select(ONE)
          .from(policies)
          .where(and(this.policyDocument(), eq(policies.insurerId, insurerId))),
      ),
      exists(
        db
          .select(ONE)
          .from(inspectionShots)
          .innerJoin(
            quoteRequestRecipients,
            eq(quoteRequestRecipients.quoteRequestId, inspectionShots.quoteRequestId),
          )
          .where(
            and(eq(inspectionShots.documentId, documents.id), eq(quoteRequestRecipients.insurerId, insurerId)),
          ),
      ),
      exists(
        db
          .select(ONE)
          .from(claimAttachments)
          .innerJoin(claimNotifications, eq(claimNotifications.claimNumber, claimAttachments.claimNumber))
          .where(
            and(eq(claimAttachments.documentId, documents.id), eq(claimNotifications.insurerId, insurerId)),
          ),
      ),
      exists(
        db
          .select(ONE)
          .from(inspectionPhotos)
          .innerJoin(inspections, eq(inspections.id, inspectionPhotos.inspectionId))
          .where(and(eq(inspectionPhotos.documentId, documents.id), eq(inspections.insurerId, insurerId))),
      ),
    ];
  }

  private policyDocument(): SQL | undefined {
    return or(eq(policies.quoteDocumentId, documents.id), eq(policies.certificateDocumentId, documents.id));
  }
}
