/** Who is making the request, resolved from the bearer token. */
export type Principal =
  | { kind: 'customer'; id: string; email: string }
  | { kind: 'staff'; id: string; email: string; role: StaffRoleName; insurerId: string | null };

export type StaffRoleName = 'SUPER_ADMIN' | 'ADMIN' | 'INSURER_USER';

export interface JwtPayload {
  sub: string;
  kind: 'customer' | 'staff';
  email: string;
  role?: StaffRoleName;
  insurerId?: string | null;
}
