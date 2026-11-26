import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Principal } from '../common/auth/auth.types.js';
import { PrivacyReviewService } from './privacy-review.service.js';
const admin: Principal = {
  kind: 'staff',
  id: randomUUID(),
  email: 'admin@example.invalid',
  role: 'ADMIN',
  insurerId: null,
};
const customer: Principal = {
  kind: 'customer',
  id: randomUUID(),
  email: 'customer@example.invalid',
  emailVerified: true,
};
function fixture() {
  const row = {
    id: randomUUID(),
    customerId: customer.id,
    kind: 'ACCESS',
    status: 'SUBMITTED',
    version: 1,
    ownerStaffId: admin.id,
    requestedByStaffId: null,
    identityVerifiedAt: null,
    held: false,
    createdAt: new Date(),
    completedAt: null,
  };
  const repository = {
    transaction: vi.fn((work) => work({})),
    get: vi.fn().mockResolvedValue(row),
    owner: vi.fn().mockResolvedValue({ ...admin, isActive: true }),
    list: vi.fn().mockResolvedValue([row]),
    customer: vi
      .fn()
      .mockResolvedValue({ id: customer.id, anonymisedAt: null }),
    fence: vi.fn().mockResolvedValue(false),
    update: vi.fn(async (_tx, current, patch) => ({
      ...current,
      ...patch,
      version: current.version + 1,
    })),
    event: vi.fn(),
    recordBelongs: vi.fn().mockResolvedValue(false),
  };
  const audit = { write: vi.fn(), refusal: vi.fn(), recordRead: vi.fn() };
  return {
    row,
    repository,
    audit,
    service: new PrivacyReviewService(repository as never, audit as never),
  };
}
describe('privacy review service boundaries', () => {
  it('audits service authorization denial before accessing private storage', async () => {
    const f = fixture();
    await expect(f.service.list(customer, {}, true)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(f.audit.refusal).toHaveBeenCalledOnce();
    expect(f.repository.list).not.toHaveBeenCalled();
  });
  it('never trusts customer filters and returns only bounded public request metadata', async () => {
    const f = fixture();
    await expect(
      f.service.list(customer, { customerId: randomUUID() }),
    ).rejects.toMatchObject({ code: 'PRIVACY_INPUT_INVALID' });
    const result = await f.service.list(customer);
    expect(f.repository.list).toHaveBeenCalledWith({}, customer.id);
    expect(Object.keys(result.items[0]).sort()).toEqual([
      'completedAt',
      'createdAt',
      'id',
      'kind',
      'status',
    ]);
    expect(f.audit.recordRead).not.toHaveBeenCalled();
  });
  it('withholds a staff list when its access audit cannot be recorded', async () => {
    const f = fixture();
    f.audit.recordRead.mockRejectedValue(new Error('Audit unavailable'));
    await expect(f.service.list(admin, { customerId: customer.id }, true)).rejects.toThrow('Audit unavailable');
    expect(f.audit.recordRead).toHaveBeenCalledWith(expect.objectContaining({
      action: 'privacy.list_viewed',
      after: { page: 1, subjectFilter: true, resultCount: 1 },
    }));
  });
  it('refuses stale transitions before adding history or audit entries', async () => {
    const f = fixture();
    await expect(
      f.service.transition(admin, f.row.id, {
        action: 'ASSIGNED',
        version: 2,
        ownerStaffId: admin.id,
      }),
    ).rejects.toMatchObject({ code: 'PRIVACY_VERSION_CONFLICT' });
    expect(f.repository.update).not.toHaveBeenCalled();
    expect(f.repository.event).not.toHaveBeenCalled();
  });
  it('requires nonblank identity evidence and rejects inactive accountable owners', async () => {
    const f = fixture();
    await expect(
      f.service.transition(admin, f.row.id, {
        action: 'VERIFIED',
        version: 1,
        rationale: 'checked',
        evidenceReference: ' ',
      }),
    ).rejects.toMatchObject({ code: 'PRIVACY_INPUT_INVALID' });
    f.repository.owner.mockResolvedValue({ ...admin, isActive: false });
    await expect(
      f.service.transition(admin, f.row.id, {
        action: 'ASSIGNED',
        version: 1,
        ownerStaffId: admin.id,
      }),
    ).rejects.toMatchObject({ code: 'PRIVACY_OWNER_INVALID' });
    expect(f.repository.update).not.toHaveBeenCalled();
  });
  it('records verification evidence privately and audits only minimal metadata', async () => {
    const f = fixture();
    const result = await f.service.transition(admin, f.row.id, {
      action: 'VERIFIED',
      version: 1,
      rationale: 'private rationale',
      evidenceReference: 'restricted register',
    });
    expect(result.status).toBe('VERIFIED');
    expect(f.repository.event).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        evidenceReference: 'restricted register',
        actorStaffId: admin.id,
        action: 'VERIFIED',
        version: 2,
      }),
    );
    expect(JSON.stringify(f.audit.write.mock.calls)).not.toContain(
      'restricted register',
    );
    expect(JSON.stringify(f.audit.write.mock.calls)).not.toContain(
      'private rationale',
    );
  });
  it('refuses affected records outside the trusted customer scope', async () => {
    const f = fixture();
    f.row.status = 'VERIFIED';
    await expect(
      f.service.transition(admin, f.row.id, {
        action: 'DECIDED',
        version: 1,
        rationale: 'checked',
        evidenceReference: 'register',
        decisionReference: 'decision',
        affectedRecords: [{ type: 'CUSTOMER', id: randomUUID() }],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(f.repository.update).not.toHaveBeenCalled();
    expect(f.audit.refusal).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'privacy.record_access_denied',
        entityId: f.row.id,
      }),
    );
  });
  it('does not activate a hold after retention has started', async () => {
    const f = fixture();
    f.repository.get.mockResolvedValue({
      ...f.row,
      status: 'VERIFIED',
      identityVerifiedAt: new Date(),
    });
    f.repository.fence.mockResolvedValue(true);
    await expect(
      f.service.hold(admin, f.row.id, {
        version: 1,
        held: true,
        rationale: 'checked',
        evidenceReference: 'register',
        decisionReference: 'decision',
      }),
    ).rejects.toMatchObject({ code: 'PRIVACY_RETENTION_STARTED' });
    expect(f.repository.update).not.toHaveBeenCalled();
  });
  it('cannot complete a case with an approved hold', async () => {
    const f = fixture();
    f.row.status = 'DECIDED';
    f.row.held = true;
    await expect(
      f.service.transition(admin, f.row.id, {
        action: 'COMPLETED',
        version: 1,
        rationale: 'checked',
        evidenceReference: 'register',
        decisionReference: 'decision',
      }),
    ).rejects.toMatchObject({ code: 'PRIVACY_HOLD_ACTIVE' });
    expect(f.repository.update).not.toHaveBeenCalled();
  });
});
