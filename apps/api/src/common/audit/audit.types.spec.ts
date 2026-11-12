import { describe, expect, it } from 'vitest';
import type { Principal, StaffRoleName } from '../auth/auth.types.js';
import { INSURER_ROLES, INSURSHIELD_ROLES, STAFF_ROLES } from '../domain/enums.js';
import { auditActor, systemActor } from './audit.types.js';

const staff = (role: StaffRoleName): Principal => ({
  kind: 'staff',
  id: 'staff-1',
  email: 'someone@example.invalid',
  role,
  insurerId: 'insurer-1',
});

describe('auditActor', () => {
  it('attributes an insurer role to the insurer, not to InsurShield', () => {
    for (const role of INSURER_ROLES) {
      expect(auditActor(staff(role)), role).toEqual({ type: 'INSURER', id: 'staff-1' });
    }
  });

  it('attributes an InsurShield role to InsurShield', () => {
    for (const role of INSURSHIELD_ROLES) {
      expect(auditActor(staff(role)), role).toEqual({ type: 'STAFF', id: 'staff-1' });
    }
  });

  it('decides every role the system defines, so a new one cannot default quietly', () => {
    for (const role of STAFF_ROLES) {
      expect(['STAFF', 'INSURER'], role).toContain(auditActor(staff(role)).type);
    }
  });

  it('attributes a customer to themselves', () => {
    const customer: Principal = { kind: 'customer', id: 'cust-1', email: 'c@example.invalid', emailVerified: true };

    expect(auditActor(customer)).toEqual({ type: 'CUSTOMER', id: 'cust-1' });
  });

  it('carries no identity for the system itself', () => {
    expect(systemActor).toEqual({ type: 'SYSTEM', id: null });
  });
});
