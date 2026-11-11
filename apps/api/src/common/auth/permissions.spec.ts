import { describe, expect, it } from 'vitest';
import { INSURER_ROLES, INSURSHIELD_ROLES } from '../domain/enums.js';
import { PERMISSIONS, holds, type Grantee, type Permission } from './permissions.js';

const ALL = Object.keys(PERMISSIONS) as Permission[];
/**
 * The table read without its literal types. `as const` makes each grant's
 * length a literal, so a check for an empty one is unreachable to the compiler
 * and the test could never fail; widening here keeps it honest.
 */
const TABLE: Record<string, readonly Grantee[]> = PERMISSIONS;
const heldBy = (grantee: Grantee) => ALL.filter((permission) => TABLE[permission].includes(grantee));
const granteesOf = (permission: Permission) => TABLE[permission];

/**
 * Held by every caller on purpose. Reaching a record is the services' business:
 * these only say the function exists. Who may see a given document is decided
 * by `documents`, and the vehicle registry answers everybody the same way.
 */
const SHARED_WITH_EVERYONE: Permission[] = [
  'session:read',
  'document:upload',
  'document:read',
  'vehicle:lookup',
];

describe('the permission table', () => {
  it('grants every permission to somebody', () => {
    const unheld = ALL.filter((permission) => TABLE[permission].length === 0);

    expect(unheld, 'a permission nobody holds makes its route unreachable').toEqual([]);
  });

  it('keeps InsurShield functions away from insurer staff', () => {
    const insurShieldOnly = ALL.filter(
      (permission) =>
        !SHARED_WITH_EVERYONE.includes(permission) &&
        granteesOf(permission).some((grantee) =>
          (INSURSHIELD_ROLES as readonly string[]).includes(grantee),
        ),
    );
    const leaked = insurShieldOnly.filter((permission) =>
      granteesOf(permission).some((grantee) =>
        (INSURER_ROLES as readonly string[]).includes(grantee),
      ),
    );

    expect(leaked, 'an insurer role reaching an InsurShield function').toEqual([]);
  });

  it('keeps the insurer portal away from InsurShield staff', () => {
    const portal = ALL.filter((permission) => permission.startsWith('portal:'));
    const leaked = portal.filter((permission) =>
      granteesOf(permission).some((grantee) =>
        (INSURSHIELD_ROLES as readonly string[]).includes(grantee),
      ),
    );

    expect(leaked, 'batch 8 gives InsurShield staff their own routes rather than the insurer ones').toEqual([]);
  });

  it('gives a customer nothing that belongs to staff', () => {
    const customerHeld = heldBy('customer').filter((permission) => !SHARED_WITH_EVERYONE.includes(permission));
    const staffShaped = customerHeld.filter(
      (permission) =>
        permission.startsWith('portal:') || permission.startsWith('admin:') || permission.startsWith('insurer:'),
    );

    expect(staffShaped).toEqual([]);
  });

  it('lets every insurer role through the portal front door', () => {
    for (const role of INSURER_ROLES) {
      expect(holds({ kind: 'staff', id: 's', email: 'e', role, insurerId: 'i' }, 'portal:profile:read'), role).toBe(
        true,
      );
    }
  });

  it('never leaves a super administrator less able than an administrator', () => {
    const missing = heldBy('ADMIN').filter((permission) => !heldBy('SUPER_ADMIN').includes(permission));

    expect(missing).toEqual([]);
  });

  it('gives the compliance reader exactly the reads, and nothing that changes anything', () => {
    expect(heldBy('COMPLIANCE_READ_ONLY').sort()).toEqual(
      [
        'document:read',
        'document:upload',
        'portal:claim:read',
        'portal:ncd:read',
        'portal:policy:read',
        'portal:profile:read',
        'portal:request:read',
        'session:read',
        'vehicle:lookup',
      ].sort(),
    );
  });

  it('gives support the operational queues to read and nothing to decide', () => {
    expect(heldBy('SUPPORT').sort()).toEqual(
      [
        'document:read',
        'document:upload',
        'portal:claim:read',
        'portal:ncd:read',
        'portal:policy:read',
        'portal:profile:read',
        'portal:request:read',
        'session:read',
        'vehicle:lookup',
      ].sort(),
    );
  });

  it('separates quoting from claims, so neither officer can do the other job', () => {
    const quoteOfficer = heldBy('QUOTE_OFFICER');
    const claimsOfficer = heldBy('CLAIMS_OFFICER');

    expect(quoteOfficer).toContain('portal:quote:send');
    expect(quoteOfficer).not.toContain('portal:claim:acknowledge');
    expect(quoteOfficer).not.toContain('portal:ncd:decide');
    expect(claimsOfficer).toContain('portal:claim:acknowledge');
    expect(claimsOfficer).toContain('portal:ncd:decide');
    expect(claimsOfficer).not.toContain('portal:quote:send');
    expect(claimsOfficer).not.toContain('portal:quote:extend');
  });

  it('keeps removing and restoring an insurer with the super administrator alone', () => {
    for (const permission of ['insurer:delete', 'insurer:restore'] as const) {
      expect(granteesOf(permission)).toEqual(['SUPER_ADMIN']);
    }
  });
});

describe('holds', () => {
  it('reads a customer as the customer grantee', () => {
    const customer = { kind: 'customer', id: 'c', email: 'e', emailVerified: true } as const;

    expect(holds(customer, 'quote-request:submit')).toBe(true);
    expect(holds(customer, 'admin:overview')).toBe(false);
  });

  it('reads staff by their role', () => {
    const financeStaff = { kind: 'staff', id: 's', email: 'e', role: 'FINANCE', insurerId: 'i' } as const;

    expect(holds(financeStaff, 'portal:policy:read')).toBe(true);
    expect(holds(financeStaff, 'portal:quote:send')).toBe(false);
  });
});
