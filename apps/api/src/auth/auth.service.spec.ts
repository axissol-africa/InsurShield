import { AuthService } from './auth.service.js';
import type { NewCustomer } from './auth.repository.js';

interface StoredCustomer extends NewCustomer {
  id: string;
  deletedAt: Date | null;
}

function serviceWith(customers: StoredCustomer[], staff: { keycloakId: string; isActive: boolean }[] = []) {
  const inserted: NewCustomer[] = [];
  const repository = {
    findCustomerByKeycloakId: async (keycloakId: string) =>
      customers.find((customer) => customer.keycloakId === keycloakId),
    insertCustomerIfAbsent: async (customer: NewCustomer) => {
      inserted.push(customer);
      const clash = customers.some(
        (existing) =>
          existing.keycloakId === customer.keycloakId ||
          existing.email === customer.email ||
          existing.phone === customer.phone,
      );
      if (!clash) customers.push({ ...customer, id: `customer-${customers.length + 1}`, deletedAt: null });
    },
    findStaffByKeycloakId: async (keycloakId: string) => {
      const row = staff.find((member) => member.keycloakId === keycloakId);
      return row && { id: 'staff-1', email: '', insurerId: 'insurer-1', isActive: row.isActive };
    },
  };
  return { service: new AuthService(repository as never), inserted };
}

const existing = (overrides: Partial<StoredCustomer> = {}): StoredCustomer => ({
  id: 'customer-1',
  keycloakId: 'kc-1',
  email: 'mwiza@example.test',
  fullName: 'Mwiza Banda',
  phone: 'pending:kc-1',
  deletedAt: null,
  ...overrides,
});

describe('resolving a customer', () => {
  it('returns the existing customer without inserting', async () => {
    const { service, inserted } = serviceWith([existing()]);

    await expect(service.resolveCustomer('kc-1', 'mwiza@example.test', 'Mwiza')).resolves.toEqual({
      kind: 'customer',
      id: 'customer-1',
      email: 'mwiza@example.test',
    });
    expect(inserted).toEqual([]);
  });

  it('creates a customer on first sign-in with a lower-case email and a pending phone', async () => {
    const { service, inserted } = serviceWith([]);

    const principal = await service.resolveCustomer('kc-9', 'New@Example.Test', '');

    expect(principal).toMatchObject({ kind: 'customer', email: 'new@example.test' });
    expect(inserted).toEqual([
      { keycloakId: 'kc-9', email: 'new@example.test', fullName: 'New@Example.Test', phone: 'pending:kc-9' },
    ]);
  });

  it('answers 409 ACCOUNT_CONFLICT when another customer already has the email', async () => {
    const { service } = serviceWith([existing()]);

    await expect(service.resolveCustomer('kc-2', 'mwiza@example.test', 'Someone')).rejects.toMatchObject({
      code: 'ACCOUNT_CONFLICT',
      status: 409,
    });
  });

  it('refuses a closed account', async () => {
    const { service } = serviceWith([existing({ deletedAt: new Date() })]);

    await expect(service.resolveCustomer('kc-1', 'mwiza@example.test', '')).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
  });

  it('refuses a token without an email', async () => {
    const { service } = serviceWith([]);

    await expect(service.resolveCustomer('kc-3', '', '')).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
  });
});

describe('resolving staff', () => {
  it('refuses a staff token with no provisioned row', async () => {
    const { service } = serviceWith([]);

    await expect(service.resolveStaff('kc-staff', 's@example.test', 'ADMIN')).rejects.toMatchObject({ status: 403 });
  });

  it('refuses an inactive staff member', async () => {
    const { service } = serviceWith([], [{ keycloakId: 'kc-staff', isActive: false }]);

    await expect(service.resolveStaff('kc-staff', 's@example.test', 'ADMIN')).rejects.toMatchObject({ status: 403 });
  });

  it('takes the role from the token and falls back to its email', async () => {
    const { service } = serviceWith([], [{ keycloakId: 'kc-staff', isActive: true }]);

    await expect(service.resolveStaff('kc-staff', 's@example.test', 'INSURER_USER')).resolves.toEqual({
      kind: 'staff',
      id: 'staff-1',
      email: 's@example.test',
      role: 'INSURER_USER',
      insurerId: 'insurer-1',
    });
  });
});
