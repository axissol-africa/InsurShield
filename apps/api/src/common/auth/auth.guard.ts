import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ApiException } from '../errors/api.exception.js';
import { TokenService } from './token.service.js';
import type { Principal, StaffRoleName } from './auth.types.js';

export const IS_PUBLIC = 'isPublic';
export const REQUIRED_ROLES = 'requiredRoles';

/** Marks an endpoint as reachable without a token. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Restricts an endpoint to staff holding one of these roles. */
export const Roles = (...roles: StaffRoleName[]) => SetMetadata(REQUIRED_ROLES, roles);

/**
 * Turns an access token into a `Principal`.
 *
 * The token is only a claim of identity: the row is loaded on every request,
 * so suspending or deactivating an account takes effect immediately instead of
 * whenever that token would have expired. The token's role is likewise
 * re-read from the row, so a staff member demoted mid-session loses the access
 * straight away rather than keeping it until they sign in again.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
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

    const claims = await this.tokens.verify(header.slice(7));

    request.principal =
      claims.kind === 'staff'
        ? await this.resolveStaff(claims.sub)
        : await this.resolveCustomer(claims.sub);

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

  private async resolveStaff(id: string): Promise<Principal> {
    const staff = await this.prisma.staffUser.findUnique({ where: { id } });
    if (!staff || !staff.isActive) {
      throw ApiException.forbidden('This staff account is not active on InsurShield.');
    }
    return {
      kind: 'staff',
      id: staff.id,
      email: staff.email,
      role: staff.role,
      insurerId: staff.insurerId,
    };
  }

  private async resolveCustomer(id: string): Promise<Principal> {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer || customer.deletedAt) throw ApiException.forbidden('This account has been closed.');
    if (customer.suspendedAt) {
      throw ApiException.forbidden('This account has been suspended. Please contact support.');
    }
    return { kind: 'customer', id: customer.id, email: customer.email };
  }
}
