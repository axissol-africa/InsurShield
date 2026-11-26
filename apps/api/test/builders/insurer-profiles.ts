import { randomUUID } from 'node:crypto';
import { insurerEvidence, insurerProducts, insurerProductVersions } from '../../src/db/schema.js';
import { buildDocument, type Db, type BuiltInsurer } from '../builders.js';

export async function buildInsurerProfileProducts(db: Db, built: BuiltInsurer) {
  const document = await buildDocument(db, { staffId: built.staff.id }, { kind: 'INSURER_EVIDENCE' });
  await db.insert(insurerEvidence).values({ insurerId: built.insurer.id, kind: 'LICENCE', documentId: document.id, state: 'APPROVED', reference: 'Profile licence' });
  const [product] = await db.insert(insurerProducts).values({ insurerId: built.insurer.id, code: randomUUID(), coverType: 'COMPREHENSIVE' }).returning();
  const common = { productId: product.id, coverType: 'COMPREHENSIVE' as const, coverGuide: {}, inspectionRule: 'NOT_REQUIRED' as const, rateBps: 525, effectiveFrom: new Date('2020-01-01'), createdByStaffId: built.staff.id };
  const [approved] = await db.insert(insurerProductVersions).values({ ...common, versionNumber: 1, status: 'APPROVED', name: 'Published product' }).returning();
  await db.insert(insurerProductVersions).values({ ...common, versionNumber: 2, status: 'SUBMITTED', name: 'Private product replacement' });
  return { product, approved };
}
