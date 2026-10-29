/** Who is making the request, resolved from the session by `resolveIdentity`. */
export type Principal =
  | { kind: 'customer'; id: string; email: string }
  | { kind: 'staff'; id: string; email: string; role: StaffRoleName; insurerId: string | null };

export type StaffRoleName = 'SUPER_ADMIN' | 'ADMIN' | 'INSURER_USER';
