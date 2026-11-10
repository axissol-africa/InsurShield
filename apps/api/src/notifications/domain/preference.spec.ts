import { maySend, overriddenBy, type Preference } from './preference.js';

const marketing = { category: 'MARKETING', channel: 'EMAIL', mandatory: false } as const;
const payment = { category: 'PAYMENT', channel: 'EMAIL', mandatory: true } as const;
const off = (category: Preference['category'], channel: Preference['channel'] = 'EMAIL'): Preference => ({
  category,
  channel,
  enabled: false,
});

describe('maySend', () => {
  it('sends to a customer who has chosen nothing, so silence is not a refusal', () => {
    expect(maySend(marketing, [])).toBe(true);
    expect(maySend(payment, [])).toBe(true);
  });

  it('does not send an optional message the customer turned off', () => {
    expect(maySend(marketing, [off('MARKETING')])).toBe(false);
  });

  it('sends a mandatory message even to a customer who turned that category off', () => {
    expect(maySend(payment, [off('PAYMENT')])).toBe(true);
  });

  it('keeps a choice to one channel, so turning off email does not silence the centre', () => {
    expect(maySend(marketing, [off('MARKETING', 'IN_APP')])).toBe(true);
    expect(maySend({ ...marketing, channel: 'IN_APP' }, [off('MARKETING', 'IN_APP')])).toBe(false);
  });

  it('keeps a choice to one category, so turning off marketing does not silence quotes', () => {
    expect(maySend({ category: 'QUOTE', channel: 'EMAIL', mandatory: false }, [off('MARKETING')])).toBe(true);
  });

  it('sends when the customer has explicitly turned a category on', () => {
    expect(maySend(marketing, [{ category: 'MARKETING', channel: 'EMAIL', enabled: true }])).toBe(true);
  });
});

describe('overriddenBy', () => {
  it('names the rule when a mandatory message goes out against a choice', () => {
    expect(overriddenBy(payment, [off('PAYMENT')])).toBe('mandatory');
  });

  it('names nothing when the customer never objected', () => {
    expect(overriddenBy(payment, [])).toBeNull();
    expect(overriddenBy(payment, [{ category: 'PAYMENT', channel: 'EMAIL', enabled: true }])).toBeNull();
  });

  it('names nothing for an optional message, which cannot override anything', () => {
    expect(overriddenBy(marketing, [off('MARKETING')])).toBeNull();
  });
});
