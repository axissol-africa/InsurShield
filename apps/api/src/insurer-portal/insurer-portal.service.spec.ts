import type { Principal } from '../common/auth/auth.types.js';
import { InsurerPortalService } from './insurer-portal.service.js';

const INSURER_USER: Principal = {
  kind: 'staff',
  id: 'staff-1',
  email: 's@example.test',
  role: 'INSURER_USER',
  insurerId: 'insurer-1',
};

/** Fails on any method call, so a refusal is known to come before every query. */
const untouchable = (what: string) =>
  new Proxy({}, {
    get: (_target, property) => () => {
      throw new Error(`${what}.${String(property)} was called`);
    },
  });

/** Pick functions that always choose `index`, so every drawn code is the same. */
const always = (index: number) => () => index;

describe('who may use the portal', () => {
  const service = new InsurerPortalService(untouchable('repository') as never, untouchable('documents') as never, always(0));

  const calls: [string, (principal: Principal) => Promise<unknown>][] = [
    ['listQuoteRequests', (principal) => service.listQuoteRequests(principal)],
    ['submitQuote', (principal) => service.submitQuote(principal, 'r', { premium: 1, documentId: 'd' })],
    ['extendQuote', (principal) => service.extendQuote(principal, 'r', { extraDays: 1 })],
    ['listPolicies', (principal) => service.listPolicies(principal)],
    ['issueCertificate', (principal) => service.issueCertificate(principal, 'p', { certificateDocumentId: 'd' })],
    ['listClaims', (principal) => service.listClaims(principal)],
    ['acknowledgeClaim', (principal) => service.acknowledgeClaim(principal, 'c', {})],
    ['listNcdApplications', (principal) => service.listNcdApplications(principal)],
    ['decideNcdApplication', (principal) => service.decideNcdApplication(principal, 'a', { status: 'APPROVED' })],
  ];

  const outsiders: [string, Principal][] = [
    ['a customer', { kind: 'customer', id: 'customer-1', email: 'c@example.test' }],
    ['an admin', { kind: 'staff', id: 'staff-2', email: 'a@example.test', role: 'ADMIN', insurerId: null }],
    ['a super admin with an insurer id', { kind: 'staff', id: 'staff-3', email: 'x@example.test', role: 'SUPER_ADMIN', insurerId: 'insurer-1' }],
    ['an insurer user with no insurer', { ...INSURER_USER, insurerId: null }],
  ];

  it.each(outsiders)('refuses %s with 403 on every method before any query', async (_who, principal) => {
    for (const [name, call] of calls) {
      await expect(call(principal), name).rejects.toMatchObject({ status: 403, response: { code: 'FORBIDDEN' } });
    }
  });
});

describe('final quotes', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('refuses a request whose expiry is the present instant with 409 REQUEST_EXPIRED', async () => {
    const now = new Date('2026-10-24T12:00:00.000Z');
    vi.useFakeTimers({ now, toFake: ['Date'] });
    const repository = {
      transaction: (work: (tx: unknown) => Promise<unknown>) => work({}),
      lockDelivery: async () => ({ status: 'SUBMITTED', expiresAt: new Date(now), quoteValidityDays: 14 }),
      hasQuote: async () => false,
    };
    const documents = untouchable('documents');
    const service = new InsurerPortalService(repository as never, documents as never, always(0));

    await expect(service.submitQuote(INSURER_USER, 'r', { premium: 1, documentId: 'd' })).rejects.toMatchObject({
      status: 409,
      response: { code: 'REQUEST_EXPIRED' },
    });
  });
});

describe('NCD approvals', () => {
  function approving(insertResults: boolean[]) {
    const inserted: string[] = [];
    const linked: (string | undefined)[] = [];
    const repository = {
      transaction: (work: (tx: unknown) => Promise<unknown>) => work({}),
      lockNcdApplication: async () => ({ status: 'SUBMITTED', yearsClaimFree: 3, applicationNumber: 'NCDA-1' }),
      insertNcdCode: async (_tx: unknown, code: { code: string }) => {
        inserted.push(code.code);
        return insertResults[inserted.length - 1] ?? true;
      },
      decideNcdApplication: async (
        _tx: unknown,
        _id: string,
        _insurerId: string,
        _from: string,
        decision: { status: string; decidedAt: Date | null; approvedCodeId?: string },
      ) => {
        linked.push(decision.approvedCodeId);
        return { id: 'a', status: decision.status, decidedAt: decision.decidedAt };
      },
    };
    let draw = 0;
    // Draws NCD-00000 for the first code, NCD-11111 for the second, and so on.
    const pick = () => Math.floor(draw++ / 5);
    const service = new InsurerPortalService(repository as never, untouchable('documents') as never, pick);
    return { service, inserted, linked };
  }

  it('draws a new code when the first one is already taken and links that one', async () => {
    const { service, inserted, linked } = approving([false, true]);

    const approval = await service.decideNcdApplication(INSURER_USER, 'a', { status: 'APPROVED' });

    expect(inserted).toEqual(['NCD-00000', 'NCD-11111']);
    expect(linked).toEqual(['NCD-11111']);
    expect(approval).toMatchObject({ approvedCode: 'NCD-11111', percentage: 30 });
  });

  it('gives up after five taken codes without deciding the application', async () => {
    const { service, inserted, linked } = approving([false, false, false, false, false, true]);

    await expect(service.decideNcdApplication(INSURER_USER, 'a', { status: 'APPROVED' })).rejects.toThrow(
      'No unused NCD code was found in 5 attempts.',
    );
    expect(inserted).toHaveLength(5);
    expect(linked).toEqual([]);
  });
});
