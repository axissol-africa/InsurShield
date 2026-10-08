import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ApiException } from '../common/errors/api.exception.js';
import { hashPassword, temporaryPassword } from '../common/auth/password.js';
import { StaffRole } from '../generated/prisma/enums.js';
import type { Principal } from '../common/auth/auth.types.js';

/** Never select `passwordHash`: it has no business leaving this service. */
const STAFF_SELECT = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  insurerId: true,
  isActive: true,
  mustChangePassword: true,
  lastLoginAt: true,
  createdAt: true,
  insurer: { select: { id: true, name: true } },
} as const;

const normaliseEmail = (value: string) => value.trim().toLowerCase();

/**
 * Staff and customer accounts, as an administrator sees them.
 *
 * Staff are created here because nobody self-registers into a portal. Customers
 * are not — they open their own accounts — so they can be read and suspended
 * but never created or edited from here.
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Staff ───────────────────────────────────────────────────────

  async listStaff() {
    const staff = await this.prisma.staffUser.findMany({
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
      select: STAFF_SELECT,
    });
    return staff.map((row) => this.serialiseStaff(row));
  }

  /**
   * Creates a portal login. The password is returned exactly once, here, so an
   * administrator can pass it on; it is never readable afterwards.
   */
  async createStaff(input: {
    email: string;
    fullName: string;
    role: StaffRole;
    insurerId?: string | null;
    password?: string;
  }) {
    const email = normaliseEmail(input.email);

    if (await this.prisma.staffUser.findUnique({ where: { email }, select: { id: true } })) {
      throw ApiException.conflict('STAFF_EXISTS', `A staff account already uses ${email}.`);
    }
    const insurerId = await this.resolveInsurer(input.role, input.insurerId ?? null);

    const password = input.password?.trim() || temporaryPassword();
    const staff = await this.prisma.staffUser.create({
      data: {
        email,
        fullName: input.fullName.trim(),
        role: input.role,
        insurerId,
        passwordHash: await hashPassword(password),
        // A password someone else chose must not stay in use.
        mustChangePassword: true,
      },
      select: STAFF_SELECT,
    });

    this.logger.log(`Staff account created: ${staff.email} (${staff.role})`);
    return { staff: this.serialiseStaff(staff), temporaryPassword: password };
  }

  async updateStaff(
    id: string,
    changes: { fullName?: string; role?: StaffRole; insurerId?: string | null; isActive?: boolean },
    actor: Principal,
  ) {
    const staff = await this.prisma.staffUser.findUnique({ where: { id } });
    if (!staff) throw ApiException.notFound('Staff account', id);

    const role = changes.role ?? staff.role;
    // Locking yourself out of the console is never what was meant.
    if (actor.id === id && changes.isActive === false) {
      throw ApiException.conflict('SELF_DEACTIVATE', 'You cannot deactivate your own account.');
    }
    if (actor.id === id && changes.role && changes.role !== staff.role) {
      throw ApiException.conflict('SELF_DEMOTE', 'You cannot change your own role.');
    }
    if (staff.role === StaffRole.SUPER_ADMIN && role !== StaffRole.SUPER_ADMIN) {
      await this.guardLastAdmin(id);
    }
    if (changes.isActive === false) await this.guardLastAdmin(id);

    const insurerId =
      changes.insurerId !== undefined || changes.role !== undefined
        ? await this.resolveInsurer(role, changes.insurerId ?? staff.insurerId)
        : staff.insurerId;

    const updated = await this.prisma.staffUser.update({
      where: { id },
      data: {
        ...(changes.fullName !== undefined ? { fullName: changes.fullName.trim() } : {}),
        ...(changes.role !== undefined ? { role: changes.role } : {}),
        ...(changes.isActive !== undefined ? { isActive: changes.isActive } : {}),
        insurerId,
      },
      select: STAFF_SELECT,
    });

    this.logger.log(`Staff account updated: ${updated.email}`);
    return this.serialiseStaff(updated);
  }

  /** Issues a new temporary password, shown once and forced to change at sign-in. */
  async resetStaffPassword(id: string) {
    const staff = await this.prisma.staffUser.findUnique({ where: { id }, select: { email: true } });
    if (!staff) throw ApiException.notFound('Staff account', id);

    const password = temporaryPassword();
    await this.prisma.staffUser.update({
      where: { id },
      data: { passwordHash: await hashPassword(password), mustChangePassword: true },
    });

    this.logger.log(`Password reset for staff account ${staff.email}`);
    return { temporaryPassword: password };
  }

  /**
   * Deactivates rather than deletes: a staff row is referenced by the PIA
   * changes and documents that account touched, and that history has to stand.
   */
  async deactivateStaff(id: string, actor: Principal) {
    if (actor.id === id) {
      throw ApiException.conflict('SELF_DEACTIVATE', 'You cannot deactivate your own account.');
    }
    const staff = await this.prisma.staffUser.findUnique({ where: { id } });
    if (!staff) throw ApiException.notFound('Staff account', id);
    await this.guardLastAdmin(id);

    const updated = await this.prisma.staffUser.update({
      where: { id },
      data: { isActive: false },
      select: STAFF_SELECT,
    });
    this.logger.log(`Staff account deactivated: ${updated.email}`);
    return this.serialiseStaff(updated);
  }

  // ── Customers (read-only, plus suspension) ──────────────────────

  async listCustomers(query: string, limit: number) {
    const search = query.trim();
    const customers = await this.prisma.customer.findMany({
      where: search
        ? {
            OR: [
              { fullName: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search } },
            ],
          }
        : {},
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        suspendedAt: true,
        deletedAt: true,
        lastLoginAt: true,
        createdAt: true,
        _count: { select: { policies: true, quoteRequests: true, claims: true } },
      },
    });

    return customers.map((customer) => ({
      id: customer.id,
      fullName: customer.fullName,
      email: customer.email,
      phone: customer.phone.startsWith('pending:') ? null : customer.phone,
      status: customer.deletedAt ? 'Closed' : customer.suspendedAt ? 'Suspended' : 'Active',
      policies: customer._count.policies,
      quoteRequests: customer._count.quoteRequests,
      claims: customer._count.claims,
      lastLoginAt: customer.lastLoginAt?.toISOString() ?? null,
      createdAt: customer.createdAt.toISOString(),
    }));
  }

  /**
   * Bars sign-in without touching the records. An active policy is a reason to
   * be careful, not a reason to refuse: suspension is how fraud gets stopped.
   */
  async setCustomerSuspended(id: string, suspended: boolean) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw ApiException.notFound('Customer', id);
    if (customer.deletedAt) {
      throw ApiException.conflict('ACCOUNT_CLOSED', 'This account has already been closed.');
    }

    await this.prisma.customer.update({
      where: { id },
      data: { suspendedAt: suspended ? new Date() : null },
    });
    this.logger.log(`Customer ${id} ${suspended ? 'suspended' : 'restored'}`);
    return { id, status: suspended ? 'Suspended' : 'Active' };
  }

  // ── Helpers ─────────────────────────────────────────────────────

  private serialiseStaff(row: {
    insurer: { id: string; name: string } | null;
    lastLoginAt: Date | null;
    createdAt: Date;
    [key: string]: unknown;
  }) {
    const { insurer, lastLoginAt, createdAt, ...rest } = row;
    return {
      ...rest,
      insurerName: insurer?.name ?? null,
      lastLoginAt: lastLoginAt?.toISOString() ?? null,
      createdAt: createdAt.toISOString(),
    };
  }

  /** An insurer login without an insurer would see every insurer's work. */
  private async resolveInsurer(role: StaffRole, insurerId: string | null) {
    if (role !== StaffRole.INSURER_USER) return null;
    if (!insurerId) {
      throw ApiException.conflict(
        'INSURER_REQUIRED',
        'Choose the insurer whose portal this account should see.',
      );
    }
    const insurer = await this.prisma.insurer.findUnique({
      where: { id: insurerId },
      select: { id: true },
    });
    if (!insurer) throw ApiException.notFound('Insurer', insurerId);
    return insurer.id;
  }

  /** There must always be someone left who can get back into the console. */
  private async guardLastAdmin(excludingId: string) {
    const remaining = await this.prisma.staffUser.count({
      where: {
        id: { not: excludingId },
        isActive: true,
        role: { in: [StaffRole.SUPER_ADMIN, StaffRole.ADMIN] },
      },
    });
    if (remaining === 0) {
      throw ApiException.conflict(
        'LAST_ADMINISTRATOR',
        'This is the only active administrator. Add another before changing this one.',
      );
    }
  }
}
