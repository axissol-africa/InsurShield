import { eq } from 'drizzle-orm';
import { claimAttachments, inspectionPhotos, inspectionShots, policies } from '../../src/db/schema.js';
import { buildDocument, unique, type Db, type Uploader } from '../builders.js';

/** A photo the customer captured for a quote request, with its document. */
export async function buildInspectionShot(db: Db, input: { quoteRequestId: string; uploader: Uploader }) {
  const document = await buildDocument(db, input.uploader, { kind: 'INSPECTION_PHOTO', mimeType: 'image/jpeg' });
  const [shot] = await db
    .insert(inspectionShots)
    .values({ quoteRequestId: input.quoteRequestId, shotKey: unique('shot'), documentId: document.id })
    .returning();
  return { shot, document };
}

export async function buildClaimAttachment(db: Db, input: { claimNumber: string; uploader: Uploader }) {
  const document = await buildDocument(db, input.uploader, { kind: 'CLAIM_ATTACHMENT' });
  const [attachment] = await db
    .insert(claimAttachments)
    .values({ claimNumber: input.claimNumber, documentId: document.id })
    .returning();
  return { attachment, document };
}

export async function buildInspectionPhoto(db: Db, input: { inspectionId: string; uploader: Uploader }) {
  const document = await buildDocument(db, input.uploader, { kind: 'INSPECTION_PHOTO', mimeType: 'image/jpeg' });
  const [photo] = await db
    .insert(inspectionPhotos)
    .values({ inspectionId: input.inspectionId, slot: unique('slot'), documentId: document.id })
    .returning();
  return { photo, document };
}

/** The insurer's certificate on an issued policy, uploaded by that insurer's staff member. */
export async function buildCertificate(db: Db, input: { policyNumber: string; staffId: string }) {
  const document = await buildDocument(db, { staffId: input.staffId }, { kind: 'CERTIFICATE' });
  await db
    .update(policies)
    .set({ certificateDocumentId: document.id, status: 'ACTIVE', issuedAt: new Date() })
    .where(eq(policies.policyNumber, input.policyNumber));
  return document;
}
