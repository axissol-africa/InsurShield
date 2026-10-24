import { Pool } from 'pg';
import { loadEnvFile } from '../src/config/env.js';
import { createDatabase } from '../src/db/database.module.js';
import * as schema from '../src/db/schema.js';
import { seedDatabase, seedDatabaseUrl, seedOptionsFromEnv } from './seed-database.js';
import { describeSeedFailure } from './seed-errors.js';

loadEnvFile();

let pool: Pool | undefined;
try {
  const options = seedOptionsFromEnv(process.env);
  pool = new Pool({ connectionString: seedDatabaseUrl(), max: 1 });
  await seedDatabase(createDatabase(pool, { schema }), options);
} catch (error) {
  const { message, details } = describeSeedFailure(error);
  console.error(message, ...(details.code ? [details] : []));
  process.exitCode = 1;
} finally {
  await pool?.end();
}
