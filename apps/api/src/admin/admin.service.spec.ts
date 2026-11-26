import { describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../common/audit/audit.service.js';
import type { Principal } from '../common/auth/auth.types.js';
import type { AdminRepository } from './admin.repository.js';
import { AdminService } from './admin.service.js';

describe('admin audit history', () => {
  it('rejects a cursor with a non-UUID audit entry before querying', async () => {
    const principal: Principal = { kind: 'staff', id: 'admin', email: 'admin@example.invalid', role: 'ADMIN', insurerId: null };
    const repository = { auditLogs: vi.fn().mockResolvedValue([]) };
    const audit = { recordRead: vi.fn() };
    const service = new AdminService(repository as unknown as AdminRepository, audit as unknown as AuditService);
    const cursor = Buffer.from(JSON.stringify({
      createdAt: '2026-11-26T12:00:00.000Z',
      id: 'invalid',
    })).toString('base64url');

    await expect(service.auditLogs(principal, { cursor, limit: 25 })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    expect(repository.auditLogs).not.toHaveBeenCalled();
    expect(audit.recordRead).not.toHaveBeenCalled();
  });
});
