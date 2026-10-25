import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import { loadEnvFile, useTestDatabase } from './src/config/env.js';

// Everything is checked here, before the global setup resets the test database.
loadEnvFile();
// The developer's .env may turn the docs on; a spec that needs them turns them on itself.
process.env.SWAGGER_ENABLED = 'false';
useTestDatabase();

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
