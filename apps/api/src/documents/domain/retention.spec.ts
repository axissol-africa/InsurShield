import { describe, expect, it } from 'vitest';
import { DOCUMENT_KINDS, DOCUMENT_RETENTION_CLASSES } from '../../common/domain/enums.js';
import { retentionClassOf } from './retention.js';

describe('retentionClassOf', () => {
  it.each([
    ['QUOTATION', 'UNDERWRITING_EVIDENCE'],
    ['WHITE_BOOK', 'UNDERWRITING_EVIDENCE'],
    ['INSPECTION_PHOTO', 'UNDERWRITING_EVIDENCE'],
    ['CERTIFICATE', 'POLICY_EVIDENCE'],
    ['CLAIM_ATTACHMENT', 'CLAIM_EVIDENCE'],
    ['NCD_EVIDENCE', 'CLAIM_EVIDENCE'],
    ['INSURER_LOGO', 'BRAND_ASSET'],
  ] as const)('keeps %s as %s', (kind, expected) => {
    expect(retentionClassOf(kind)).toBe(expected);
  });

  it('classifies every document kind, so a new kind cannot be stored unclassified', () => {
    for (const kind of DOCUMENT_KINDS) {
      expect(DOCUMENT_RETENTION_CLASSES).toContain(retentionClassOf(kind));
    }
  });
});
