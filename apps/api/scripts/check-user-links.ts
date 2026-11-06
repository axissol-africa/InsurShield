import { Pool } from 'pg';
import { accountLinkReadinessMessage, accountLinksReady } from '../src/auth/account-link-readiness.js';
import { databaseUrl, loadEnvFile } from '../src/config/env.js';
import { describeDatabaseError } from '../src/db/errors.js';

/**
 * Release gate for the eventual `userId NOT NULL` migration.
 *
 * It intentionally reports counts only: an operator can repair any unmatched
 * legacy accounts through the approved identity process without this command
 * printing customer or staff personal information.
 */
loadEnvFile();

let pool: Pool | undefined;
try {
  pool = new Pool({ connectionString: databaseUrl(), max: 1 });
  const { rows } = await pool.query<{ customers: string; staffUsers: string }>(`
    SELECT
      (SELECT count(*)::text FROM customers WHERE "userId" IS NULL) AS customers,
      (SELECT count(*)::text FROM staff_users WHERE "userId" IS NULL) AS "staffUsers"
  `);
  const counts = { customers: Number(rows[0].customers), staffUsers: Number(rows[0].staffUsers) };
  const message = accountLinkReadinessMessage(counts);
  if (!accountLinksReady(counts)) {
    console.error(message);
    process.exitCode = 1;
  } else {
    console.log(message);
  }
} catch (error) {
  // Connection errors can contain database hosts and user-supplied values.
  // Keep CI and deployment output useful without leaking either.
  console.error('Could not check Better Auth account links.', describeDatabaseError(error));
  process.exitCode = 1;
} finally {
  await pool?.end();
}
