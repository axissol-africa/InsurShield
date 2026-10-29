import { startApp, type TestApp } from './helpers.js';

async function withSwagger(enabled: boolean, check: (app: TestApp) => Promise<void>, env?: Record<string, string>) {
  const app = await startApp({ settings: { SWAGGER_ENABLED: enabled }, env });
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

  it.each([
    ['http://localhost:4000', 'insurshield.session_token'],
    ['https://api.insurshield.invalid', '__Secure-insurshield.session_token'],
  ])('describes the session cookie as the only security scheme, under %s', async (url, cookie) => {
    await withSwagger(
      true,
      async ({ http }) => {
        const { body } = await http.get('/docs-json').expect(200);
        expect(body.components.securitySchemes).toEqual({
          [cookie]: expect.objectContaining({ type: 'apiKey', in: 'cookie', name: cookie }),
        });
      },
      { BETTER_AUTH_URL: url },
    );
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
