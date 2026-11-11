import type { DocumentKind, DocumentRetentionClass } from '../../common/domain/enums.js';

/**
 * The retention class a document kind belongs to, decided once at upload and
 * stored on the row. Keeping the class rather than deriving it on read means a
 * later change here cannot silently reclassify documents already held.
 *
 * The durations each class implies are settings owned by the rule-settings
 * work, and the deletion that acts on them belongs to the data-lifecycle work.
 */
const CLASS_OF_KIND: Record<DocumentKind, DocumentRetentionClass> = {
  QUOTATION: 'UNDERWRITING_EVIDENCE',
  WHITE_BOOK: 'UNDERWRITING_EVIDENCE',
  INSPECTION_PHOTO: 'UNDERWRITING_EVIDENCE',
  CERTIFICATE: 'POLICY_EVIDENCE',
  CLAIM_ATTACHMENT: 'CLAIM_EVIDENCE',
  NCD_EVIDENCE: 'CLAIM_EVIDENCE',
  INSURER_LOGO: 'BRAND_ASSET',
  // An insurer's licence is evidence about the insurer, not about a customer's
  // risk, policy or claim, and it is kept for as long as regulators ask rather
  // than for as long as a quotation. The class is stored at upload, so putting
  // it in an existing class now could not be corrected later.
  INSURER_EVIDENCE: 'COMPLIANCE_EVIDENCE',
};

export function retentionClassOf(kind: DocumentKind): DocumentRetentionClass {
  return CLASS_OF_KIND[kind];
}
