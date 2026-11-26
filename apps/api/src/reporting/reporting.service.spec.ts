import { Test } from '@nestjs/testing';
import { AuditService } from '../common/audit/audit.service.js';
import type { Principal } from '../common/auth/auth.types.js';
import { ReportingRepository } from './reporting.repository.js';
import { ReportingService } from './reporting.service.js';

const principal: Principal = { kind: 'staff', id: 'staff-id', email: 'private@example.invalid', role: 'INSURER_ADMIN', insurerId: 'trusted-insurer' };
const query = { from: '2026-09-01', to: '2026-09-30' };

describe('report generation authorization and audit', () => {
  const transaction = {};
  const repository = {
    snapshot: vi.fn(async (work: (tx: object) => Promise<unknown>) => work(transaction)),
    dataAsOf: vi.fn(async () => '2026-10-01T00:00:00.000Z'),
    operations: vi.fn(async () => []), finance: vi.fn(async () => []),
  };
  const audit = { write: vi.fn(async () => {}) };
  let service: ReportingService;
  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await Test.createTestingModule({ providers: [ReportingService,
      { provide: ReportingRepository, useValue: repository }, { provide: AuditService, useValue: audit },
    ] }).compile();
    service = module.get(ReportingService);
  });
  it('uses only the trusted insurer and audits the exact permission, filters and actor in the snapshot', async () => {
    const result = await service.generate(principal, 'finance', 'insurer', { ...query, insurerId: 'attacker' } as typeof query, 'csv');
    expect(repository.finance).toHaveBeenCalledWith(transaction, expect.objectContaining(query), 'trusted-insurer');
    expect(audit.write).toHaveBeenCalledWith(transaction, expect.objectContaining({
      actor: { type: 'INSURER', id: 'staff-id' }, action: 'report.exported', entityId: result.report.reportId,
      after: expect.objectContaining({ ...query, permission: 'portal:reports:finance', format: 'csv', insurerId: 'trusted-insurer', timeZone: 'Africa/Lusaka' }),
    }));
    expect(JSON.stringify(result)).not.toContain('private@example.invalid');
    expect(result.report.limitations.join(' ')).toContain('DEC-013 commercial model is not approved');
  });
  it.each(['QUOTE_OFFICER', 'CLAIMS_OFFICER', 'COMPLIANCE_READ_ONLY', 'SUPPORT', 'INSURER_USER'] as const)('refuses finance to %s even when called internally', async (role) => {
    await expect(service.generate({ ...principal, role }, 'finance', 'insurer', query)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(repository.snapshot).not.toHaveBeenCalled();
  });
  it('refuses unlinked staff, customers, insurer access to platform and platform access to insurer', async () => {
    for (const caller of [
      { ...principal, insurerId: null },
      { kind: 'customer', id: 'customer', email: 'customer@example.invalid', emailVerified: true } as const,
      { ...principal, role: 'ADMIN' as const, insurerId: null },
    ]) await expect(service.generate(caller, 'operations', 'insurer', query)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.generate(principal, 'operations', 'platform', query)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(repository.snapshot).not.toHaveBeenCalled();
  });
  it('rejects invalid periods before reading data', async () => {
    await expect(service.generate(principal, 'operations', 'insurer', { ...query, to: '2026-02-30' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(repository.snapshot).not.toHaveBeenCalled();
  });
  it('fails closed when the audit cannot be recorded', async () => {
    audit.write.mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(service.generate(principal, 'operations', 'insurer', query)).rejects.toThrow('audit unavailable');
  });
});
