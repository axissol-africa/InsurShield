import { InsurerPortalController } from './insurer-portal.controller.js';
import { PATH_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants.js';
import { REQUIRED_PERMISSION } from '../common/auth/auth.guard.js';
import { UnderwritingInspectionsService } from '../customer/underwriting-inspections.service.js';
import type { InspectionPurpose, InspectionStatus, InspectionMethod, InsurerStatus } from '../common/domain/enums.js';
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


describe('inspection purpose and report gates', () => {
  function fixture(purpose: InspectionPurpose, status: InspectionStatus = 'REPORT_READY', standing: InsurerStatus = 'ACTIVE', method: InspectionMethod = 'PHYSICAL') {
    const row = { id: 'inspection-1', purpose, status, method, insurerId: 'insurer-1', customerId: 'customer-1',
      quoteRequestId: null, policyNumber: purpose === 'AFTER_PAYMENT' || purpose === 'CLAIM_ASSESSMENT' ? 'policy-1' : null,
      claimNumber: purpose === 'CLAIM_ASSESSMENT' ? 'claim-1' : null, predecessorId: 'inspection-0',
      vehiclePlate: 'ABC 123', vehicleLabel: 'Toyota', scheduledDate: null, createdAt: new Date(), decidedAt: null };
    const records = { lockForInsurer: vi.fn(async () => row), move: vi.fn(async () => true),
      exists: vi.fn(async () => true), closeLinks: vi.fn(),
      listForInsurer: vi.fn(async (_insurer: string, purposes: readonly InspectionPurpose[]) => purposes.includes(row.purpose) ? [row] : []),
      productsOf: vi.fn(async () => []),
    };
    const events = { transition: vi.fn(), refusal: vi.fn() };
    const notifier = { notify: vi.fn() };
    const tx = {};
    const repository = { transaction: async (work: (tx: unknown) => Promise<unknown>) => work(tx),
      insurerStanding: async () => ({ name: 'Insurer', status: standing, licenceExpiry: null }) };
    const underwriting = new UnderwritingInspectionsService(records as never, untouchable('versions') as never, events as never, notifier as never);
    const service = new InsurerPortalService(repository as never, untouchable('documents') as never, untouchable('pia') as never,
      always(0), events as never, notifier as never, untouchable('versions') as never, untouchable('workflow') as never,
      records as never, underwriting, untouchable('ncd') as never, untouchable('settings') as never, untouchable('idempotency') as never);
    return { service, records, events, notifier, tx };
  }
  const officer = (role: 'CLAIMS_OFFICER' | 'QUOTE_OFFICER' | 'SUPPORT') => ({ ...INSURER_USER, role });

  it.each([
    ['CLAIMS_OFFICER', 'AFTER_PAYMENT'], ['CLAIMS_OFFICER', 'UNDERWRITING'], ['QUOTE_OFFICER', 'CLAIM_ASSESSMENT'], ['SUPPORT', 'CLAIM_ASSESSMENT'],
  ] as const)('refuses %s acting on %s after locking it', async (role, purpose) => {
    const { service, records, tx } = fixture(purpose);
    await expect(service.actOnInspection(officer(role), 'inspection-1', 'APPROVE', {})).rejects.toMatchObject({ status: 404 });
    expect(records.lockForInsurer).toHaveBeenCalledWith(tx, 'inspection-1', 'insurer-1');
    expect(records.move).not.toHaveBeenCalled();
  });

  it('does not act on a foreign inspection', async () => {
    const { service, records } = fixture('CLAIM_ASSESSMENT');
    records.lockForInsurer.mockResolvedValueOnce(undefined as never);
    await expect(service.actOnInspection(officer('CLAIMS_OFFICER'), 'foreign', 'APPROVE', {})).rejects.toMatchObject({ status: 404 });
    expect(records.move).not.toHaveBeenCalled();
  });

  it.each(['AFTER_PAYMENT', 'CLAIM_ASSESSMENT'] as const)('requires REPORT_READY to approve %s even for self capture', async (purpose) => {
    for (const status of ['REQUESTED', 'SCHEDULED', 'COMPLETED'] as const) {
      const { service, records } = fixture(purpose, status, 'ACTIVE', 'SELF_CAPTURE');
      await expect(service.actOnInspection(INSURER_USER, 'inspection-1', 'APPROVE', {})).rejects.toMatchObject({ response: { code: 'INSPECTION_NOT_READY' } });
      expect(records.move).not.toHaveBeenCalled();
    }
    const { service } = fixture(purpose);
    await expect(service.actOnInspection(INSURER_USER, 'inspection-1', 'APPROVE', {})).resolves.toMatchObject({ status: 'APPROVED', result: 'PASSED' });
  });

  it('permits a later failed-evidence decision without a report and does not reopen it', async () => {
    const { service, records } = fixture('CLAIM_ASSESSMENT', 'COMPLETED');
    await expect(service.actOnInspection(officer('CLAIMS_OFFICER'), 'inspection-1', 'FAIL', { reason: 'Evidence unusable.' }))
      .resolves.toMatchObject({ status: 'FAILED', result: 'FAILED' });
    expect(records.closeLinks).not.toHaveBeenCalled();
    const closed = fixture('CLAIM_ASSESSMENT', 'FAILED');
    await expect(closed.service.actOnInspection(INSURER_USER, 'inspection-1', 'APPROVE', {})).rejects.toMatchObject({ response: { code: 'INSPECTION_CLOSED' } });
  });

  it('services later inspections for inactive insurers but preserves earlier new-business rules', async () => {
    for (const purpose of ['AFTER_PAYMENT', 'CLAIM_ASSESSMENT'] as const) {
      await expect(fixture(purpose, 'REPORT_READY', 'INACTIVE').service.actOnInspection(INSURER_USER, 'inspection-1', 'APPROVE', {}))
        .resolves.toMatchObject({ status: 'APPROVED' });
      await expect(fixture(purpose, 'REPORT_READY', 'DELETED').service.actOnInspection(INSURER_USER, 'inspection-1', 'APPROVE', {}))
        .rejects.toMatchObject({ response: { code: 'INSURER_UNAVAILABLE' } });
    }
    await expect(fixture('UNDERWRITING', 'SCHEDULED', 'INACTIVE').service.actOnInspection(INSURER_USER, 'inspection-1', 'APPROVE', {}))
      .rejects.toMatchObject({ response: { code: 'INSURER_UNAVAILABLE' } });
  });

  it('filters the list by role and preserves later links and predecessor', async () => {
    const { service, records } = fixture('CLAIM_ASSESSMENT');
    expect(await service.listInspections(officer('QUOTE_OFFICER'))).toEqual([]);
    expect(await service.listInspections(officer('CLAIMS_OFFICER'))).toEqual([expect.objectContaining({ policyNumber: 'policy-1', claimNumber: 'claim-1', predecessorId: 'inspection-0' })]);
    expect(records.listForInsurer).toHaveBeenLastCalledWith('insurer-1', ['CLAIM_ASSESSMENT']);
  });
});


describe('later inspection route wiring', () => {
  const state = { id: 'inspection-1', status: 'REQUESTED', statusLabel: 'Requested' };
  const evidence = { preLoss: [], postLoss: [], report: null };
  const later = {
    startClaim: vi.fn(async () => state), addInsurerEvidence: vi.fn(async () => state),
    insurerEvidence: vi.fn(async () => evidence), submitReport: vi.fn(async () => state), reinspect: vi.fn(async () => state),
  };
  const controller = new InsurerPortalController(untouchable('portal') as never, untouchable('insurers') as never, untouchable('integrations') as never, later as never);

  it('passes the authenticated principal and validated payload to the later service', async () => {
    expect(await controller.startClaimInspection('claim-1', { method: 'PHYSICAL' }, INSURER_USER)).toEqual(state);
    expect(later.startClaim).toHaveBeenCalledWith(INSURER_USER, 'claim-1', 'PHYSICAL');
    const photos: Parameters<InsurerPortalController['addInspectionEvidence']>[1]['photos'] = [];
    await controller.addInspectionEvidence('inspection-1', { photos }, INSURER_USER);
    expect(later.addInsurerEvidence).toHaveBeenCalledWith(INSURER_USER, 'inspection-1', photos);
    expect(await controller.inspectionEvidence('inspection-1', INSURER_USER)).toEqual(evidence);
    expect(later.insurerEvidence).toHaveBeenCalledWith(INSURER_USER, 'inspection-1');
    await controller.publishInspectionReport('inspection-1', { documentId: 'document-1' }, INSURER_USER);
    expect(later.submitReport).toHaveBeenCalledWith(INSURER_USER, 'inspection-1', 'document-1');
    await controller.reinspect('inspection-1', INSURER_USER);
    expect(later.reinspect).toHaveBeenCalledWith(INSURER_USER, 'inspection-1');
  });

  it.each([
    ['startClaimInspection', 'claims/:claimNumber/inspection', 'portal:claim:update'],
    ['addInspectionEvidence', 'inspections/:id/evidence', 'portal:inspection:manage'],
    ['inspectionEvidence', 'inspections/:id/evidence', 'portal:inspection:read'],
    ['publishInspectionReport', 'inspections/:id/report', 'portal:inspection:manage'],
    ['reinspect', 'inspections/:id/reinspect', 'portal:inspection:manage'],
  ] as const)('protects %s with the intended route permission', (method, path, permission) => {
    const handler = InsurerPortalController.prototype[method];
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
    expect(Reflect.getMetadata(REQUIRED_PERMISSION, handler)).toBe(permission);
    if (method !== 'inspectionEvidence') expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(201);
  });
});
