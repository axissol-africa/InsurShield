import { describe, expect, it } from 'vitest';
import { INSURER_RATES, demoCoverGuides, reconcileInsurers, sameInsurerName } from './insurers';
import { COVER_TYPES, isCoverGuideComplete } from './coverGuide';

describe('sameInsurerName', () => {
  it('matches exact, prefix and punctuation-insensitive names', () => {
    expect(sameInsurerName('Global Guard Insurance', 'Global Guard')).toBe(true);
    expect(sameInsurerName('Metro Safe', 'metro-safe assurance')).toBe(true);
    expect(sameInsurerName('Prestige Assurance', 'Madison General')).toBe(false);
    expect(sameInsurerName('', 'Madison')).toBe(false);
  });
});

describe('reconcileInsurers', () => {
  it('returns the catalogue when nothing is stored', () => {
    for (const stored of [undefined, []]) {
      const insurers = reconcileInsurers(stored);
      expect(insurers.map((insurer) => insurer.name)).toEqual(INSURER_RATES.map((insurer) => insurer.name));
      // The catalogue entry itself, plus the guides every insurer needs
      // before it is allowed to quote.
      expect(insurers[0]).toMatchObject(INSURER_RATES[0]);
    }
  });

  // An insurer cannot send a quote without a published guide, so a catalogue
  // that generated incomplete ones would leave the prototype unable to quote.
  it('publishes a complete cover guide for every catalogue insurer and cover type', () => {
    for (const insurer of reconcileInsurers(undefined)) {
      for (const coverType of COVER_TYPES) {
        expect(isCoverGuideComplete(insurer.coverGuides?.[coverType])).toBe(true);
      }
    }
  });

  it('leaves own-vehicle benefits out of a third party guide', () => {
    const guides = demoCoverGuides(INSURER_RATES[0]);
    const items = guides.ThirdParty.coveredItems.join(' ');
    expect(items).not.toMatch(/own damage|theft|windscreen/i);
    expect(guides.ThirdParty.exclusions).toContain('Any damage to your own vehicle');
    expect(guides.Comprehensive.coveredItems.length).toBeGreaterThan(guides.ThirdParty.coveredItems.length);
  });

  it('repairs partial stored entries from the catalogue', () => {
    const stored = [{ id: '2', name: 'Global Guard', icon: 'business' }];
    const [globalGuard] = reconcileInsurers(stored);
    expect(globalGuard.name).toBe('Global Guard Insurance');
    expect(globalGuard.ratePercentage).toBe(4);
    expect(globalGuard.benefits.length).toBeGreaterThan(0);
    expect(globalGuard.contact.phone).toBeTruthy();
  });

  it('keeps admin edits and restores missing catalogue insurers', () => {
    const stored = [{ id: '1', name: 'Prestige Assurance', ratePercentage: 5.5, status: 'Inactive', logoUrl: 'x.png' }];
    const list = reconcileInsurers(stored);
    const prestige = list.find((insurer) => insurer.id === '1');
    expect(prestige.ratePercentage).toBe(5.5);
    expect(prestige.status).toBe('Inactive');
    expect(prestige.logoUrl).toBe('x.png');
    expect(list).toHaveLength(INSURER_RATES.length);
  });

  it('keeps insurers added through the admin portal and drops unusable ones', () => {
    const stored = [
      ...INSURER_RATES,
      { id: '999', name: 'New Partner Insurance', ratePercentage: 3.9, benefits: ['Own Damage'] },
      { id: '998', name: 'Broken Entry' },
      { name: '' },
    ];
    const list = reconcileInsurers(stored);
    expect(list.find((insurer) => insurer.id === '999')?.ratePercentage).toBe(3.9);
    expect(list.find((insurer) => insurer.id === '998')).toBeUndefined();
    expect(list.every((insurer) => Number.isFinite(insurer.ratePercentage))).toBe(true);
  });

  it('coerces legacy rate fields', () => {
    const [metro] = reconcileInsurers([{ name: 'Metro Safe', rate: '5' }]);
    expect(metro.id).toBe('4');
    expect(metro.ratePercentage).toBe(5);
  });
});
