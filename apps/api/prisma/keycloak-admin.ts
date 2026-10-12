/**
 * Minimal Keycloak Admin REST client used by the seed.
 *
 * Authenticates with the API's own service account (client credentials), so no
 * human admin password is needed to provision staff. Every call is idempotent:
 * a user that already exists is updated rather than duplicated.
 */
const ISSUER = (process.env.KEYCLOAK_ISSUER ?? '').replace(/\/$/, '');
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'insurshield-api';
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? '';

const realm = ISSUER.split('/realms/')[1];
const base = ISSUER.split('/realms/')[0];
const adminBase = `${base}/admin/realms/${realm}`;

async function accessToken(): Promise<string> {
  const response = await fetch(`${ISSUER}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });
  if (!response.ok) {
    throw new Error(`Keycloak token request failed (${response.status}): ${await response.text()}`);
  }
  return ((await response.json()) as { access_token: string }).access_token;
}

async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<T | null> {
  const response = await fetch(`${adminBase}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (response.status === 204 || response.status === 201) return null;
  if (!response.ok) {
    throw new Error(`Keycloak ${init.method ?? 'GET'} ${path} failed (${response.status}): ${await response.text()}`);
  }
  return (await response.json()) as T;
}

export interface SeedUser {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
  realmRoles: string[];
}

/** Creates or updates the user and returns the Keycloak `sub`. */
export async function upsertUser(user: SeedUser): Promise<string> {
  const token = await accessToken();

  const found = await call<Array<{ id: string }>>(
    token,
    `/users?email=${encodeURIComponent(user.email)}&exact=true`,
  );

  let id = found?.[0]?.id;
  const isNew = !id;
  if (!id) {
    await call(token, '/users', {
      method: 'POST',
      body: JSON.stringify({
        username: user.email,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        enabled: true,
        emailVerified: true,
      }),
    });
    const created = await call<Array<{ id: string }>>(
      token,
      `/users?email=${encodeURIComponent(user.email)}&exact=true`,
    );
    id = created?.[0]?.id;
    if (!id) throw new Error(`Could not resolve the Keycloak id for ${user.email}`);
  }

  // Only set the password when the account is new. The realm's
  // passwordHistory policy rejects re-setting the same value, so doing this on
  // every run would make the seed fail the second time it is executed.
  // SEED_RESET_PASSWORDS=true forces it for a genuine reset.
  if (isNew || process.env.SEED_RESET_PASSWORDS === 'true') {
    await call(token, `/users/${id}/reset-password`, {
      method: 'PUT',
      body: JSON.stringify({ type: 'password', value: user.password, temporary: false }),
    });
  }

  const available = await call<Array<{ id: string; name: string }>>(
    token,
    `/users/${id}/role-mappings/realm/available`,
  );
  const toAssign = (available ?? []).filter((role) => user.realmRoles.includes(role.name));
  if (toAssign.length) {
    await call(token, `/users/${id}/role-mappings/realm`, {
      method: 'POST',
      body: JSON.stringify(toAssign),
    });
  }

  return id;
}

export const keycloakConfigured = Boolean(ISSUER && CLIENT_SECRET);
