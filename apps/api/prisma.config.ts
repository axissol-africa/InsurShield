// Prisma 7 configuration.
//
// From v7 the connection URL no longer lives in schema.prisma: migration and
// introspection commands read it from here, while the runtime client connects
// through a driver adapter (see src/prisma/prisma.service.ts).
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
  // Only migrate/introspect need a live connection. Declaring it conditionally
  // keeps `prisma generate` working on a fresh install with no .env yet, which
  // is what happens on CI and for frontend-only contributors.
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
});
