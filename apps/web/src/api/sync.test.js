import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  insurers: { profile: vi.fn() },
  quotes: { listForInsurer: vi.fn() },
  policies: { listForInsurer: vi.fn() },
  claims: { listForInsurer: vi.fn() },
  ncd: { listForInsurer: vi.fn() },
}));

vi.mock('@/config/env', () => ({ env: { apiMode: 'http', mockLatencyMs: 0 } }));
vi.mock('./index', () => ({ api }));

import { useStore } from '@/store';
import { hydrateInsurerPortal, scopeQuoteRequests, scopeRecords } from './sync';

beforeEach(() => vi.clearAllMocks());

describe('loading the insurer portal from the real API', () => {
  it('tags every record from the insurer routes with the signed-in insurer, so the portal screens keep them', async () => {
    api.insurers.profile.mockResolvedValue({ id: 'ins-1', name: 'Prestige Assurance' });
    api.quotes.listForInsurer.mockResolvedValue([
      { id: 'QR-1', reply: { premium: 23400 } },
      { id: 'QR-2', reply: null, selectedProducts: [{ productVersionId: 'v-1', reply: null }] },
    ]);
    api.policies.listForInsurer.mockResolvedValue([{ policyNumber: 'POL-1' }]);
    api.claims.listForInsurer.mockResolvedValue([{ claimNumber: 'CLM-1' }]);
    api.ncd.listForInsurer.mockResolvedValue([{ id: 'NCD-1' }]);

    await hydrateInsurerPortal();

    const { quoteRequests, policies, claims, ncdApplications } = useStore.getState();
    expect(quoteRequests[0]).toMatchObject({ insurers: ['Prestige Assurance'], insurerQuotes: { 'Prestige Assurance': { premium: 23400 } } });
    expect(quoteRequests[1]).toMatchObject({ insurerQuotes: {}, selectedProducts: [{ productVersionId: 'v-1', insurerName: 'Prestige Assurance' }] });
    expect(policies[0].insurer).toBe('Prestige Assurance');
    expect(claims[0].insurer).toBe('Prestige Assurance');
    expect(ncdApplications[0].insurer).toBe('Prestige Assurance');
  });
});

describe('scoping helpers', () => {
  it('never overwrites an insurer the record already names', () => {
    expect(scopeRecords([{ insurer: 'Global Guard' }], 'Prestige Assurance')).toEqual([{ insurer: 'Global Guard' }]);
    expect(scopeQuoteRequests([{ insurers: ['Global Guard'], insurerQuotes: { 'Global Guard': {} } }], 'Prestige Assurance'))
      .toEqual([{ insurers: ['Global Guard'], insurerQuotes: { 'Global Guard': {} }, selectedProducts: undefined }]);
  });

  it('copes with an empty or missing list', () => {
    expect(scopeRecords(undefined, 'Prestige Assurance')).toEqual([]);
    expect(scopeQuoteRequests(null, 'Prestige Assurance')).toEqual([]);
  });
});
