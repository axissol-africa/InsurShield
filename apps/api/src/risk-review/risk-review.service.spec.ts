import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { AuditService } from '../common/audit/audit.service.js';
import type { Principal } from '../common/auth/auth.types.js';
import { RiskReviewRepository } from './risk-review.repository.js';
import { RiskReviewService } from './risk-review.service.js';
const admin: Principal = { kind: 'staff', id: '10000000-0000-4000-8000-000000000001', email: 'admin@example.invalid', role: 'ADMIN', insurerId: null };
const repository = { list: vi.fn(), transaction: vi.fn() };
let service: RiskReviewService;
beforeEach(async () => {
  vi.clearAllMocks();
  const module = await Test.createTestingModule({ providers: [RiskReviewService,
    { provide: RiskReviewRepository, useValue: repository }, { provide: AuditService, useValue: { write: vi.fn() } },
  ] }).compile();
  service = module.get(RiskReviewService);
});
it('enforces authorization on internal service calls before touching records', async () => {
  const principals: Principal[] = [
    { kind: 'customer', id: admin.id, email: admin.email, emailVerified: true },
    { ...admin, role: 'INSURER_ADMIN', insurerId: admin.id },
    { ...admin, insurerId: admin.id },
  ];
  for (const principal of principals) {
    await expect(service.list(principal, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.refer(principal, { workflowType: 'QUOTE', workflowId: admin.id, evidenceReference: `quote:${admin.id}`, severity: 'HIGH', reason: 'Manual investigation required', nextAction: 'Review quote' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.assign(principal, admin.id, { expectedVersion: 1, staffId: null, nextAction: 'Review quote' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.resolve(principal, admin.id, { expectedVersion: 1, outcome: 'NO_ACTION', reason: 'Manual investigation complete', nextAction: 'Close review' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  }
  expect(repository.list).not.toHaveBeenCalled();
  expect(repository.transaction).not.toHaveBeenCalled();
});
it('rejects unrelated evidence before starting a transaction', async () => {
  await expect(service.refer(admin, { workflowType: 'QUOTE', workflowId: admin.id, evidenceReference: `reconciliation:${admin.id}`, severity: 'LOW', reason: 'Manual review requested', nextAction: 'Review quote' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  expect(repository.transaction).not.toHaveBeenCalled();
});
it('enforces the page bound for internal callers too', async () => {
  for (const limit of [0, 101, 1.5, NaN]) await expect(service.list(admin, { limit })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  repository.list.mockResolvedValue([]);
  expect(await service.list(admin, {})).toEqual({ items: [], next: null });
});
