import { keycloakAdminFromEnv, type KeycloakAdmin } from './keycloak-admin.js';
import { describeSeedFailure } from './seed-errors.js';

const SECRET = 'sentinel-9c1e';
const user = {
  email: 'admin@insurshield.zm',
  firstName: 'InsurShield',
  lastName: 'Administrator',
  password: 'local-password',
  realmRoles: ['admin'],
};

function admin(): KeycloakAdmin {
  const client = keycloakAdminFromEnv({
    KEYCLOAK_ISSUER: 'http://127.0.0.1:1/realms/insurshield',
    KEYCLOAK_CLIENT_SECRET: 'client-secret',
  });
  if (!client) throw new Error('expected a Keycloak client');
  return client;
}

async function printedFailure(run: Promise<unknown>) {
  const error = await run.then(
    () => {
      throw new Error('expected the call to fail');
    },
    (failure: unknown) => failure,
  );
  const { message, details } = describeSeedFailure(error);
  return { message, line: `${message} ${JSON.stringify(details)}`, details };
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('KeycloakAdmin failures', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prints the status, path and error code of a refused token request, never the body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(401, { error: 'unauthorized_client', error_description: `Invalid client secret ${SECRET}` }),
      ),
    );

    const { line } = await printedFailure(admin().upsertUser(user));

    expect(line).toContain('401');
    expect(line).toContain('/protocol/openid-connect/token');
    expect(line).toContain('unauthorized_client');
    expect(line).not.toContain(SECRET);
  });

  it('prints the status, path and error code of a refused admin call, never the body or the query', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(json(200, { access_token: 'token' }))
        .mockResolvedValueOnce(json(403, { error: 'unknown_error', errorMessage: `${SECRET} is not allowed` })),
    );

    const { line } = await printedFailure(admin().upsertUser(user));

    expect(line).toContain('403');
    expect(line).toContain('GET /users');
    expect(line).toContain('unknown_error');
    expect(line).not.toContain(SECRET);
    expect(line).not.toContain(user.email);
  });

  it('names the step, never the email, when a created user cannot be found', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(json(200, { access_token: 'token' }))
        .mockResolvedValueOnce(json(200, []))
        .mockResolvedValueOnce(new Response(null, { status: 201 }))
        .mockResolvedValueOnce(json(200, [])),
    );

    const { message, line } = await printedFailure(admin().upsertUser(user));

    expect(message).toBe('db:seed failed: Could not resolve the Keycloak id of the user just created.');
    expect(line).not.toContain(user.email);
  });

  it('names the variable and the network code when Keycloak cannot be reached', async () => {
    const refused = Object.assign(new Error(`connect ECONNREFUSED 127.0.0.1:1 ${SECRET}`), { code: 'ECONNREFUSED' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed', { cause: refused });
      }),
    );

    const { message, details, line } = await printedFailure(admin().upsertUser(user));

    expect(message).toBe('db:seed failed: Could not reach Keycloak at KEYCLOAK_ISSUER.');
    expect(details).toEqual({ code: 'ECONNREFUSED' });
    expect(line).not.toContain('127.0.0.1');
    expect(line).not.toContain(SECRET);
  });
});
