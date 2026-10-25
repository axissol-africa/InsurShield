import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, importJWK, SignJWT, type CryptoKey, type JWK, type JWTPayload } from 'jose';
import { inject } from 'vitest';

declare module 'vitest' {
  export interface ProvidedContext {
    jwks: { issuer: string; signingKey: JWK };
  }
}

const REALM_PATH = '/realms/insurshield-e2e';
const CERTS_PATH = `${REALM_PATH}/protocol/openid-connect/certs`;
const ALGORITHM = 'RS256';

export interface JwksServer {
  issuer: string;
  /** The private key of this run, handed to the spec workers through `provide`. */
  signingKey: JWK;
  close(): Promise<void>;
}

/** Publishes a key generated for this run, so the app's real verifier checks every e2e token. */
export async function startJwksServer(): Promise<JwksServer> {
  const { publicKey, privateKey } = await generateKeyPair(ALGORITHM, { extractable: true });
  const kid = randomUUID();
  const certs = JSON.stringify({ keys: [{ ...(await exportJWK(publicKey)), kid, alg: ALGORITHM, use: 'sig' }] });
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === CERTS_PATH) {
      response.writeHead(200, { 'content-type': 'application/json' }).end(certs);
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    issuer: `http://127.0.0.1:${port}${REALM_PATH}`,
    signingKey: { ...(await exportJWK(privateKey)), kid, alg: ALGORITHM },
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

export interface TokenClaims {
  sub: string;
  email?: string;
  name?: string;
  /** Keycloak realm roles: `super_admin`, `admin`, `insurer_user`; none for a customer. */
  realmRoles?: string[];
  /** Any further claims, which override the ones above. */
  extra?: JWTPayload;
}

export interface TokenOptions {
  issuer?: string;
  audience?: string;
  /** Seconds since the epoch; five minutes from now by default. */
  expiresAt?: number;
  /** Sign with another key under this run's key id, so only the signature is wrong. */
  foreignKey?: boolean;
}

let runKey: Promise<CryptoKey | Uint8Array> | undefined;
let foreignKey: Promise<CryptoKey> | undefined;

function signingKey(foreign: boolean) {
  if (foreign) {
    foreignKey ??= generateKeyPair(ALGORITHM).then(({ privateKey }) => privateKey);
    return foreignKey;
  }
  runKey ??= importJWK(inject('jwks').signingKey, ALGORITHM);
  return runKey;
}

function audience(): string {
  const value = process.env.KEYCLOAK_AUDIENCE;
  if (!value) throw new Error('KEYCLOAK_AUDIENCE must be set for e2e tokens');
  return value;
}

/** An access token shaped like Keycloak's, signed with this run's key unless told otherwise. */
export async function signToken(claims: TokenClaims, options: TokenOptions = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const { signingKey: jwk } = inject('jwks');
  return new SignJWT({
    email: claims.email,
    name: claims.name,
    realm_access: { roles: claims.realmRoles ?? [] },
    ...claims.extra,
  })
    .setProtectedHeader({ alg: ALGORITHM, kid: jwk.kid, typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuer(options.issuer ?? inject('jwks').issuer)
    .setAudience(options.audience ?? audience())
    .setIssuedAt(now)
    .setExpirationTime(options.expiresAt ?? now + 300)
    .sign(await signingKey(options.foreignKey ?? false));
}

export function customerToken(
  customer: { keycloakId: string; email: string; fullName?: string },
  options?: TokenOptions,
): Promise<string> {
  return signToken({ sub: customer.keycloakId, email: customer.email, name: customer.fullName }, options);
}

export function staffToken(
  staff: { keycloakId: string; email: string; fullName?: string },
  realmRoles: string[],
  options?: TokenOptions,
): Promise<string> {
  return signToken({ sub: staff.keycloakId, email: staff.email, name: staff.fullName, realmRoles }, options);
}

export function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
