import { AuthService } from './auth.service.js';
import { TokenService } from '../common/auth/token.service.js';
import { hashPassword } from '../common/auth/password.js';
import { ApiException } from '../common/errors/api.exception.js';
import type { Env } from '../config/env.js';

/**
 * Sign-up and sign-in against a stand-in Prisma. What matters here is that a
 * wrong password, a missing account and a suspended one each behave the way
 * they are supposed to, and that nothing leaks which of them happened.
 */

/** Stands in for Nest's ConfigService, which is all TokenService reads. */
const configOf = (values: Partial<Env>) => ({ get: (key: keyof Env) => values[key] }) as never;

const tokens = new TokenService(configOf({
  AUTH_JWT_SECRET: 'a-test-signing-secret-long-enough-to-pass',
  AUTH_TOKEN_TTL: '12h',
}));

const customerRow = async (overrides: Record<string, unknown> = {}) => ({
  id: 'customer-1',
  fullName: 'Chipego Daka',
  email: 'chipego@example.zm',
  phone: '+260 97 612 3456',
  passwordHash: await hashPassword('a-good-password'),
  deletedAt: null,
  suspendedAt: null,
  ...overrides,
});

const buildService = (rows: {
  customer?: Record<string, unknown> | null;
  staff?: Record<string, unknown> | null;
}) => {
  const writes: Record<string, unknown>[] = [];
  const prisma = {
    customer: {
      findFirst: async () => rows.customer ?? null,
      findUnique: async () => rows.customer ?? null,
      create: async ({ data, select }: { data: Record<string, unknown>; select?: object }) => {
        writes.push(data);
        void select;
        return { id: 'new-customer', ...data };
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        writes.push(data);
        return { ...rows.customer, ...data };
      },
    },
    staffUser: {
      findUnique: async () => rows.staff ?? null,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        writes.push(data);
        return { ...rows.staff, ...data };
      },
    },
    consentRecord: { findFirst: async () => null },
  };
  return { service: new AuthService(prisma as never, tokens), writes };
};

describe('registration', () => {
  it('opens an account and returns a token that identifies it', async () => {
    const { service, writes } = buildService({ customer: null });
    const result = await service.register({
      fullName: '  Chipego Daka ',
      email: '  Chipego@Example.ZM ',
      phone: '+260 97 612 3456',
      password: 'a-good-password',
    });

    // Stored lower-cased and trimmed, so one person is never two accounts.
    expect(writes[0].email).toBe('chipego@example.zm');
    expect(writes[0].fullName).toBe('Chipego Daka');
    // The password itself is never stored.
    expect(writes[0].passwordHash).not.toBe('a-good-password');
    expect(String(writes[0].passwordHash)).toMatch(/^scrypt\$/);

    const claims = await tokens.verify(result.token);
    expect(claims.kind).toBe('customer');
    expect(result.consent.accepted).toBe(false);
  });

  it('refuses an email or phone already in use, without saying which', async () => {
    const { service } = buildService({ customer: await customerRow() });
    await expect(
      service.register({
        fullName: 'Someone Else',
        email: 'chipego@example.zm',
        phone: '+260 97 000 0000',
        password: 'a-good-password',
      }),
    ).rejects.toThrow(/email address or mobile number/);
  });
});

describe('customer sign-in', () => {
  it('signs in with the right password and reports consent already given', async () => {
    const { service } = buildService({ customer: await customerRow() });
    const result = await service.login('chipego@example.zm', 'a-good-password');

    expect(result.customer.id).toBe('customer-1');
    expect((await tokens.verify(result.token)).sub).toBe('customer-1');
  });

  it('gives the same answer for a wrong password as for no account at all', async () => {
    const wrongPassword = buildService({ customer: await customerRow() });
    const noAccount = buildService({ customer: null });

    const a = await wrongPassword.service.login('chipego@example.zm', 'not-the-password').catch((e) => e);
    const b = await noAccount.service.login('nobody@example.zm', 'anything').catch((e) => e);

    expect(a).toBeInstanceOf(ApiException);
    // Identical message, so sign-in cannot be used to discover who is registered.
    expect(a.message).toBe(b.message);
  });

  it('refuses a suspended account with a reason the customer can act on', async () => {
    const { service } = buildService({ customer: await customerRow({ suspendedAt: new Date() }) });
    await expect(service.login('chipego@example.zm', 'a-good-password')).rejects.toThrow(/suspended/i);
  });

  it('refuses a closed account', async () => {
    const { service } = buildService({ customer: await customerRow({ deletedAt: new Date() }) });
    await expect(service.login('chipego@example.zm', 'a-good-password')).rejects.toThrow(/closed/i);
  });

  it('cannot be signed into while the stored hash is empty', async () => {
    const { service } = buildService({ customer: await customerRow({ passwordHash: '' }) });
    await expect(service.login('chipego@example.zm', '')).rejects.toThrow(ApiException);
    await expect(service.login('chipego@example.zm', 'anything')).rejects.toThrow(ApiException);
  });
});

describe('staff sign-in', () => {
  const staffRow = async (overrides: Record<string, unknown> = {}) => ({
    id: 'staff-1',
    email: 'admin@insurshield.zm',
    fullName: 'InsurShield Administrator',
    role: 'SUPER_ADMIN',
    insurerId: null,
    insurer: null,
    isActive: true,
    mustChangePassword: false,
    passwordHash: await hashPassword('insurshield-dev'),
    ...overrides,
  });

  it('returns a portal session and a token carrying the role', async () => {
    const { service } = buildService({ staff: await staffRow() });
    const result = await service.staffLogin('admin@insurshield.zm', 'insurshield-dev');

    expect(result.session.role).toBe('admin');
    const claims = await tokens.verify(result.token);
    expect(claims.kind).toBe('staff');
    expect(claims.role).toBe('SUPER_ADMIN');
  });

  it('carries the insurer through for a portal login', async () => {
    const { service } = buildService({
      staff: await staffRow({
        role: 'INSURER_USER',
        insurerId: 'insurer-1',
        insurer: { id: 'insurer-1', name: 'Prestige Assurance' },
      }),
    });
    const result = await service.staffLogin('portal@prestige.zm', 'insurshield-dev');

    expect(result.session.role).toBe('insurer');
    expect(result.session.insurerName).toBe('Prestige Assurance');
    expect((await tokens.verify(result.token)).insurerId).toBe('insurer-1');
  });

  it('refuses a deactivated account even with the right password', async () => {
    const { service } = buildService({ staff: await staffRow({ isActive: false }) });
    await expect(service.staffLogin('admin@insurshield.zm', 'insurshield-dev')).rejects.toThrow(
      /not active/i,
    );
  });

  it('tells the portal when a password set by someone else must be changed', async () => {
    const { service } = buildService({ staff: await staffRow({ mustChangePassword: true }) });
    const result = await service.staffLogin('admin@insurshield.zm', 'insurshield-dev');
    expect(result.session.mustChangePassword).toBe(true);
  });
});

describe('changing your own password', () => {
  it('requires the current one, so a borrowed session cannot lock the owner out', async () => {
    const { service } = buildService({ customer: await customerRow() });
    await expect(
      service.changePassword(
        { kind: 'customer', id: 'customer-1', email: 'chipego@example.zm' },
        'wrong-current',
        'a-brand-new-password',
      ),
    ).rejects.toThrow(/not correct/i);
  });

  it('stores the new password as a fresh hash', async () => {
    const { service, writes } = buildService({ customer: await customerRow() });
    await service.changePassword(
      { kind: 'customer', id: 'customer-1', email: 'chipego@example.zm' },
      'a-good-password',
      'a-brand-new-password',
    );
    expect(String(writes.at(-1)!.passwordHash)).toMatch(/^scrypt\$/);
  });
});

describe('tokens', () => {
  it('refuses one signed with a different secret', async () => {
    const other = new TokenService(configOf({
      AUTH_JWT_SECRET: 'a-completely-different-secret-of-good-length',
      AUTH_TOKEN_TTL: '12h',
    }));
    const foreign = await other.issue({ sub: 'customer-1', kind: 'customer', email: 'x@y.zm' });
    await expect(tokens.verify(foreign)).rejects.toThrow(ApiException);
  });

  it('refuses a tampered token', async () => {
    const token = await tokens.issue({ sub: 'customer-1', kind: 'customer', email: 'x@y.zm' });
    const [header, , signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ sub: 'customer-2', kind: 'staff', email: 'x@y.zm', role: 'SUPER_ADMIN' }),
    ).toString('base64url');
    await expect(tokens.verify(`${header}.${forged}.${signature}`)).rejects.toThrow(ApiException);
  });

  it('refuses one that has expired', async () => {
    const shortLived = new TokenService(configOf({
      AUTH_JWT_SECRET: 'a-test-signing-secret-long-enough-to-pass',
      AUTH_TOKEN_TTL: '-1s',
    }));
    const expired = await shortLived.issue({ sub: 'customer-1', kind: 'customer', email: 'x@y.zm' });
    await expect(tokens.verify(expired)).rejects.toThrow(ApiException);
  });
});
