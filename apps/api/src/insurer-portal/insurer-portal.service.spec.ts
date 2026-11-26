import type { Principal } from '../common/auth/auth.types.js';
import type { NewNcdCode } from './insurer-portal.repository.js';
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
const audit = { write: async () => undefined, transition: async () => undefined };
/** These cases never reach a notification; the service still needs one. */
const notifications = { notify: async () => undefined };

describe('who may use the portal', () => {
  const service = new InsurerPortalService(
    untouchable('repository') as never,
    untouchable('documents') as never,
    untouchable('pia') as never,
    always(0),
    audit as never,
    notifications as never,
    untouchable('versions') as never,
    untouchable('workflow') as never,
    untouchable('inspectionRecords') as never,
    untouchable('underwriting') as never,
    untouchable('ncd') as never,
    { effective: async () => ({ value: { tiers: [{ yearsClaimFree: 3, percentage: 30 }], validityDays: 180 }, version: 7 }) } as never,
    untouchable('idempotency') as never,
  );

  const calls: [string, (principal: Principal) => Promise<unknown>][] = [
    ['listQuoteRequests', (principal) => service.listQuoteRequests(principal)],
    ['submitQuote', (principal) => service.submitQuote(principal, 'r', { premium: 1, documentId: 'd' })],
    ['extendQuote', (principal) => service.extendQuote(principal, 'r', { extraDays: 1 })],
    ['listPolicies', (principal) => service.listPolicies(principal)],
    ['issueCertificate', (principal) => service.issueCertificate(principal, 'p', { certificateDocumentId: 'd' })],
    ['listClaims', (principal) => service.listClaims(principal)],
    ['acknowledgeClaim', (principal) => service.acknowledgeClaim(principal, 'c', {})],
    ['listNcdApplications', (principal) => service.listNcdApplications(principal)],
    ['decideNcdApplication', (principal) => service.decideNcdApplication(principal, 'a', { status: 'APPROVED', note: 'Verified history.' })],
  ];

  const outsiders: [string, Principal][] = [
    ['a customer', { kind: 'customer', id: 'customer-1', email: 'c@example.test', emailVerified: true }],
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
      insurerStanding: async () => ({ name: 'Prestige Assurance', status: 'ACTIVE', licenceExpiry: null }),
      lockDelivery: async () => ({ model: 'LEGACY', status: 'SUBMITTED', expiresAt: new Date(now), quoteValidityDays: 14 }),
      hasQuote: async () => false,
    };
    const documents = untouchable('documents');
    const service = new InsurerPortalService(repository as never, documents as never, untouchable('pia') as never, always(0), audit as never, notifications as never, untouchable('versions') as never, untouchable('workflow') as never, untouchable('inspectionRecords') as never, untouchable('underwriting') as never, untouchable('ncd') as never, untouchable('settings') as never, untouchable('idempotency') as never);

    await expect(service.submitQuote(INSURER_USER, 'r', { premium: 1, documentId: 'd' })).rejects.toMatchObject({
      status: 409,
      response: { code: 'REQUEST_EXPIRED' },
    });
  });
});

describe('NCD approvals', () => {
  function approving(insertResults: boolean[], application = { status: 'SUBMITTED', yearsClaimFree: 3, applicationNumber: 'NCDA-1', customerId: 'customer-1' }, verified = true) {
    const inserted: string[] = [];
    const issued: NewNcdCode[] = [];
    const events: string[] = [];
    const notifier = { notify: vi.fn() };
    const auditor = { write: vi.fn(), transition: vi.fn() };
    const settings = { effective: vi.fn(async () => ({ value: { tiers: [{ yearsClaimFree: 3, percentage: 30 }], validityDays: 180 }, version: 7 })) };
    const tx = { select: () => ({ from: () => ({ where: () => ({ for: async () => { events.push('customer'); return [{ id: application.customerId }]; } }) }) }) };
    const linked: (string | undefined)[] = [];
    const repository = {
      transaction: (work: (tx: unknown) => Promise<unknown>) => work(tx),
      insurerStanding: async () => ({ name: 'Prestige Assurance', status: 'ACTIVE', licenceExpiry: null }),
      lockNcdApplication: async () => { events.push('application'); return { verificationRevision: 0, sourcePolicyNumber: 'policy-1', ...application }; },
      ncdApplicationCustomer: async () => ({ customerId: application.customerId }),
      hasVerifiedNcdSource: async () => verified,
      insurerName: async () => 'Prestige Assurance',
      insertNcdCode: async (_tx: unknown, code: NewNcdCode) => {
        inserted.push(code.code);
        issued.push(code);
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
    // Draws NCD-00000000000000000000 for the first code, NCD-11111111111111111111 for the second, and so on.
    const pick = () => Math.floor(draw++ / 20);
    const service = new InsurerPortalService(
      repository as never,
      untouchable('documents') as never,
      untouchable('pia') as never,
      pick,
      auditor as never,
      notifier as never,
      untouchable('versions') as never,
      untouchable('workflow') as never,
      untouchable('inspectionRecords') as never,
      untouchable('underwriting') as never,
      untouchable('ncd') as never,
      settings as never,
      { execute: async (_caller: string, _endpoint: string, _key: string, _request: unknown, work: (tx: unknown) => Promise<unknown>) => ({ value: await repository.transaction(work), replayed: false }) } as never,
    );
    return { service, inserted, linked, issued, notifier, auditor, settings, repository, events };
  }

  it('draws a new code when the first one is already taken and links that one', async () => {
    const { service, inserted, linked } = approving([false, true]);

    const approval = await service.decideNcdApplication(INSURER_USER, 'a', { status: 'APPROVED', note: 'Verified history.' });

    expect(inserted).toEqual(['NCD-00000000000000000000', 'NCD-11111111111111111111']);
    expect(linked).toEqual(['NCD-11111111111111111111']);
    expect(approval).toMatchObject({ approvedCode: 'NCD-11111111111111111111', percentage: 30 });
  });

  it('gives up after five taken codes without deciding the application', async () => {
    const { service, inserted, linked } = approving([false, false, false, false, false, true]);

    await expect(service.decideNcdApplication(INSURER_USER, 'a', { status: 'APPROVED', note: 'Verified history.' })).rejects.toThrow(
      'No unused NCD code was found in 5 attempts.',
    );
    expect(inserted).toHaveLength(5);
    expect(linked).toEqual([]);
  });
  it.each(['APPROVED', 'REJECTED'])('keeps %s terminal', async (status) => {
    const { service, inserted } = approving([], { status, yearsClaimFree: 3, applicationNumber: 'NCDA-1', customerId: 'customer-1' });
    await expect(service.decideNcdApplication(INSURER_USER, 'a', { status: 'UNDER_REVIEW', note: 'Review again.' }))
      .rejects.toMatchObject({ response: { code: 'ALREADY_DECIDED' } });
    expect(inserted).toEqual([]);
  });

  it('refuses legacy approval but permits rejection with a note', async () => {
    const { service, inserted } = approving([], undefined, false);
    await expect(service.decideNcdApplication(INSURER_USER, 'a', { status: 'APPROVED', note: 'Approve.' }))
      .rejects.toMatchObject({ response: { code: 'NCD_POLICY_UNVERIFIED' } });
    await expect(service.decideNcdApplication(INSURER_USER, 'a', { status: 'REJECTED', note: 'Cannot validate history.' }))
      .resolves.toMatchObject({ status: 'Rejected' });
    expect(inserted).toEqual([]);
  });

  it('does not bypass outstanding evidence through review or approval', async () => {
    const { service, inserted } = approving([], { status: 'VERIFICATION_REQUIRED', yearsClaimFree: 3, applicationNumber: 'NCDA-1', customerId: 'customer-1' });
    for (const status of ['UNDER_REVIEW', 'APPROVED'] as const) {
      await expect(service.decideNcdApplication(INSURER_USER, 'a', { status, note: 'Proceed.' }))
        .rejects.toMatchObject({ response: { code: 'NCD_EVIDENCE_OUTSTANDING' } });
    }
    expect(inserted).toEqual([]);
  });

  it('rejects overrides and empty notes before issuing a code', async () => {
    const { service, inserted } = approving([]);
    for (const dto of [{ status: 'APPROVED' as const, note: 'Proceed.', percentage: 15 }, { status: 'APPROVED' as const, note: '  ' }]) {
      await expect(service.decideNcdApplication(INSURER_USER, 'a', dto)).rejects.toMatchObject({ response: { code: 'BAD_REQUEST' } });
    }
    expect(inserted).toEqual([]);
  });

  it('persists configured expiry and rule version, audits the note, and notifies approval', async () => {
    const { service, issued, auditor, notifier } = approving([]);
    await service.decideNcdApplication(INSURER_USER, 'a', { status: 'APPROVED', note: '  History verified.  ', percentage: 30 });
    expect(issued[0]).toMatchObject({ percentage: 30, issuedRuleVersion: 7 });
    const issuedAt = issued[0].issuedAt;
    if (!issuedAt) throw new Error('Expected issuance time');
    expect(issued[0].expiresAt?.getTime()).toBe(issuedAt.getTime() + 180 * 86400000);
    expect(auditor.transition).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ note: 'History verified.', toStatus: 'APPROVED' }));
    expect(notifier.notify).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ key: 'ncd.decided', customerId: 'customer-1' }));
  });

  it.each([
    ['UNDER_REVIEW', 'ncd.review_started'],
    ['VERIFICATION_REQUIRED', 'ncd.verification_requested'],
    ['REJECTED', 'ncd.decided'],
  ] as const)('notifies %s with its event key and preserves customer-before-application lock order', async (status, key) => {
    const { service, notifier, events, auditor } = approving([]);
    await service.decideNcdApplication(INSURER_USER, 'a', { status, note: 'Decision reason.', verificationRevision: 0 }, 'stable-test-key');
    expect(notifier.notify).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ key }));
    expect(auditor.transition).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ note: 'Decision reason.', toStatus: status }));
    expect(events).toEqual(status === 'VERIFICATION_REQUIRED' ? ['customer', 'application'] : ['application']);
  });

  it('allows servicing for an inactive insurer but refuses approval', async () => {
    const { service, repository } = approving([]);
    repository.insurerStanding = async () => ({ name: 'Prestige Assurance', status: 'INACTIVE', licenceExpiry: null });
    await expect(service.decideNcdApplication(INSURER_USER, 'a', { status: 'UNDER_REVIEW', note: 'Review history.' })).resolves.toMatchObject({ status: 'Under Review' });
    await expect(service.decideNcdApplication(INSURER_USER, 'a', { status: 'APPROVED', note: 'Approve.' })).rejects.toMatchObject({ response: { code: 'INSURER_UNAVAILABLE' } });
  });

  it('rejects years below every configured tier', async () => {
    const { service } = approving([], { status: 'SUBMITTED', yearsClaimFree: 1, applicationNumber: 'NCDA-1', customerId: 'customer-1' });
    await expect(service.decideNcdApplication(INSURER_USER, 'a', { status: 'APPROVED', note: 'Approve.' })).rejects.toMatchObject({ response: { code: 'NCD_INELIGIBLE' } });
  });

  it('requires both the expected revision and a stable key for modern evidence requests', async () => {
    const { service } = approving([]);
    await expect(service.decideNcdApplication(INSURER_USER, 'a', { status: 'VERIFICATION_REQUIRED', note: 'Evidence needed.' }, 'stable-key'))
      .rejects.toMatchObject({ response: { code: 'NCD_REVISION_REQUIRED' } });
    await expect(service.decideNcdApplication(INSURER_USER, 'a', { status: 'VERIFICATION_REQUIRED', note: 'Evidence needed.', verificationRevision: 0 }))
      .rejects.toMatchObject({ response: { code: 'NCD_REVISION_REQUIRED' } });
  });

  it('refuses stale decisions after evidence has advanced the revision', async () => {
    const { service, repository, notifier } = approving([]);
    repository.lockNcdApplication = async () => ({ status: 'UNDER_REVIEW', yearsClaimFree: 3, applicationNumber: 'NCDA-1', customerId: 'customer-1', sourcePolicyNumber: 'policy-1', verificationRevision: 1 });
    for (const status of ['VERIFICATION_REQUIRED', 'APPROVED', 'REJECTED', 'UNDER_REVIEW'] as const) {
      await expect(service.decideNcdApplication(INSURER_USER, 'a', { status, note: 'Old command.', verificationRevision: 0 }, 'old-key'))
        .rejects.toMatchObject({ response: { code: 'NCD_REVISION_CHANGED' } });
    }
    expect(notifier.notify).not.toHaveBeenCalled();
  });

});
