import { describe, expect, it } from 'vitest';
import { defaultRuleValue, parseRuleValue } from './rules.js';

describe('Batch 13 quote-workflow rules', () => {
  it('ships independent, usable defaults for decline reasons, SLA warnings, and evidence slots', () => {
    const reasons = defaultRuleValue('QUOTE_DECLINE_REASONS');
    const warning = defaultRuleValue('QUOTE_SLA_WARNING');
    const slots = defaultRuleValue('INSPECTION_EVIDENCE_SLOTS');

    expect(reasons.reasons.map((reason) => reason.code)).toEqual([
      'UNDERWRITING_DECLINED',
      'INFORMATION_NOT_PROVIDED',
      'INSPECTION_FAILED',
    ]);
    expect(warning).toEqual({ hoursBeforeDue: 24 });
    expect(slots.slots.map((slot) => slot.code)).toEqual([
      'FRONT',
      'REAR',
      'LEFT',
      'RIGHT',
      'DASHBOARD_OR_MILEAGE',
      'ENGINE_BAY',
    ]);

    expect(defaultRuleValue('QUOTE_DECLINE_REASONS')).not.toBe(reasons);
    expect(defaultRuleValue('QUOTE_DECLINE_REASONS').reasons).not.toBe(reasons.reasons);
  });

  it('refuses duplicate customer-facing decline and evidence codes', () => {
    const declined = parseRuleValue('QUOTE_DECLINE_REASONS', {
      reasons: [
        { code: 'NOT_ELIGIBLE', customerText: 'Not eligible.', internalText: 'Underwriting did not accept it.' },
        { code: 'NOT_ELIGIBLE', customerText: 'Still not eligible.', internalText: 'Duplicate configuration.' },
      ],
    });
    const slots = parseRuleValue('INSPECTION_EVIDENCE_SLOTS', {
      slots: [
        { code: 'FRONT', label: 'Front view' },
        { code: 'FRONT', label: 'Another front view' },
      ],
    });

    expect('errors' in declined && declined.errors.reasons).toContain('different code');
    expect('errors' in slots && slots.errors.slots).toContain('different code');
  });

  it('accepts bounded workflow configuration and rejects an unsafe warning window', () => {
    expect(parseRuleValue('QUOTE_SLA_WARNING', { hoursBeforeDue: 72 })).toEqual({ value: { hoursBeforeDue: 72 } });
    const invalid = parseRuleValue('QUOTE_SLA_WARNING', { hoursBeforeDue: 0 });
    expect('errors' in invalid && invalid.errors.hoursBeforeDue).toBeTruthy();
  });
});
