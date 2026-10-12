import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service.js';
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
    private readonly prisma: PrismaService,
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
      ? await this.resolveStaff(token.subject, token.email, staffRole)
      : await this.resolveCustomer(token.subject, token.email, token.name);

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

  /**
   * Staff are pre-provisioned, because `insurerId` is a relationship this
   * service owns and Keycloak knows nothing about. A token carrying a staff
   * role with no matching row is refused rather than silently upgraded.
   */
  private async resolveStaff(
    keycloakId: string,
    email: string,
    role: StaffRoleName,
  ): Promise<Principal> {
    const staff = await this.prisma.staffUser.findUnique({ where: { keycloakId } });
    if (!staff || !staff.isActive) {
      throw ApiException.forbidden('This staff account is not active on InsurShield.');
    }
    return {
      kind: 'staff',
      id: staff.id,
      email: staff.email || email,
      // The realm is the authority on the role; the row only carries the link.
      role,
      insurerId: staff.insurerId,
    };
  }

  /** Customers are created on first call, so signup lives entirely in Keycloak. */
  private async resolveCustomer(
    keycloakId: string,
    email: string,
    name: string,
  ): Promise<Principal> {
    const existing = await this.prisma.customer.findUnique({ where: { keycloakId } });
    if (existing) {
      if (existing.deletedAt) throw ApiException.forbidden('This account has been closed.');
      return { kind: 'customer', id: existing.id, email: existing.email };
    }

    if (!email) {
      throw ApiException.unauthorized('Your account is missing an email address.');
    }

    const customer = await this.prisma.customer.create({
      data: {
        keycloakId,
        email: email.toLowerCase(),
        fullName: name || email,
        // Keycloak's signup does not collect a phone number, so this is a
        // placeholder until the customer supplies one. It is namespaced by the
        // Keycloak id to satisfy the unique constraint on `phone`.
        // PARKED: SMS verification will replace this with a verified number.
        phone: `pending:${keycloakId}`,
      },
    });
    return { kind: 'customer', id: customer.id, email: customer.email };
  }
}
