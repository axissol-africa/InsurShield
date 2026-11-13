import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { getSessionCookie } from 'better-auth/cookies';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request } from 'express';
import { AUTH, COOKIE_PREFIX } from '../../auth/auth.constants.js';
import type { Auth } from '../../auth/auth.instance.js';
import { resolveIdentity } from '../../auth/identity.js';
import { revokeStaffSession, staffSessionExpiry, touchStaffSession } from '../../auth/staff-session-security.js';
import type { Env } from '../../config/env.js';
import { DATABASE, type Database } from '../../db/database.module.js';
import { AuditService } from '../audit/audit.service.js';
import { auditActor } from '../audit/audit.types.js';
import { ApiException } from '../errors/api.exception.js';
import type { Principal } from './auth.types.js';
import { holds, type Permission } from './permissions.js';
import { ANONYMOUS, IDENTITY_HEADER, identityHeader, identityMatches } from './identity-precondition.js';
import {
  EMAIL_NOT_VERIFIED,
  EMAIL_NOT_VERIFIED_MESSAGE,
  IDENTITY_CHANGED,
  IDENTITY_CHANGED_MESSAGE,
} from './messages.js';

export const IS_PUBLIC = 'isPublic';
export const IS_OPTIONAL_AUTH = 'isOptionalAuth';
export const REQUIRED_PERMISSION = 'requiredPermission';
export const ALLOWS_UNVERIFIED = 'allowsUnverified';

/** Marks an endpoint as reachable without signing in. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Serves guests and signed-in callers differently: the principal is set only
 * when there is a valid session. A route marked this way still names a
 * permission, because the guard returns early only for a caller with no
 * session; one that is signed in is held to the permission like anywhere else.
 */
export const OptionalAuth = () => SetMetadata(IS_OPTIONAL_AUTH, true);

/**
 * Lets a customer who has not yet proved their address reach this endpoint.
 *
 * The gate is fail-closed: every other authenticated route is closed to an
 * unverified customer, so a new endpoint is protected by default and opening
 * it is a visible decision. Staff are unaffected — they are provisioned, not
 * registered, and have no unverified state.
 */
export const AllowUnverified = () => SetMetadata(ALLOWS_UNVERIFIED, true);

/**
 * The permission a caller must hold to reach this endpoint.
 *
 * Every authenticated route carries one. A route that carries none is refused,
 * so an endpoint added without a decision about who may reach it is closed
 * rather than open to anybody signed in. `permission-coverage.e2e-spec.ts`
 * walks the router so that stays true.
 */
export const Needs = (permission: Permission) => SetMetadata(REQUIRED_PERMISSION, permission);

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
    private readonly audit: AuditService,
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

    if (identity.principal.kind === 'staff') {
      const expiry = staffSessionExpiry(session.session);
      if (expiry) {
        await revokeStaffSession(this.db, session.session);
        await this.audit.refusal({
          actor: auditActor(identity.principal),
          action: 'staff_session.expired',
          entityType: 'AUTH_SESSION',
          entityId: session.session.id,
          after: { expiry },
          note: 'A staff session was refused after its configured lifetime.',
          correlationId: identity.principal.id,
        });
        throw ApiException.unauthorized();
      }
      // Better Auth's fixed session configuration intentionally does not refresh a cookie. We still record
      // server-side activity for the staff idle window, scoped to this exact session and account.
      await touchStaffSession(this.db, session.session);
    }

    const allowsUnverified = this.reflector.getAllAndOverride<boolean>(ALLOWS_UNVERIFIED, targets) ?? false;
    if (identity.principal.kind === 'customer' && !identity.principal.emailVerified && !allowsUnverified) {
      throw new ApiException(EMAIL_NOT_VERIFIED, EMAIL_NOT_VERIFIED_MESSAGE, HttpStatus.FORBIDDEN);
    }

    // Closed by default. Before this, a route with no roles declared returned
    // true, so six controllers were reachable by any authenticated caller and
    // were protected only by hand-written checks inside each one.
    const needed = this.reflector.getAllAndOverride<Permission>(REQUIRED_PERMISSION, targets);
    if (!needed || !holds(identity.principal, needed)) {
      await this.recordRefusal(identity.principal, needed, request);
      throw ApiException.forbidden();
    }
    return true;
  }

  /**
   * US-VEN-001 asks for an unassigned function to be denied and audited, so the
   * denial writes a row naming the actor and the permission they lacked -- never
   * anything about the record behind it, which the caller never reached.
   *
   * Staff only. A customer meeting a staff route is not a role reaching past its
   * assignment, and auditing it would dilute the log while letting any
   * signed-in caller write rows at will.
   */
  private async recordRefusal(
    principal: Principal,
    needed: Permission | undefined,
    request: Request,
  ): Promise<void> {
    if (principal.kind !== 'staff') return;
    const route = `${request.method} ${request.path}`;
    await this.audit.refusal({
      actor: auditActor(principal),
      action: 'access.refused',
      entityType: 'PERMISSION',
      // A route naming no permission is the fail-closed case, and worth seeing as itself.
      entityId: needed ?? 'none',
      note: needed ? route : `${route} names no permission`,
      correlationId: principal.insurerId,
    });
  }
}
