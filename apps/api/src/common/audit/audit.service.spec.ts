import { describe, expect, it, vi } from 'vitest';
import type { Database, Transaction } from '../../db/database.module.js';
import { AuditService } from './audit.service.js';

function auditService(options: { failTransaction?: boolean } = {}) {
  const values = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn(() => ({ values }));
  const tx = { insert } as unknown as Transaction;
  // `refusal` opens its own transaction, so the fake database hands the same tx back.
  const transaction = vi.fn(async (work: (tx: Transaction) => Promise<unknown>) => {
    if (options.failTransaction) throw new Error('the database is unavailable');
    return work(tx);
  });
  const db = { transaction } as unknown as Database;
  const service = new AuditService(db);
  return { service, tx, values, insert, transaction };
}

describe('AuditService', () => {
  describe('refusal', () => {
    it('records the refusal on its own transaction, so a rollback cannot take it', async () => {
      const { service, values, transaction } = auditService();

      await service.refusal({
        actor: { type: 'INSURER', id: 'staff-1' },
        action: 'access.refused',
        entityType: 'PERMISSION',
        entityId: 'portal:quote:send',
        note: 'POST /insurer/quote-requests/:id/quote',
      });

      expect(transaction, 'not the caller\u2019s transaction, which is about to roll back').toHaveBeenCalledOnce();
      expect(values).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'access.refused', entityId: 'portal:quote:send' }),
      );
    });

    it('swallows a write failure, because a refusal must not become a server error', async () => {
      const { service, values } = auditService({ failTransaction: true });

      await expect(
        service.refusal({
          actor: { type: 'INSURER', id: 'staff-1' },
          action: 'access.refused',
          entityType: 'PERMISSION',
          entityId: 'portal:quote:send',
        }),
      ).resolves.toBeUndefined();
      expect(values).not.toHaveBeenCalled();
    });
  });

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
