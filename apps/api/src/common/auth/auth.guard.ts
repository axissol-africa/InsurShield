import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { getSessionCookie } from 'better-auth/cookies';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request } from 'express';
import { AUTH, COOKIE_PREFIX } from '../../auth/auth.constants.js';
import type { Auth } from '../../auth/auth.instance.js';
import { resolveIdentity } from '../../auth/identity.js';
import type { Env } from '../../config/env.js';
import { DATABASE, type Database } from '../../db/database.module.js';
import { ApiException } from '../errors/api.exception.js';
import type { Principal, StaffRoleName } from './auth.types.js';
import { ANONYMOUS, IDENTITY_HEADER, identityHeader, identityMatches } from './identity-precondition.js';
import { IDENTITY_CHANGED, IDENTITY_CHANGED_MESSAGE } from './messages.js';

export const IS_PUBLIC = 'isPublic';
export const IS_OPTIONAL_AUTH = 'isOptionalAuth';
export const REQUIRED_ROLES = 'requiredRoles';

/** Marks an endpoint as reachable without signing in. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Serves guests and signed-in callers differently: the principal is set only when there is a valid session. */
export const OptionalAuth = () => SetMetadata(IS_OPTIONAL_AUTH, true);

/** Restricts an endpoint to staff holding one of these roles. */
export const Roles = (...roles: StaffRoleName[]) => SetMetadata(REQUIRED_ROLES, roles);

export function identityChanged(): ApiException {
  return new ApiException(IDENTITY_CHANGED, IDENTITY_CHANGED_MESSAGE, HttpStatus.CONFLICT);
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * A cookie rides along on cross-site requests, so an unsafe one must show it came from a trusted page:
 * a trusted `Origin`, or no `Origin` with `Sec-Fetch-Site: same-origin`. `Origin: null` never passes.
 */
export function originAllowed(request: Request, trustedOrigins: readonly string[]): boolean {
  const origin = request.header('origin');
  if (origin !== undefined) return origin !== 'null' && trustedOrigins.includes(origin);
  return request.header('sec-fetch-site') === 'same-origin';
}

/**
 * Turns the Better Auth session cookie into a `Principal`, through the same `resolveIdentity` rule the
 * session hook applies at sign-in, so a change to the domain rows takes effect on the next request.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly trustedOrigins: string[];

  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(DATABASE) private readonly db: Database,
    private readonly reflector: Reflector,
    config: ConfigService<Env, true>,
  ) {
    this.trustedOrigins = config.get('CORS_ORIGINS', { infer: true });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets) ?? false;
    const isOptional = this.reflector.getAllAndOverride<boolean>(IS_OPTIONAL_AUTH, targets) ?? false;
    const request = context.switchToHttp().getRequest<Request & { principal?: Principal }>();
    const expected = identityHeader(request.headers[IDENTITY_HEADER]);

    if (expected === ANONYMOUS) {
      if (isPublic || isOptional) return true;
      throw identityChanged();
    }
    if (isPublic && expected === undefined) return true;

    const headers = fromNodeHeaders(request.headers);
    const hasCookie = getSessionCookie(headers, { cookiePrefix: COOKIE_PREFIX }) !== null;
    if (!isPublic && hasCookie && UNSAFE_METHODS.has(request.method) && !originAllowed(request, this.trustedOrigins)) {
      throw ApiException.forbidden('This request did not come from a trusted page.');
    }

    // A second guard beside `session.disableSessionRefresh`: a guard has no response to set a cookie on.
    const session = hasCookie ? await this.auth.api.getSession({ headers, query: { disableRefresh: true } }) : null;
    if (!identityMatches(expected, session?.user.id ?? null)) throw identityChanged();
    if (isPublic) return true;
    if (!session) {
      if (isOptional) return true;
      throw ApiException.unauthorized();
    }

    const identity = await resolveIdentity(this.db, session.user.id);
    if (!identity.ok) {
      throw new ApiException(identity.code, identity.message, identity.status);
    }
    request.principal = identity.principal;

    const required = this.reflector.getAllAndOverride<StaffRoleName[]>(REQUIRED_ROLES, targets);
    if (!required?.length) return true;
    if (identity.principal.kind !== 'staff' || !required.includes(identity.principal.role)) {
      throw ApiException.forbidden();
    }
    return true;
  }
}
