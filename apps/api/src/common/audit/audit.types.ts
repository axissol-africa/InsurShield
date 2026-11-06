import type { ActorType } from '../domain/enums.js';
import type { Principal } from '../auth/auth.types.js';

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

/** Maps the authenticated domain principal onto the public audit taxonomy. */
export function auditActor(principal: Principal): AuditActor {
  if (principal.kind === 'customer') return { type: 'CUSTOMER', id: principal.id };
  return { type: principal.role === 'INSURER_USER' ? 'INSURER' : 'STAFF', id: principal.id };
}

export const systemActor: AuditActor = { type: 'SYSTEM', id: null };
