import { UsersService } from './users.service.js';
import { ApiException } from '../common/errors/api.exception.js';
import type { Principal } from '../common/auth/auth.types.js';

/**
 * The rules that stop an administrator doing damage with a single click:
 * locking themselves out, removing the last way back in, or creating an
 * insurer login that can see every insurer's work.
 */

const ADMIN: Principal = { kind: 'staff', id: 'admin-1', email: 'a@b.zm', role: 'SUPER_ADMIN', insurerId: null };

const staffRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'staff-2',
  email: 'joy@insurshield.zm',
  fullName: 'Joy Phiri',
  role: 'ADMIN',
  insurerId: null,
  insurer: null,
  isActive: true,
  mustChangePassword: false,
  lastLoginAt: null,
  createdAt: new Date(),
  ...overrides,
});

/** Applies a Prisma `select` the way the real client would, so a test can
 *  tell the difference between a field that is withheld and one that is not. */
const applySelect = (row: Record<string, unknown>, select?: Record<string, unknown>) =>
  select ? Object.fromEntries(Object.keys(select).filter((k) => k in row).map((k) => [k, row[k]])) : row;

const buildService = (opts: {
  /** The row loaded by id — what update/deactivate/reset act on. */
  staff?: Record<string, unknown> | null;
  /** Whether the email given to `createStaff` is already taken. */
  emailTaken?: boolean;
  otherAdmins?: number;
  insurer?: { id: string } | null;
} = {}) => {
  const writes: Record<string, unknown>[] = [];
  const prisma = {
    staffUser: {
      findMany: async () => [staffRow()],
      // A lookup by email is the duplicate check; by id it loads the account.
      findUnique: async ({ where }: { where: { id?: string; email?: string } }) =>
        where.email
          ? (opts.emailTaken ? staffRow() : null)
          : (opts.staff === undefined ? staffRow() : opts.staff),
      count: async () => opts.otherAdmins ?? 1,
      create: async ({ data, select }: { data: Record<string, unknown>; select?: Record<string, unknown> }) => {
        writes.push(data);
        return applySelect(staffRow(data), select);
      },
      update: async ({ data, select }: { data: Record<string, unknown>; select?: Record<string, unknown> }) => {
        writes.push(data);
        return applySelect(staffRow(data), select);
      },
    },
    insurer: { findUnique: async () => (opts.insurer === undefined ? { id: 'insurer-1' } : opts.insurer) },
    customer: { findMany: async () => [], findUnique: async () => null, update: async () => ({}) },
  };
  return { service: new UsersService(prisma as never), writes };
};

describe('creating a staff account', () => {
  it('generates a temporary password when none is given, and returns it once', async () => {
    const { service, writes } = buildService();
    const result = await service.createStaff({
      email: '  Joy@InsurShield.ZM ',
      fullName: ' Joy Phiri ',
      role: 'ADMIN' as never,
    });

    expect(result.temporaryPassword).toMatch(/^[a-z]{4}-[a-z]{4}-\d{2}$/);
    expect(writes[0].email).toBe('joy@insurshield.zm');
    expect(String(writes[0].passwordHash)).toMatch(/^scrypt\$/);
    // A password someone else chose must be replaced by its owner.
    expect(writes[0].mustChangePassword).toBe(true);
  });

  it('never returns the stored hash to the console', async () => {
    const { service } = buildService();
    const result = await service.createStaff({
      email: 'joy@insurshield.zm',
      fullName: 'Joy Phiri',
      role: 'ADMIN' as never,
    });
    expect(result.staff).not.toHaveProperty('passwordHash');
  });

  it('refuses an insurer login with no insurer chosen', async () => {
    const { service } = buildService();
    await expect(
      service.createStaff({
        email: 'portal@prestige.zm',
        fullName: 'Prestige portal',
        role: 'INSURER_USER' as never,
      }),
    ).rejects.toThrow(/Choose the insurer/);
  });

  it('drops any insurer set on a role that is not an insurer login', async () => {
    const { service, writes } = buildService();
    await service.createStaff({
      email: 'joy@insurshield.zm',
      fullName: 'Joy Phiri',
      role: 'ADMIN' as never,
      insurerId: 'insurer-1',
    });
    expect(writes[0].insurerId).toBeNull();
  });

  it('refuses an email already in use', async () => {
    const { service } = buildService({ emailTaken: true });
    await expect(
      service.createStaff({ email: 'joy@insurshield.zm', fullName: 'Joy', role: 'ADMIN' as never }),
    ).rejects.toThrow(/already uses/);
  });
});

describe('guard rails', () => {
  it('will not let an administrator deactivate themselves', async () => {
    const { service } = buildService();
    await expect(service.deactivateStaff('admin-1', ADMIN)).rejects.toThrow(/your own account/);
    await expect(
      service.updateStaff('admin-1', { isActive: false }, ADMIN),
    ).rejects.toThrow(/your own account/);
  });

  it('will not let an administrator change their own role', async () => {
    const { service } = buildService();
    await expect(
      service.updateStaff('admin-1', { role: 'INSURER_USER' as never }, ADMIN),
    ).rejects.toThrow(/your own role/);
  });

  it('refuses to deactivate the last administrator', async () => {
    const { service } = buildService({ otherAdmins: 0 });
    await expect(service.deactivateStaff('staff-2', ADMIN)).rejects.toThrow(/only active administrator/);
  });

  it('refuses to demote the last administrator out of the role', async () => {
    const { service } = buildService({ staff: staffRow({ role: 'SUPER_ADMIN' }), otherAdmins: 0 });
    await expect(
      service.updateStaff('staff-2', { role: 'INSURER_USER' as never, insurerId: 'insurer-1' }, ADMIN),
    ).rejects.toThrow(/only active administrator/);
  });

  it('allows it once another administrator exists', async () => {
    const { service } = buildService({ otherAdmins: 1 });
    await expect(service.deactivateStaff('staff-2', ADMIN)).resolves.toBeDefined();
  });

  it('deactivates rather than deletes, so the history the account touched stands', async () => {
    const { service, writes } = buildService({ otherAdmins: 2 });
    await service.deactivateStaff('staff-2', ADMIN);
    expect(writes.at(-1)).toEqual({ isActive: false });
  });

  it('reports an unknown account rather than failing silently', async () => {
    const { service } = buildService({ staff: null });
    await expect(service.deactivateStaff('nobody', ADMIN)).rejects.toThrow(ApiException);
    await expect(service.resetStaffPassword('nobody')).rejects.toThrow(ApiException);
  });
});

describe('resetting a staff password', () => {
  it('issues a new temporary password and forces a change at sign-in', async () => {
    const { service, writes } = buildService();
    const result = await service.resetStaffPassword('staff-2');

    expect(result.temporaryPassword).toMatch(/^[a-z]{4}-[a-z]{4}-\d{2}$/);
    expect(writes.at(-1)!.mustChangePassword).toBe(true);
    expect(String(writes.at(-1)!.passwordHash)).toMatch(/^scrypt\$/);
  });
});
