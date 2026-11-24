import { describe, expect, it } from 'vitest';
import { quoteContent, unacceptedCriticalConditions } from './quote-content.js';

const CATALOGUE = [{ code: 'ROADSIDE', label: 'Roadside assistance' }, { code: 'CAR_HIRE', label: 'Car hire' }];

describe('quoteContent', () => {
  it('accepts a breakdown that adds up, known add-ons and conditions', () => {
    const result = quoteContent(
      1_000_000,
      {
        components: [
          { code: 'BASE', label: 'Base premium', amount: 9_500 },
          { code: 'LEVY', label: 'Insurance levy', amount: 500 },
        ],
        excess: 2_500,
        addOns: [
          { code: 'ROADSIDE', price: 0, included: true },
          { code: 'CAR_HIRE', label: 'Car hire, 10 days', price: 450, included: false, terms: ' Up to 10 days. ' },
        ],
        conditions: [{ code: 'TRACKER', text: ' Fit a tracker within 14 days. ', purchaseCritical: true }],
      },
      CATALOGUE,
    );
    expect(result).toEqual({
      value: {
        componentsMinor: [
          { code: 'BASE', label: 'Base premium', amountMinor: 950_000 },
          { code: 'LEVY', label: 'Insurance levy', amountMinor: 50_000 },
        ],
        excessMinor: 250_000,
        addOns: [
          { code: 'ROADSIDE', label: 'Roadside assistance', priceMinor: 0, included: true, terms: null },
          { code: 'CAR_HIRE', label: 'Car hire, 10 days', priceMinor: 45_000, included: false, terms: 'Up to 10 days.' },
        ],
        conditions: [{ code: 'TRACKER', text: 'Fit a tracker within 14 days.', purchaseCritical: true }],
      },
    });
  });

  it('accepts a quote with no content beyond its premium', () => {
    expect(quoteContent(500_00, {}, CATALOGUE)).toEqual({
      value: { componentsMinor: [], excessMinor: null, addOns: [], conditions: [] },
    });
  });

  it.each([
    [{ components: [{ code: 'BASE', label: 'Base', amount: 9_000 }] }, 'components'],
    [{ components: [{ code: 'A', label: 'A', amount: 5_000 }, { code: 'A', label: 'A', amount: 5_000 }] }, 'components'],
    [{ addOns: [{ code: 'JETPACK', price: 1, included: false }] }, 'addOns'],
    [{ addOns: [{ code: 'ROADSIDE', price: 10, included: true }] }, 'addOns'],
    [{ addOns: [{ code: 'ROADSIDE', price: 0, included: true }, { code: 'ROADSIDE', price: 0, included: true }] }, 'addOns'],
    [{ conditions: [{ code: 'X', text: '  ', purchaseCritical: false }] }, 'conditions'],
  ])('refuses %o in %s', (input, field) => {
    const result = quoteContent(1_000_000, input, CATALOGUE);
    expect('errors' in result && result.errors[field]).toBeTruthy();
  });
});

describe('unacceptedCriticalConditions', () => {
  const conditions = [
    { code: 'TRACKER', text: 'Fit a tracker.', purchaseCritical: true },
    { code: 'GARAGE', text: 'Garage at night.', purchaseCritical: false },
  ];
  it('names only the purchase-critical conditions not accepted', () => {
    expect(unacceptedCriticalConditions(conditions, [])).toEqual(['TRACKER']);
    expect(unacceptedCriticalConditions(conditions, ['TRACKER'])).toEqual([]);
  });
});
