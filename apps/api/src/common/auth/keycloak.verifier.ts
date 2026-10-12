import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { ApiException } from '../errors/api.exception.js';
import type { StaffRoleName } from './auth.types.js';

/** What Keycloak puts in an access token, beyond the registered claims. */
interface KeycloakClaims extends JWTPayload {
  email?: string;
  email_verified?: boolean;
  preferred_username?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  realm_access?: { roles?: string[] };
}

export interface VerifiedToken {
  subject: string;
  email: string;
  name: string;
  realmRoles: string[];
}

/** Realm role -> the role names this service reasons about. */
const ROLE_MAP: Record<string, StaffRoleName> = {
  super_admin: 'SUPER_ADMIN',
  admin: 'ADMIN',
  insurer_user: 'INSURER_USER',
};

/**
 * Verifies Keycloak-issued access tokens.
 *
 * This is the only place that knows the identity provider. It checks the
 * signature against the realm's published JWKS (fetched once and cached, with
 * automatic rotation), and pins both the issuer and the audience — a valid
 * token minted for a different realm or a different client is rejected.
 */
@Injectable()
export class KeycloakVerifier implements OnModuleInit {
  private readonly logger = new Logger(KeycloakVerifier.name);
  private jwks!: ReturnType<typeof createRemoteJWKSet>;
  private issuer!: string;
  private audience!: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.issuer = this.config.getOrThrow<string>('KEYCLOAK_ISSUER').replace(/\/$/, '');
    this.audience = this.config.getOrThrow<string>('KEYCLOAK_AUDIENCE');
    this.jwks = createRemoteJWKSet(
      new URL(`${this.issuer}/protocol/openid-connect/certs`),
      // Keys are cached; a cache miss (after a realm key rotation) refetches at
      // most this often, so a rotation cannot be used to hammer Keycloak.
      { cooldownDuration: 30_000, cacheMaxAge: 600_000 },
    );
    this.logger.log(`Verifying tokens issued by ${this.issuer}`);
  }

  async verify(token: string): Promise<VerifiedToken> {
    let claims: KeycloakClaims;
    try {
      const { payload } = await jwtVerify<KeycloakClaims>(token, this.jwks, {
        issuer: this.issuer,
        audience: this.audience,
        algorithms: ['RS256'],
      });
      claims = payload;
    } catch (error) {
      this.logger.debug(`Token rejected: ${(error as Error).message}`);
      throw ApiException.unauthorized('Your session has expired. Sign in again.');
    }

    if (!claims.sub) throw ApiException.unauthorized();

    return {
      subject: claims.sub,
      email: claims.email ?? claims.preferred_username ?? '',
      name: claims.name ?? [claims.given_name, claims.family_name].filter(Boolean).join(' ').trim(),
      realmRoles: claims.realm_access?.roles ?? [],
    };
  }

  /** The highest staff role the token carries, or null for a plain customer. */
  static staffRole(realmRoles: string[]): StaffRoleName | null {
    for (const candidate of ['super_admin', 'admin', 'insurer_user']) {
      if (realmRoles.includes(candidate)) return ROLE_MAP[candidate];
    }
    return null;
  }
}
