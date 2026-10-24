import { defineConfig } from 'drizzle-kit';
import { databaseUrl, loadEnvFile } from './src/config/env.js';

loadEnvFile();

// Apply migrations with `npm run db:migrate` (src/db/migrate.ts), never `drizzle-kit migrate`:
// only the entry point recognises a Prisma-era database and checks the catalog.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: databaseUrl() },
});
