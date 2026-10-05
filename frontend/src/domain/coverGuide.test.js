import { describe, expect, it } from 'vitest';
import {
  COVER_GUIDE_SECTIONS, blankCoverGuide, cleanCoverGuide, coverGuideCompleteness,
  benefitKey, fieldsFor, isCoverGuideComplete, splitBenefit, validateCoverGuide,
} from './coverGuide';

/** A guide that passes, so each test can spoil exactly one thing. */
const complete = (coverType = 'Comprehensive') => ({
  ...blankCoverGuide(coverType),
  planName: 'Comprehensive Gold',
  summary: 'Full cover for your vehicle and for damage you cause to others.',
  coveredItems: ['Own damage, to market value', 'Theft and fire'],
  exclusions: ['Driving without a valid licence', 'Racing or track use'],
  notifyWithinDays: '7',
  howToNotify: 'Call the claims line, then submit the claim form within 48 hours.',
  documentsRequired: ['Police report', 'Driving licence'],
  claimsContact: '+260 211 255 100',
  settlementTime: '14 working days from complete documents',
  territorialLimit: 'Zambia',
  quoteValidityDays: '7',
});

describe('the schema', () => {
  it('asks every insurer the same questions in the same order', () => {
    expect(COVER_GUIDE_SECTIONS.map((section) => section.id)).toEqual([
      'plan', 'covered', 'excluded', 'claims', 'conditions', 'validity',
    ]);
  });

  it('names each field once across the whole schema', () => {
    const keys = COVER_GUIDE_SECTIONS.flatMap((section) => section.fields.map((field) => field.key));
    expect(new Set(keys).size).toBe(keys.length);
  });

  // Both cover types answer the same questions; what differs is the answers,
  // above all what each one lists as covered.
  it('asks comprehensive and third party the same questions', () => {
    expect(fieldsFor()).toHaveLength(12);
  });

  // Nothing here asks for an amount: an insurer that wants to state a limit
  // writes it into the benefit line, the way the catalogue already reads.
  it('asks for no amounts', () => {
    expect(fieldsFor().filter((field) => field.kind === 'money')).toEqual([]);
  });

  // Whether a vehicle is inspected is settled during the quote request; asking
  // again here let an insurer contradict it.
  it('does not ask again about things the quote journey decides', () => {
    const keys = fieldsFor().map((field) => field.key);
    expect(keys).not.toContain('inspectionRequired');
    expect(keys).not.toContain('whoMayDrive');
  });

  it('keeps every question required bar the optional discount flag', () => {
    const optional = fieldsFor().filter((field) => !field.required && field.kind !== 'boolean');
    expect(optional).toEqual([]);
  });
});

describe('a blank guide', () => {
  it('has every applicable field, empty', () => {
    const blank = blankCoverGuide('Comprehensive');
    for (const field of fieldsFor('Comprehensive')) expect(blank).toHaveProperty(field.key);
    expect(blank.coveredItems).toEqual([]);
    expect(blank.ncdAccepted).toBe(false);
  });

  it('cannot be published', () => {
    expect(isCoverGuideComplete(blankCoverGuide('Comprehensive'))).toBe(false);
  });
});

describe('validating a guide', () => {
  it('passes a complete one', () => {
    expect(validateCoverGuide(complete())).toEqual({ valid: true, errors: {} });
  });

  it('names the field that is missing', () => {
    const { valid, errors } = validateCoverGuide({ ...complete(), claimsContact: '   ' });
    expect(valid).toBe(false);
    expect(errors.claimsContact).toContain('Claims contact');
  });

  it('wants at least one benefit and one exclusion', () => {
    expect(validateCoverGuide({ ...complete(), coveredItems: [] }).errors.coveredItems).toBeTruthy();
    expect(validateCoverGuide({ ...complete(), exclusions: [] }).errors.exclusions).toBeTruthy();
  });

  it('refuses a notification deadline outside a sane range', () => {
    expect(validateCoverGuide({ ...complete(), notifyWithinDays: '0' }).errors.notifyWithinDays).toBeTruthy();
    expect(validateCoverGuide({ ...complete(), notifyWithinDays: '400' }).errors.notifyWithinDays).toBeTruthy();
    expect(validateCoverGuide({ ...complete(), notifyWithinDays: '2.5' }).errors.notifyWithinDays).toBeTruthy();
  });

  it('refuses a summary longer than the form allows', () => {
    expect(validateCoverGuide({ ...complete(), summary: 'x'.repeat(241) }).errors.summary).toBeTruthy();
  });

  it('passes a third party guide, which answers the same questions', () => {
    expect(validateCoverGuide(complete('ThirdParty')).valid).toBe(true);
  });
});

describe('completeness', () => {
  it('is nothing on a blank guide and everything on a finished one', () => {
    expect(coverGuideCompleteness(blankCoverGuide('Comprehensive')).percent).toBe(0);
    expect(coverGuideCompleteness(complete()).percent).toBe(100);
  });

  it('counts up as fields are answered', () => {
    const half = { ...blankCoverGuide('Comprehensive'), planName: 'Gold', summary: 'Cover.' };
    const progress = coverGuideCompleteness(half);
    expect(progress.done).toBe(2);
    expect(progress.percent).toBeGreaterThan(0);
    expect(progress.percent).toBeLessThan(100);
  });

  it('ignores the discount flag, which is answered either way', () => {
    expect(coverGuideCompleteness(complete()).total).toBe(fieldsFor().length - 1);
  });
});

describe('cleaning a guide before it is stored', () => {
  it('drops blank rows and tidies whitespace', () => {
    const messy = {
      ...complete(),
      planName: '  Comprehensive Gold  ',
      exclusions: ['Racing', '   ', ''],
      coveredItems: [' Own damage ', '   ', ''],
    };
    const cleaned = cleanCoverGuide(messy, 'Comprehensive');
    expect(cleaned.planName).toBe('Comprehensive Gold');
    expect(cleaned.exclusions).toEqual(['Racing']);
    expect(cleaned.coveredItems).toEqual(['Own damage']);
  });

  it('keeps only the fields that belong to the cover type', () => {
    const cleaned = cleanCoverGuide({ ...complete(), windscreenLimit: '7500' }, 'ThirdParty');
    expect(cleaned).not.toHaveProperty('windscreenLimit');
    expect(cleaned.coverType).toBe('ThirdParty');
  });
});

describe('guides published before benefits became plain lines', () => {
  it('reads an older benefit-and-limit pair as one line', () => {
    const older = { ...complete(), coveredItems: [{ item: 'Own damage', limit: 'Market value' }] };
    expect(validateCoverGuide(older).valid).toBe(true);
    expect(cleanCoverGuide(older, 'Comprehensive').coveredItems).toEqual(['Own damage — Market value']);
  });

  it('keeps a benefit that never had a limit against it', () => {
    const older = { ...complete(), coveredItems: [{ item: 'Own damage', limit: '' }] };
    expect(cleanCoverGuide(older, 'Comprehensive').coveredItems).toEqual(['Own damage']);
  });
});

describe('comparing benefits across insurers', () => {
  it('reads a benefit and its ceiling apart', () => {
    expect(splitBenefit('Medical Expenses up to ZMW 50,000')).toEqual({ name: 'Medical Expenses', detail: 'up to ZMW 50,000' });
    expect(splitBenefit('Own damage — Market value')).toEqual({ name: 'Own damage', detail: 'Market value' });
    expect(splitBenefit('Theft and fire')).toEqual({ name: 'Theft and fire', detail: '' });
  });

  // The whole point: two insurers offering the same benefit at different
  // ceilings belong on one row, not two.
  it('puts the same benefit at different ceilings on one row', () => {
    expect(benefitKey('Medical Expenses up to ZMW 50,000')).toBe(benefitKey('Medical Expenses up to ZMW 30,000'));
    expect(benefitKey('Theft & Fire Coverage')).toBe(benefitKey('Theft and Fire Coverage'));
  });

  it('keeps genuinely different benefits apart', () => {
    expect(benefitKey('Own Damage')).not.toBe(benefitKey('Windscreen Replacement'));
  });

  it('survives a blank line', () => {
    expect(splitBenefit('')).toEqual({ name: '', detail: '' });
    expect(benefitKey(undefined)).toBe('');
  });
});
