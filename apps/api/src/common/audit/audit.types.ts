import type { ActorType } from '../domain/enums.js';
import type { Principal, StaffRoleName } from '../auth/auth.types.js';

/** A trusted actor resolved by the server, never a value supplied by a client. */
export interface AuditActor {
  type: ActorType;
  id: string | null;
}

export interface AuditEvent {
  actor: AuditActor;
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  note?: string | null;
  correlationId?: string | null;
}

export interface StateTransition {
  actor: AuditActor;
  entityType: 'QUOTE_REQUEST' | 'POLICY' | 'CLAIM' | 'NCD_APPLICATION' | 'INSPECTION';
  entityId: string;
  fromStatus: string | null;
  toStatus: string;
  note?: string | null;
  correlationId?: string | null;
}

/**
 * Which party a staff role acts for.
 *
 * An exhaustive Record rather than a test against one role: when the role set
 * grew from three to eight, a ternary against INSURER_USER quietly attributed
 * every new insurer role to InsurShield, and an audit row naming the wrong
 * party is worse than no row. This way the compiler names a new role here.
 */
const ACTS_FOR: Record<StaffRoleName, Extract<ActorType, 'STAFF' | 'INSURER'>> = {
  SUPER_ADMIN: 'STAFF',
  ADMIN: 'STAFF',
  INSURER_ADMIN: 'INSURER',
  QUOTE_OFFICER: 'INSURER',
  CLAIMS_OFFICER: 'INSURER',
  SUPPORT: 'INSURER',
  FINANCE: 'INSURER',
  COMPLIANCE_READ_ONLY: 'INSURER',
  INSURER_USER: 'INSURER',
};

/** Maps the authenticated domain principal onto the public audit taxonomy. */
export function auditActor(principal: Principal): AuditActor {
  if (principal.kind === 'customer') return { type: 'CUSTOMER', id: principal.id };
  return { type: ACTS_FOR[principal.role], id: principal.id };
}

export const systemActor: AuditActor = { type: 'SYSTEM', id: null };
