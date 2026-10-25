import { sql, type SQL } from 'drizzle-orm';
import { ncdApplications, ncdCodes } from '../db/schema.js';

/**
 * The one rule for who may use a no-claim discount code: it was issued by
 * approving an NCD application of this customer. For a query on `ncd_codes`.
 */
export function ncdCodeIssuedTo(customerId: string): SQL {
  return sql`exists (select 1 from ${ncdApplications} where ${ncdApplications.approvedCodeId} = ${ncdCodes.code} and ${ncdApplications.customerId} = ${customerId})`;
}
