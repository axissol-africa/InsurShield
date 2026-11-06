import { accountLinkReadinessMessage, accountLinksReady } from './account-link-readiness.js';

describe('Better Auth account-link readiness', () => {
  it('permits a narrowing migration only when every legacy link is present', () => {
    expect(accountLinksReady({ customers: 0, staffUsers: 0 })).toBe(true);
    expect(accountLinksReady({ customers: 1, staffUsers: 0 })).toBe(false);
    expect(accountLinksReady({ customers: 0, staffUsers: 1 })).toBe(false);
  });

  it('reports counts without exposing account details', () => {
    expect(accountLinkReadinessMessage({ customers: 2, staffUsers: 3 })).toBe(
      'Cannot narrow Better Auth account links: 2 customer record(s) and 3 staff record(s) still lack userId.',
    );
  });
});
