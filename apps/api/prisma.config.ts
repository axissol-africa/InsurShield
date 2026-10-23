// Prisma 7 configuration.
//
// From v7 the connection URL no longer lives in schema.prisma: migration and
// introspection commands read it from here, while the runtime client connects
// through a driver adapter (see src/prisma/prisma.service.ts).
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const databaseUrl = process.env.DATABASE_URL;
// A scratch database Prisma may create and drop at will. It is what lets
// `migrate dev` detect drift, and what `migrate diff --from-migrations` needs
// to replay the history and prove it still rebuilds this schema.
const shadowDatabaseUrl = process.env.SHADOW_DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
  // Only migrate/introspect need a live connection. Declaring it conditionally
  // keeps `prisma generate` working on a fresh install with no .env yet, which
  // is what happens on CI and for frontend-only contributors.
  ...(databaseUrl
    ? {
        datasource: {
          url: databaseUrl,
          ...(shadowDatabaseUrl ? { shadowDatabaseUrl } : {}),
        },
      }
    : {}),
});
