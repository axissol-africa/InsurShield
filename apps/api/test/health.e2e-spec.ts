import { Pool } from 'pg';
import { createDatabase, DATABASE } from '../src/db/database.module.js';
import * as schema from '../src/db/schema.js';
import { startApp, type TestApp } from './helpers.js';

describe('health', () => {
  describe('with the database reachable', () => {
    let testApp: TestApp;

    beforeAll(async () => {
      testApp = await startApp();
    });

    afterAll(async () => {
      await testApp.close();
    });

    afterEach(() => {
      testApp.storage.reachable = true;
    });

    it('reports the database and storage as up', async () => {
      const response = await testApp.http.get('/health/ready').expect(200);

      expect(response.body).toEqual({ status: 'up', dependencies: { database: 'up', storage: 'up' } });
    });

    it('reports storage down when the bucket cannot be reached', async () => {
      testApp.storage.reachable = false;

      const response = await testApp.http.get('/health/ready').expect(200);

      expect(response.body).toEqual({ status: 'down', dependencies: { database: 'up', storage: 'down' } });
    });
  });

  describe('with the database down', () => {
    let testApp: TestApp;
    // Nothing listens on port 1, so every connection is refused at once.
    const unreachable = new Pool({
      connectionString: 'postgresql://nobody:nothing@127.0.0.1:1/unreachable_test',
      connectionTimeoutMillis: 1_000,
    });

    beforeAll(async () => {
      testApp = await startApp({
        override: (builder) =>
          builder.overrideProvider(DATABASE).useValue(createDatabase(unreachable, { schema })),
      });
    });

    afterAll(async () => {
      await testApp.close();
      await unreachable.end();
    });

    it('still answers the liveness check', async () => {
      const response = await testApp.http.get('/health').expect(200);

      expect(response.body).toEqual({ status: 'ok', uptimeSeconds: expect.any(Number) });
    });

    it('reports the database down on the readiness check', async () => {
      const response = await testApp.http.get('/health/ready').expect(200);

      expect(response.body).toEqual({ status: 'down', dependencies: { database: 'down', storage: 'up' } });
    });
  });
});
