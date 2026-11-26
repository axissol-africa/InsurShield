import { acceptsEvidence, isLaterInspection, LATER_INSPECTION_PHOTO_SLOTS, missingReportEvidence } from './later-inspection.js';

describe('later inspection evidence', () => {
  it('keeps earlier inspection kinds outside later evidence rules', () => {
    expect(isLaterInspection('GENERAL')).toBe(false);
    expect(isLaterInspection('UNDERWRITING')).toBe(false);
    expect(isLaterInspection('CLAIM_ASSESSMENT')).toBe(true);
    expect(isLaterInspection('AFTER_PAYMENT')).toBe(true);
  });

  it('requires every named self-capture slot, regardless of the number of attachments', () => {
    const incomplete = [...LATER_INSPECTION_PHOTO_SLOTS.slice(0, -1), 'front'];
    expect(missingReportEvidence('SELF_CAPTURE', 'REQUESTED', incomplete)).toBe('PHOTOS');
    expect(missingReportEvidence('SELF_CAPTURE', 'REQUESTED', LATER_INSPECTION_PHOTO_SLOTS)).toBeNull();
  });

  it('requires a scheduled physical inspection and keeps published outcomes closed to photo changes', () => {
    expect(missingReportEvidence('PHYSICAL', 'REQUESTED', [])).toBe('BOOKING');
    expect(missingReportEvidence('PHYSICAL', 'SCHEDULED', [])).toBeNull();
    expect(missingReportEvidence('PHYSICAL', 'REPORT_READY', [])).toBe('CLOSED');
    expect(acceptsEvidence('APPROVED')).toBe(false);
    expect(acceptsEvidence('FAILED')).toBe(false);
  });
});
