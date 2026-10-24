import { startApp, type TestApp } from './helpers.js';

async function withSwagger(enabled: boolean, check: (app: TestApp) => Promise<void>) {
  const app = await startApp({ settings: { SWAGGER_ENABLED: enabled } });
  try {
    await check(app);
  } finally {
    await app.close();
  }
}

describe('API docs', () => {
  it('serves nothing at /docs when SWAGGER_ENABLED is false', async () => {
    await withSwagger(false, async ({ http }) => {
      await http.get('/docs').expect(404);
      await http.get('/docs-json').expect(404);
      await http.get('/api/v1/docs-json').expect(404);
    });
  });

  it('serves the docs at /docs and /docs-json, outside the API prefix, when SWAGGER_ENABLED is true', async () => {
    await withSwagger(true, async ({ http }) => {
      await http.get('/docs').expect(200);
      const { body } = await http.get('/docs-json').expect(200);
      expect(body.info.title).toBe('InsurShield API');
      expect(Object.keys(body.paths)).toContain('/api/v1/insurers');
      await http.get('/api/v1/docs-json').expect(404);
    });
  });

  it('takes SWAGGER_ENABLED from the configuration, which the e2e config sets to false', async () => {
    const testApp = await startApp();
    try {
      await testApp.http.get('/docs-json').expect(404);
    } finally {
      await testApp.close();
    }
  });
});
