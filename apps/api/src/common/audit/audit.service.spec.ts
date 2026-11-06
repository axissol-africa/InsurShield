import { describe, expect, it, vi } from 'vitest';
import type { Transaction } from '../../db/database.module.js';
import { AuditService } from './audit.service.js';

function auditService() {
  const values = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn(() => ({ values }));
  const tx = { insert } as unknown as Transaction;
  const service = new AuditService();
  return { service, tx, values, insert };
}

describe('AuditService', () => {
  it('stores only safe, scalar audit snapshots', async () => {
    const { service, tx, values } = auditService();

    await service.write(tx, {
      actor: { type: 'CUSTOMER', id: 'customer-1' },
      action: 'quote_request.created',
      entityType: 'QUOTE_REQUEST',
      entityId: 'request-1',
      after: {
        status: 'SUBMITTED',
        vehicleValueMinor: 4000000,
        email: 'must-not-be-stored@example.invalid',
        phone: '+260970000000',
        providerReference: 'private-provider-reference',
        nested: { secret: 'also unsafe' },
      },
    });

    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      after: { status: 'SUBMITTED', vehicleValueMinor: 4000000 },
    }));
  });

  it('records a state row and matching audit summary in the caller transaction', async () => {
    const { service, tx, values, insert } = auditService();

    await service.transition(tx, {
      actor: { type: 'INSURER', id: 'staff-1' },
      entityType: 'POLICY',
      entityId: 'POL-1',
      fromStatus: 'AWAITING_INSURER_CERTIFICATE',
      toStatus: 'ACTIVE',
      note: 'Certificate issued.',
      correlationId: 'payment-1',
    });

    expect(insert).toHaveBeenCalledTimes(2);
    expect(values).toHaveBeenNthCalledWith(1, expect.objectContaining({
      entityType: 'POLICY', entityId: 'POL-1', fromStatus: 'AWAITING_INSURER_CERTIFICATE', toStatus: 'ACTIVE',
    }));
    expect(values).toHaveBeenNthCalledWith(2, expect.objectContaining({
      action: 'policy.status_changed', before: { status: 'AWAITING_INSURER_CERTIFICATE' }, after: { status: 'ACTIVE' },
    }));
  });
});
