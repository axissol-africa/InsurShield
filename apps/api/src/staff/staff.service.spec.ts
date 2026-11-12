import type { Principal } from '../common/auth/auth.types.js';
import { StaffService } from './staff.service.js';
import type { StaffRow } from './staff.repository.js';

const INSURER_ADMIN: Principal = {
  kind: 'staff',
  id: 'staff-admin',
  email: 'admin@insurer.test',
  role: 'INSURER_ADMIN',
  insurerId: '11111111-1111-4111-8111-111111111111',
};

const PLATFORM_ADMIN: Principal = {
  kind: 'staff',
  id: 'staff-platform',
  email: 'admin@insurshield.test',
  role: 'ADMIN',
  insurerId: null,
};

const target = (changes: Partial<StaffRow> = {}): StaffRow => ({
  id: '22222222-2222-4222-8222-222222222222',
  email: 'officer@insurer.test',
  fullName: 'Quote Officer',
  role: 'QUOTE_OFFICER',
  insurerId: INSURER_ADMIN.insurerId,
  isActive: true,
  teamId: null,
  userId: '33333333-3333-4333-8333-333333333333',
  lastLoginAt: null,
  createdAt: new Date('2026-11-12T08:00:00.000Z'),
  updatedAt: new Date('2026-11-12T08:00:00.000Z'),
  team: null,
  insurerName: 'Prestige Assurance',
  ...changes,
});

function serviceWith(repository: Record<string, unknown>) {
  return new StaffService(
    repository as never,
    { write: vi.fn() } as never,
    { revokeSessions: vi.fn() } as never,
    { api: { requestPasswordReset: vi.fn() } } as never,
    { CORS_ORIGINS: ['https://app.insurshield.test'] } as never,
  );
}

describe('staff access management', () => {
  it('refuses an insurer administrator trying to grant an InsurShield role before it writes anything', async () => {
    const transaction = vi.fn(async (work: (tx: unknown) => Promise<unknown>) => work({}));
    const service = serviceWith({ transaction });

    await expect(
      service.createUser(INSURER_ADMIN, {
        email: 'new.person@example.test',
        fullName: 'New Person',
        role: 'ADMIN',
        reason: 'Trying to change platform administration.',
      }),
    ).rejects.toMatchObject({ status: 403, response: { code: 'FORBIDDEN' } });
  });

  it('answers as absent when an insurer administrator reaches another insurer staff record', async () => {
    const lockStaff = vi.fn(async () => target({ insurerId: '44444444-4444-4444-8444-444444444444' }));
    const service = serviceWith({ transaction: async (work: (tx: unknown) => Promise<unknown>) => work({}), lockStaff });

    await expect(
      service.updateUser(INSURER_ADMIN, target().id, { isActive: false, reason: 'No longer employed.' }),
    ).rejects.toMatchObject({ status: 404, response: { code: 'NOT_FOUND' } });
  });

  it('revokes every session in the same transaction when a staff account is deactivated', async () => {
    const before = target();
    const after = target({ isActive: false, updatedAt: new Date('2026-11-12T09:00:00.000Z') });
    const revokeSessions = vi.fn();
    const auditWrite = vi.fn();
    const updateStaff = vi.fn(async () => ({ id: before.id }));
    const service = new StaffService(
      {
        transaction: async (work: (tx: unknown) => Promise<unknown>) => work('transaction'),
        lockStaff: async () => before,
        updateStaff,
        findStaff: async () => after,
      } as never,
      { write: auditWrite } as never,
      { revokeSessions } as never,
      { api: { requestPasswordReset: vi.fn() } } as never,
      { CORS_ORIGINS: ['https://app.insurshield.test'] } as never,
    );

    await expect(service.updateUser(INSURER_ADMIN, before.id, {
      isActive: false,
      reason: 'The employment relationship ended.',
    })).resolves.toMatchObject({ id: before.id, isActive: false });

    expect(revokeSessions).toHaveBeenCalledWith('transaction', before.userId);
    expect(updateStaff).toHaveBeenCalledWith('transaction', before.id, expect.objectContaining({ isActive: false }));
    expect(auditWrite).toHaveBeenCalledWith('transaction', expect.objectContaining({
      action: 'staff.status_changed',
      entityId: before.id,
      note: 'The employment relationship ended.',
      before: expect.objectContaining({ isActive: true }),
      after: expect.objectContaining({ isActive: false }),
    }));
  });

  it('refuses an administrator from granting the super administrator role', async () => {
    const transaction = vi.fn(async (work: (tx: unknown) => Promise<unknown>) => work({}));
    const service = serviceWith({ transaction });

    await expect(
      service.createUser(PLATFORM_ADMIN, {
        email: 'new.admin@example.test',
        fullName: 'New Admin',
        role: 'SUPER_ADMIN',
        reason: 'Trying to create a super administrator.',
      }),
    ).rejects.toMatchObject({ status: 403, response: { code: 'FORBIDDEN' } });
  });
});
