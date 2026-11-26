import { defaultRuleValue, isRuleSettingKey, parseRuleValue } from './rules.js';

const reviewPolicy = { submissionDays: 90, editDays: 30, appealDays: 30, appealDecisionDays: 14, privateRetentionDays: 365 };
const fields = ['submissionDays', 'editDays', 'appealDays', 'appealDecisionDays', 'privateRetentionDays'] as const;

describe('REVIEW_POLICY', () => {
  it('registers the governed key and supplies the provisional starting value', () => {
    expect(isRuleSettingKey('REVIEW_POLICY')).toBe(true);
    expect(defaultRuleValue('REVIEW_POLICY')).toEqual(reviewPolicy);
    expect(parseRuleValue('REVIEW_POLICY', reviewPolicy)).toEqual({ value: reviewPolicy });
  });

  it('accepts independently configured calendar-day windows and retention days', () => {
    const value = { submissionDays: 120, editDays: 45, appealDays: 60, appealDecisionDays: 21, privateRetentionDays: 730 };
    expect(parseRuleValue('REVIEW_POLICY', value)).toEqual({ value });
  });

  it.each(fields)('requires %s to be a bounded positive integer', (field) => {
    const maximum = field === 'privateRetentionDays' ? 36_500 : 3_660;
    for (const invalid of [undefined, null, '30', true, 0, -1, 1.5, maximum + 1, Infinity, NaN]) {
      expect(parseRuleValue('REVIEW_POLICY', { ...reviewPolicy, [field]: invalid })).toEqual({
        errors: { [field]: expect.any(String) },
      });
    }
    for (const valid of [1, maximum]) {
      const value = { ...reviewPolicy, [field]: valid };
      expect(parseRuleValue('REVIEW_POLICY', value)).toEqual({ value });
    }
  });

  it.each([null, [], 'policy', {}])('rejects a malformed policy: %j', (value) => {
    expect(parseRuleValue('REVIEW_POLICY', value)).toHaveProperty('errors');
  });
});
