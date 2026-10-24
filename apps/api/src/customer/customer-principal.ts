import type { Principal } from '../common/auth/auth.types.js';

/** The signed-in customer every route in this module is scoped to. */
export type CustomerPrincipal = Extract<Principal, { kind: 'customer' }>;
