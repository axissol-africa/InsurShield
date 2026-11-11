import { INSURER_ROLES, INSURSHIELD_ROLES } from '../domain/enums.js';
import type { Principal, StaffRoleName } from './auth.types.js';

/**
 * Who may reach what, in one table.
 *
 * Eight roles spread across per-route checks is how an endpoint quietly ends up
 * reachable by somebody it was never meant for, so a route names a permission
 * and this table says who holds it. The guard refuses a route that names none,
 * which is why `permission-coverage.e2e-spec.ts` walks the router and fails on
 * any route that has neither a permission nor an explicit public marker: the
 * default is closed, and a new endpoint stays closed until somebody opens it.
 *
 * A permission answers "may this caller reach this function at all". It never
 * answers "which records" — tenancy and ownership stay in the services and
 * repositories, where they can see the row.
 */

/** A customer is a grantee like any role: it keeps "who holds this" in one vocabulary. */
export type Grantee = 'customer' | StaffRoleName;

const EVERY_ROLE = [...INSURSHIELD_ROLES, ...INSURER_ROLES] as const;
const INSURSHIELD_ADMIN = [...INSURSHIELD_ROLES] as const;
const SUPER_ADMIN_ONLY = ['SUPER_ADMIN'] as const;

/** Any insurer role at all, for the portal's own front door. */
const ANY_INSURER = [...INSURER_ROLES] as const;
/** Quoting: the officer whose job it is, the insurer's administrator, and the legacy role. */
const QUOTING = ['INSURER_ADMIN', 'QUOTE_OFFICER', 'INSURER_USER'] as const;
/** Claims and no-claim discounts travel together, as decision 7 names them together. */
const CLAIMS_AND_NCD = ['INSURER_ADMIN', 'CLAIMS_OFFICER', 'INSURER_USER'] as const;
/** Issuing a certificate commits the insurer to cover, so it stays with the administrator. */
const ISSUING = ['INSURER_ADMIN', 'INSURER_USER'] as const;
/** Reading a queue: whoever works it, plus the two roles whose whole job is reading. */
const READS_REQUESTS = ['INSURER_ADMIN', 'QUOTE_OFFICER', 'SUPPORT', 'COMPLIANCE_READ_ONLY', 'INSURER_USER'] as const;
const READS_CLAIMS = ['INSURER_ADMIN', 'CLAIMS_OFFICER', 'SUPPORT', 'COMPLIANCE_READ_ONLY', 'INSURER_USER'] as const;

export const PERMISSIONS = {
  // ── Anyone signed in ──────────────────────────────────────────────
  'session:read': ['customer', ...EVERY_ROLE],

  // ── A customer's own journey ──────────────────────────────────────
  'consent:accept': ['customer'],
  'quote-request:read': ['customer'],
  'quote-request:submit': ['customer'],
  'policy:read': ['customer'],
  'policy:renew': ['customer'],
  'claim:read': ['customer'],
  'claim:notify': ['customer'],
  'ncd-application:read': ['customer'],
  'ncd-application:apply': ['customer'],
  'inspection:read': ['customer'],
  'inspection:request': ['customer'],
  'inspection:update': ['customer'],
  'notification:read': ['customer'],
  'notification:mark-read': ['customer'],
  'contact-preference:read': ['customer'],
  'contact-preference:save': ['customer'],
  'payment:make': ['customer'],
  'payment:read': ['customer'],
  'account:close': ['customer'],

  // ── Documents ─────────────────────────────────────────────────────
  // Deliberately wide. A customer uploads a white book, insurer staff upload a
  // quotation, and whether this caller may see this document depends on the row
  // rather than the role, so `documents` decides it. The permission says only
  // that the function exists for them.
  'document:upload': ['customer', ...EVERY_ROLE],
  'document:read': ['customer', ...EVERY_ROLE],

  // Served to guests as well, through @OptionalAuth. A signed-in caller still
  // needs the permission, because the guard returns early only when there is no
  // session: whoever is asking, the registry answers the same way.
  'vehicle:lookup': ['customer', ...EVERY_ROLE],

  // ── InsurShield administration ────────────────────────────────────
  'admin:overview': INSURSHIELD_ADMIN,
  'admin:premium-report': INSURSHIELD_ADMIN,
  'admin:policy-list': INSURSHIELD_ADMIN,
  'admin:customer-find': INSURSHIELD_ADMIN,
  'admin:audit-read': INSURSHIELD_ADMIN,
  'pia:set-floor': INSURSHIELD_ADMIN,
  'insurer:read': INSURSHIELD_ADMIN,
  'insurer:create': INSURSHIELD_ADMIN,
  'insurer:update': INSURSHIELD_ADMIN,
  'insurer:set-status': INSURSHIELD_ADMIN,
  'insurer:evidence:read': INSURSHIELD_ADMIN,
  'insurer:evidence:add': INSURSHIELD_ADMIN,
  'insurer:evidence:review': INSURSHIELD_ADMIN,
  'insurer:integration:set': INSURSHIELD_ADMIN,
  // Activating is what lets an insurer trade, and it is the subject batch 8
  // re-routes through two-person approval.
  'insurer:activate': INSURSHIELD_ADMIN,
  // Removing and bringing back an insurer stay with the super administrator,
  // as they did before this table existed.
  'insurer:delete': SUPER_ADMIN_ONLY,
  'insurer:restore': SUPER_ADMIN_ONLY,

  // ── The insurer portal ────────────────────────────────────────────
  'portal:profile:read': ANY_INSURER,
  'portal:request:read': READS_REQUESTS,
  'portal:quote:send': QUOTING,
  'portal:quote:extend': QUOTING,
  'portal:policy:read': ANY_INSURER,
  'portal:certificate:issue': ISSUING,
  'portal:claim:read': READS_CLAIMS,
  'portal:claim:acknowledge': CLAIMS_AND_NCD,
  'portal:ncd:read': READS_CLAIMS,
  'portal:ncd:decide': CLAIMS_AND_NCD,
} as const satisfies Record<string, readonly Grantee[]>;

export type Permission = keyof typeof PERMISSIONS;

/** Whether this caller holds `permission`. Nothing here looks at a record. */
export function holds(principal: Principal, permission: Permission): boolean {
  const grantees: readonly Grantee[] = PERMISSIONS[permission];
  return grantees.includes(principal.kind === 'customer' ? 'customer' : principal.role);
}
