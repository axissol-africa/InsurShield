import { type SQL, eq, isNull, ne, or, sql } from 'drizzle-orm';
import { insurers } from '../db/schema.js';
import type { InsurerStatus } from './domain/enums.js';
import { currentOn, LUSAKA } from './domain/lusaka.js';

/**
 * Whether an insurer may trade, in one place.
 *
 * Two questions, not one. Whether a customer may be shown this insurer and
 * sold through it — a request, a renewal, a quote, an extension, a payment, a
 * discount code — and whether what a customer already holds keeps being
 * serviced. An insurer that stops selling still answers claims on the policies
 * it wrote.
 *
 * Each rule is written twice, as a predicate over a row and as conditions a
 * query can filter on, because some callers hold the row and some need the
 * database to do the filtering. `insurer-standing.e2e-spec.ts` runs every
 * status and expiry through both and fails if they ever disagree.
 *
 * A caller that writes reads the standing under a share lock inside the
 * transaction that writes, before the write it guards, so a deactivation in
 * flight cannot commit between the check and the record it would have stopped.
 */

/** What any rule about an insurer's standing needs to know about it. */
export type InsurerStanding = {
  status: InsurerStatus;
  licenceExpiry: Date | null;
};

export const INSURER_UNAVAILABLE = 'INSURER_UNAVAILABLE';

export const insurerUnavailable = (name: string) =>
  `${name} is not currently taking new business. Request fresh quotes to continue.`;

// A licence lapses at the end of its day in Lusaka, like every other business
// date here, and compliance evidence lapses by the same rule -- so the day
// itself comes from `common/domain/lusaka.ts` rather than being worked out twice.
const LUSAKA_ZONE = sql.raw(`'${LUSAKA}'`);

/**
 * A licence nobody has recorded does not read as expired. That is the one place
 * this rule is permissive, and it is load-bearing: no insurer row carries a
 * licence today, not even the seeded ones, so a stricter reading would empty
 * the fan-out list and refuse every quote request. B7.7 records a licence for
 * every insurer and makes the column required; until it lands, the licence half
 * of `takesNewBusiness` only bites rows that have an expiry recorded.
 */
export function licenceValid(licenceExpiry: Date | null, now: Date): boolean {
  return currentOn(licenceExpiry, now);
}

/** New business: this insurer may be shown to customers and sold through. */
export function takesNewBusiness(insurer: InsurerStanding, now: Date): boolean {
  return insurer.status === 'ACTIVE' && licenceValid(insurer.licenceExpiry, now);
}

/**
 * Servicing: an insurer that may no longer sell still answers for what it has
 * already written, until it is removed. This says nothing about whether the
 * customer holds anything with it; a caller that needs that checks it itself.
 */
export function servicesExistingBusiness(insurer: InsurerStanding): boolean {
  return insurer.status !== 'DELETED';
}

/** The same comparison as `licenceValid`, left to the database. */
function licenceValidWhere(now: Date): SQL {
  return sql`(${insurers.licenceExpiry} AT TIME ZONE ${LUSAKA_ZONE})::date
    >= (${now}::timestamptz AT TIME ZONE ${LUSAKA_ZONE})::date`;
}

/** Spread into the caller's own `and(...)`, so each module keeps its own query. */
export function takesNewBusinessWhere(now: Date): (SQL | undefined)[] {
  return [eq(insurers.status, 'ACTIVE'), or(isNull(insurers.licenceExpiry), licenceValidWhere(now))];
}

export function servicesExistingBusinessWhere(): (SQL | undefined)[] {
  return [ne(insurers.status, 'DELETED')];
}
