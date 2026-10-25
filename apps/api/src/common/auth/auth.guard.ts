import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService } from '../../auth/auth.service.js';
import { ApiException } from '../errors/api.exception.js';
import { KeycloakVerifier } from './keycloak.verifier.js';
import type { Principal, StaffRoleName } from './auth.types.js';

export const IS_PUBLIC = 'isPublic';
export const REQUIRED_ROLES = 'requiredRoles';

/** Marks an endpoint as reachable without a token. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Restricts an endpoint to staff holding one of these roles. */
export const Roles = (...roles: StaffRoleName[]) => SetMetadata(REQUIRED_ROLES, roles);

/**
 * Turns a Keycloak access token into a `Principal`.
 *
 * Keycloak owns authentication; this service owns the domain rows. The two are
 * joined on the token's `sub`, stored as `keycloakId`. A customer signing up in
 * Keycloak gets their `Customer` row created on first authenticated call, while
 * staff must be provisioned deliberately — an account cannot promote itself by
 * simply presenting a token.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly verifier: KeycloakVerifier,
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { principal?: Principal }>();
    const header = request.header('authorization');
    if (!header?.startsWith('Bearer ')) throw ApiException.unauthorized();

    const token = await this.verifier.verify(header.slice(7));
    const staffRole = KeycloakVerifier.staffRole(token.realmRoles);

    request.principal = staffRole
      ? await this.auth.resolveStaff(token.subject, token.email, staffRole)
      : await this.auth.resolveCustomer(token.subject, token.email, token.name);

    const required = this.reflector.getAllAndOverride<StaffRoleName[]>(REQUIRED_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    if (request.principal.kind !== 'staff' || !required.includes(request.principal.role)) {
      throw ApiException.forbidden();
    }
    return true;
  }
}
