import { describe, expect, it, vi } from 'vitest';

vi.mock('@/config/env', () => ({ env: { apiMode: 'http' } }));

import { merge, migrate } from './persistence';

describe('HTTP persistence', () => {
  it('never adds demo insurers to an empty or partial server catalogue', () => {
    const current = { insurersList: [], quoteRequests: [], policyStartDate: '2099-01-01' };
    const partial = [{ id: 'server-1', name: 'A real insurer', status: 'Active' }];

    expect(merge({ insurersList: partial, quoteRequests: [] }, current).insurersList).toEqual(partial);
    expect(merge({ insurersList: [], quoteRequests: [] }, current).insurersList).toEqual([]);
    expect(migrate({ insurersList: partial }, 3).insurersList).toEqual(partial);
  });
});
