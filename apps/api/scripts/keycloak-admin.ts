/**
 * Minimal Keycloak Admin REST client used by the seed.
 *
 * Authenticates with the API's own service account (client credentials), so no
 * human admin password is needed to provision staff. Every call is idempotent:
 * a user that already exists is updated rather than duplicated.
 */
import { causes, DRIVER_CODE } from '../src/db/errors.js';

export interface SeedUser {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
  realmRoles: string[];
}

export interface KeycloakAdmin {
  /** Creates or updates the user and returns the Keycloak `sub`. */
  upsertUser(user: SeedUser): Promise<string>;
}

/** Its message names the operation, method, path, HTTP status and Keycloak's error code only, never a body. */
export class KeycloakAdminError extends Error {
  override name = 'KeycloakAdminError';

  constructor(
    message: string,
    readonly code?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

// Keycloak's `error` field is a short identifier; anything else in a body may echo secrets.
const KEYCLOAK_ERROR_CODE = /^[A-Za-z0-9_.-]{1,64}$/;

interface KeycloakSettings {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** The realm's passwordHistory policy refuses re-setting the same value, so passwords are set on new accounts only unless this is true. */
  resetPasswords: boolean;
}

/** Undefined when the environment names no issuer or no client secret. */
export function keycloakAdminFromEnv(env: NodeJS.ProcessEnv): KeycloakAdmin | undefined {
  const issuer = (env.KEYCLOAK_ISSUER ?? '').replace(/\/$/, '');
  const clientSecret = env.KEYCLOAK_CLIENT_SECRET ?? '';
  if (!issuer || !clientSecret) return undefined;
  return new KeycloakAdminClient({
    issuer,
    clientId: env.KEYCLOAK_CLIENT_ID ?? 'insurshield-api',
    clientSecret,
    resetPasswords: env.SEED_RESET_PASSWORDS === 'true',
  });
}

class KeycloakAdminClient implements KeycloakAdmin {
  private readonly adminBase: string;

  constructor(private readonly settings: KeycloakSettings) {
    const [base, realm] = settings.issuer.split('/realms/');
    this.adminBase = `${base}/admin/realms/${realm}`;
  }

  async upsertUser(user: SeedUser): Promise<string> {
    const token = await this.accessToken();
    const findUser = () =>
      this.call<Array<{ id: string }>>(
        'user lookup',
        token,
        `/users?email=${encodeURIComponent(user.email)}&exact=true`,
      );

    let id = (await findUser())?.[0]?.id;
    const isNew = !id;
    if (!id) {
      await this.call('user creation', token, '/users', {
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
      id = (await findUser())?.[0]?.id;
      if (!id) throw new KeycloakAdminError('Could not resolve the Keycloak id of the user just created.');
    }

    if (isNew || this.settings.resetPasswords) {
      await this.call('password reset', token, `/users/${id}/reset-password`, {
        method: 'PUT',
        body: JSON.stringify({ type: 'password', value: user.password, temporary: false }),
      });
    }

    const available = await this.call<Array<{ id: string; name: string }>>(
      'role lookup',
      token,
      `/users/${id}/role-mappings/realm/available`,
    );
    const toAssign = (available ?? []).filter((role) => user.realmRoles.includes(role.name));
    if (toAssign.length) {
      await this.call('role assignment', token, `/users/${id}/role-mappings/realm`, {
        method: 'POST',
        body: JSON.stringify(toAssign),
      });
    }

    return id;
  }

  private async accessToken(): Promise<string> {
    const path = '/protocol/openid-connect/token';
    const response = await request('token request', `${this.settings.issuer}${path}`, path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.settings.clientId,
        client_secret: this.settings.clientSecret,
      }),
    });
    return ((await response.json()) as { access_token: string }).access_token;
  }

  private async call<T>(operation: string, token: string, path: string, init: RequestInit = {}): Promise<T | null> {
    const response = await request(operation, `${this.adminBase}${path}`, path, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (response.status === 204 || response.status === 201) return null;
    return (await response.json()) as T;
  }
}

async function request(operation: string, url: string, path: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new KeycloakAdminError('Could not reach Keycloak at KEYCLOAK_ISSUER.', networkCode(error), { cause: error });
  }
  if (response.ok) return response;
  const code = await keycloakErrorCode(response);
  // The query string may carry an email address.
  const route = `${init.method ?? 'GET'} ${path.split('?')[0]}`;
  throw new KeycloakAdminError(
    `Keycloak ${operation} failed: ${route} answered HTTP ${response.status}${code ? ` (${code})` : ''}.`,
  );
}

async function keycloakErrorCode(response: Response): Promise<string | undefined> {
  const body: unknown = await response.json().catch(() => undefined);
  const code = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined;
  return typeof code === 'string' && KEYCLOAK_ERROR_CODE.test(code) ? code : undefined;
}

function networkCode(error: unknown): string | undefined {
  for (const current of causes(error)) {
    if (typeof current.code === 'string' && DRIVER_CODE.test(current.code)) return current.code;
  }
  return undefined;
}
