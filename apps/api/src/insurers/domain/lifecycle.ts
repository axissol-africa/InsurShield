import type { InsurerStatus } from '../../common/domain/enums.js';

/**
 * What an insurer's status may become.
 *
 * Five statuses mean there are now transitions that make no sense, where three
 * meant almost any change was coherent. An insurer that has never been approved
 * cannot be suspended; a removed one changes only through restore, which lands
 * on INACTIVE so nobody comes back trading without being approved again.
 *
 * Who may make a change, and what else the change has to do, belong to the
 * service. This says only which pairs are allowed.
 */
const ALLOWED: Record<InsurerStatus, readonly InsurerStatus[]> = {
  PENDING: ['ACTIVE', 'DELETED'],
  ACTIVE: ['SUSPENDED', 'INACTIVE', 'DELETED'],
  SUSPENDED: ['ACTIVE', 'INACTIVE', 'DELETED'],
  INACTIVE: ['ACTIVE', 'DELETED'],
  // Restore is its own transition, and it does not come through here.
  DELETED: [],
};

/** Whether `to` is a status `from` may become. Staying put is allowed, so setting a status twice is idempotent. */
export function canChangeInsurerStatus(from: InsurerStatus, to: InsurerStatus): boolean {
  return from === to || ALLOWED[from].includes(to);
}
