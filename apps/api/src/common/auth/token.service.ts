import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { ApiException } from '../errors/api.exception.js';
import type { Env } from '../../config/env.js';
import type { JwtPayload, StaffRoleName } from './auth.types.js';

/**
 * Issues and verifies this service's own access tokens.
 *
 * A token says who the holder is and, for staff, what they may reach. It is
 * signed with a secret only this service holds, so nothing else can mint one.
 * Tokens are short-lived and carry no refresh: the holder signs in again.
 *
 * Authorisation is never taken from the token alone — the guard still loads
 * the row, so deactivating an account takes effect on the next request rather
 * than whenever the token happens to expire.
 */
@Injectable()
export class TokenService {
  private readonly key: Uint8Array;
  private readonly ttl: string;
  private readonly issuer = 'insurshield';

  constructor(config: ConfigService<Env, true>) {
    this.key = new TextEncoder().encode(config.get('AUTH_JWT_SECRET', { infer: true }));
    this.ttl = config.get('AUTH_TOKEN_TTL', { infer: true });
  }

  async issue(payload: JwtPayload): Promise<string> {
    return new SignJWT({ ...payload } as unknown as JWTPayload)
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(payload.sub)
      .setIssuer(this.issuer)
      .setIssuedAt()
      .setExpirationTime(this.ttl)
      .sign(this.key);
  }

  async verify(token: string): Promise<JwtPayload> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: this.issuer });
      // Claims arrive as `unknown`. Anything that is not the shape expected is
      // dropped rather than coerced, so a malformed token cannot smuggle an
      // object in where a string belongs.
      const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
      return {
        sub: text(payload.sub) ?? '',
        kind: text(payload.kind) === 'staff' ? 'staff' : 'customer',
        email: text(payload.email) ?? '',
        role: text(payload.role) as StaffRoleName | undefined,
        insurerId: text(payload.insurerId) ?? null,
      };
    } catch {
      // Expired, tampered with, or signed by something else — all the same
      // answer, so nothing is learned from which one it was.
      throw ApiException.unauthorized('Your session has ended. Please sign in again.');
    }
  }
}
