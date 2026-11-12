import type { Principal } from '../common/auth/auth.types.js';
import type { ApprovalRequestRow } from './approval.repository.js';
import { ApprovalService } from './approval.service.js';

const MAKER: Extract<Principal, { kind: 'staff' }> = {
  kind: 'staff', id: '11111111-1111-4111-8111-111111111111', email: 'maker@insurshield.test', role: 'ADMIN', insurerId: null,
};
const CHECKER: Extract<Principal, { kind: 'staff' }> = {
  kind: 'staff', id: '22222222-2222-4222-8222-222222222222', email: 'checker@insurshield.test', role: 'SUPER_ADMIN', insurerId: null,
};

function pending(overrides: Partial<ApprovalRequestRow> = {}): ApprovalRequestRow {
  const now = new Date('2026-11-12T10:00:00.000Z');
  return {
    id: '33333333-3333-4333-8333-333333333333',
    action: 'PIA_FLOOR_CHANGE',
    status: 'PENDING',
    targetType: 'SETTING',
    targetId: 'pia.minimum_rate_bps',
    payload: { piaRatePercentage: 3 },
    requestedByStaffId: MAKER.id,
    requestedReason: 'Apply the published regulatory floor.',
    decidedByStaffId: null,
    decisionReason: null,
    expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    decidedAt: null,
    executedAt: null,
    createdAt: now,
    ...overrides,
  };
}

function serviceWith(repository: Record<string, unknown>, audit: Record<string, unknown> = {}) {
  return new ApprovalService(repository as never, { write: vi.fn(), ...audit } as never);
}

describe('ApprovalService', () => {
  it('refuses a maker approving their own high-risk action before executing it', async () => {
    const request = pending();
    const execute = vi.fn();
    const service = serviceWith({
      transaction: async (work: (tx: unknown) => Promise<unknown>) => work('tx'),
      expirePending: vi.fn(),
      lock: async () => request,
    });

    await expect(service.approve(request.id, MAKER, undefined, execute)).rejects.toMatchObject({ status: 403 });
    expect(execute).not.toHaveBeenCalled();
  });

  it('executes the protected operation and marks the approval in the same transaction', async () => {
    const request = pending();
    const auditWrite = vi.fn();
    const execute = vi.fn();
    const marked = pending({
      status: 'EXECUTED', decidedByStaffId: CHECKER.id, decisionReason: 'Evidence and request checked.',
      decidedAt: new Date('2026-11-12T10:01:00.000Z'), executedAt: new Date('2026-11-12T10:01:00.000Z'),
    });
    const service = serviceWith({
      transaction: async (work: (tx: unknown) => Promise<unknown>) => work('transaction'),
      expirePending: vi.fn(),
      lock: async () => request,
      markExecuted: async () => marked,
    }, { write: auditWrite });

    await expect(service.approve(request.id, CHECKER, 'Evidence and request checked.', execute)).resolves.toMatchObject({
      id: request.id, status: 'EXECUTED', decidedByStaffId: CHECKER.id,
    });

    expect(execute).toHaveBeenCalledWith('transaction', request);
    expect(auditWrite).toHaveBeenCalledWith('transaction', expect.objectContaining({
      action: 'approval.executed', entityId: request.id, correlationId: request.id,
    }));
  });

  it('does not mark a decision when business revalidation rejects the frozen request', async () => {
    const request = pending();
    const markExecuted = vi.fn();
    const service = serviceWith({
      transaction: async (work: (tx: unknown) => Promise<unknown>) => work('tx'),
      expirePending: vi.fn(),
      lock: async () => request,
      markExecuted,
    });

    await expect(service.approve(request.id, CHECKER, undefined, async () => {
      throw new Error('The insurer evidence expired while this request was pending.');
    })).rejects.toThrow('The insurer evidence expired while this request was pending.');
    expect(markExecuted).not.toHaveBeenCalled();
  });
});
