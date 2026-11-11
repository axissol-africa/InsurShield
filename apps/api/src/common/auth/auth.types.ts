import type { StaffRole } from '../domain/enums.js';
/** Who is making the request, resolved from the session by `resolveIdentity`. */
export type Principal =
  /**
   * `emailVerified` gates the customer's own protected records. Staff have no
   * equivalent: they are provisioned rather than registered, so there is no
   * unverified state for them to be in.
   */
  | { kind: 'customer'; id: string; email: string; emailVerified: boolean }
  | { kind: 'staff'; id: string; email: string; role: StaffRoleName; insurerId: string | null };

/** The stored role names, from the one list that defines them. */
export type StaffRoleName = StaffRole;
