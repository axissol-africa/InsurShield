import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ApiException } from '../common/errors/api.exception.js';
import { TokenService } from '../common/auth/token.service.js';
import { hashPassword, verifyPassword } from '../common/auth/password.js';
import type { Principal } from '../common/auth/auth.types.js';

export interface StaffSession {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'insurer' | 'support';
  insurerId: string | null;
  insurerName: string | null;
}

/** Maps the stored role onto the shorthand the staff portals already use. */
const PORTAL_ROLE = {
  SUPER_ADMIN: 'admin',
  ADMIN: 'admin',
  INSURER_USER: 'insurer',
} as const;

/** Normalised so "  Me@Example.ZM " and "me@example.zm" are one account. */
const normaliseEmail = (value: string) => value.trim().toLowerCase();

/** Zambian numbers get typed with and without the country code; compare on digits. */
const normalisePhone = (value: string) => value.replace(/[^0-9]/g, '');

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  // ── Sign up and sign in ─────────────────────────────────────────

  /**
   * Opens a customer account. Email and phone are each unique, and the
   * clash is reported as one message for both: telling someone *which* of the
   * two is taken confirms that an account exists, which is not ours to reveal.
   */
  async register(input: { fullName: string; email: string; phone: string; password: string }) {
    const email = normaliseEmail(input.email);
    const phone = input.phone.trim();

    const existing = await this.prisma.customer.findFirst({
      where: { OR: [{ email }, { phone }] },
      select: { id: true },
    });
    if (existing) {
      throw ApiException.conflict(
        'ACCOUNT_EXISTS',
        'An account already exists for that email address or mobile number. Try signing in instead.',
      );
    }

    const customer = await this.prisma.customer.create({
      data: {
        fullName: input.fullName.trim(),
        email,
        phone,
        passwordHash: await hashPassword(input.password),
        lastLoginAt: new Date(),
      },
      select: { id: true, fullName: true, email: true, phone: true },
    });

    this.logger.log(`Customer registered: ${customer.id}`);
    return {
      customer,
      consent: { accepted: false, noticeVersion: null, acceptedAt: null },
      token: await this.tokens.issue({ sub: customer.id, kind: 'customer', email: customer.email }),
    };
  }

  /**
   * Signs a customer in with either their email address or their mobile number.
   *
   * Numbers are stored as they were typed, because that is what claims and
   * documents show, so the match is made on digits alone: 0975 550 101,
   * +260975550101 and 260 975 550 101 all find the same account. The last nine
   * digits are what identify a Zambian subscriber, country code or not.
   */
  async login(identifier: string, password: string) {
    const value = identifier.trim();
    const digits = normalisePhone(value);
    const customer =
      (await this.prisma.customer.findFirst({ where: { email: normaliseEmail(value) } })) ??
      (digits.length >= 9 ? await this.findByPhone(digits.slice(-9)) : null);

    // One message whether the account is missing or the password is wrong, so
    // sign-in cannot be used to find out which addresses are registered.
    if (!customer || !(await verifyPassword(password, customer.passwordHash))) {
      throw ApiException.unauthorized('Incorrect email/phone or password.');
    }
    if (customer.deletedAt) throw ApiException.forbidden('This account has been closed.');
    if (customer.suspendedAt) {
      throw ApiException.forbidden('This account has been suspended. Please contact support.');
    }

    await this.prisma.customer.update({
      where: { id: customer.id },
      data: { lastLoginAt: new Date() },
    });

    const consent = await this.prisma.consentRecord.findFirst({
      where: { customerId: customer.id },
      orderBy: { acceptedAt: 'desc' },
      select: { privacyVersion: true, acceptedAt: true },
    });

    return {
      customer: {
        id: customer.id,
        fullName: customer.fullName,
        email: customer.email,
        phone: customer.phone.startsWith('pending:') ? null : customer.phone,
      },
      consent: consent
        ? { accepted: true, noticeVersion: consent.privacyVersion, acceptedAt: consent.acceptedAt.toISOString() }
        : { accepted: false, noticeVersion: null, acceptedAt: null },
      token: await this.tokens.issue({ sub: customer.id, kind: 'customer', email: customer.email }),
    };
  }

  /**
   * Finds a customer by the last nine digits of their number, ignoring spaces,
   * brackets and the country code. This scans rather than seeks; at the point
   * where that matters, store the normalised digits in their own indexed column.
   */
  private async findByPhone(lastNine: string) {
    const [match] = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM customers
      WHERE regexp_replace(phone, '[^0-9]', '', 'g') LIKE ${`%${lastNine}`}
      LIMIT 1
    `;
    return match ? this.prisma.customer.findUnique({ where: { id: match.id } }) : null;
  }

  /** Signs a staff member into the admin or insurer portal. */
  async staffLogin(email: string, password: string) {
    const staff = await this.prisma.staffUser.findUnique({
      where: { email: normaliseEmail(email) },
      include: { insurer: { select: { id: true, name: true } } },
    });

    if (!staff || !(await verifyPassword(password, staff.passwordHash))) {
      throw ApiException.unauthorized('Incorrect email or password.');
    }
    if (!staff.isActive) {
      throw ApiException.forbidden('This staff account is not active on InsurShield.');
    }

    await this.prisma.staffUser.update({
      where: { id: staff.id },
      data: { lastLoginAt: new Date() },
    });

    return {
      session: {
        id: staff.id,
        name: staff.fullName,
        email: staff.email,
        role: PORTAL_ROLE[staff.role],
        insurerId: staff.insurerId,
        insurerName: staff.insurer?.name ?? null,
        mustChangePassword: staff.mustChangePassword,
      },
      token: await this.tokens.issue({
        sub: staff.id,
        kind: 'staff',
        email: staff.email,
        role: staff.role,
        insurerId: staff.insurerId,
      }),
    };
  }

  /**
   * Changes the caller's own password. The current one is required even though
   * they are already signed in, so a borrowed session cannot lock the owner out.
   */
  async changePassword(principal: Principal, currentPassword: string, newPassword: string) {
    const table = principal.kind === 'staff' ? this.prisma.staffUser : this.prisma.customer;
    const row = await (table as typeof this.prisma.staffUser).findUnique({
      where: { id: principal.id },
      select: { id: true, passwordHash: true },
    });
    if (!row) throw ApiException.unauthorized();

    if (!(await verifyPassword(currentPassword, row.passwordHash))) {
      throw ApiException.conflict('WRONG_PASSWORD', 'Your current password is not correct.');
    }

    const passwordHash = await hashPassword(newPassword);
    if (principal.kind === 'staff') {
      await this.prisma.staffUser.update({
        where: { id: principal.id },
        data: { passwordHash, mustChangePassword: false },
      });
    } else {
      await this.prisma.customer.update({ where: { id: principal.id }, data: { passwordHash } });
    }

    this.logger.log(`Password changed for ${principal.kind} ${principal.id}`);
    return { ok: true };
  }

  // ── The caller behind a verified token ──────────────────────────

  /** Who the caller is: the domain record behind the verified token. */
  async me(principal: Principal): Promise<{
    customer: unknown;
    consent?: { accepted: boolean; noticeVersion: string | null; acceptedAt: string | null };
    staffSession: StaffSession | null;
  }> {
    if (principal.kind === 'staff') {
      const staff = await this.prisma.staffUser.findUnique({
        where: { id: principal.id },
        include: { insurer: { select: { id: true, name: true } } },
      });
      if (!staff) throw ApiException.unauthorized();

      return {
        customer: null,
        staffSession: {
          id: staff.id,
          name: staff.fullName,
          email: staff.email,
          role: PORTAL_ROLE[principal.role],
          insurerId: staff.insurerId,
          insurerName: staff.insurer?.name ?? null,
        },
      };
    }

    const customer = await this.prisma.customer.findUnique({
      where: { id: principal.id },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        // Most recent acceptance only; the rest is the audit trail.
        consents: {
          orderBy: { acceptedAt: 'desc' },
          take: 1,
          select: { privacyVersion: true, termsVersion: true, acceptedAt: true },
        },
      },
    });
    if (!customer) throw ApiException.unauthorized();

    const { consents, ...profile } = customer;
    const consent = consents[0] ?? null;

    return {
      customer: {
        ...profile,
        // The placeholder set at provisioning time is not a real number.
        phone: profile.phone.startsWith('pending:') ? null : profile.phone,
        // PARKED: `phoneVerified` returns here once SMS verification is built.
      },
      // Consent belongs to the customer, not the browser session, so signing
      // out and back in must not ask for it again.
      consent: consent
        ? { accepted: true, noticeVersion: consent.privacyVersion, acceptedAt: consent.acceptedAt.toISOString() }
        : { accepted: false, noticeVersion: null, acceptedAt: null },
      staffSession: null,
    };
  }

  /**
   * Records an acceptance of the privacy notice and terms. Append-only: a
   * customer re-accepting a new version adds a row rather than replacing one,
   * so the trail of what was agreed and when stays intact.
   */
  async acceptConsent(
    principal: Principal,
    noticeVersion: string,
    context: { ipAddress?: string; userAgent?: string },
  ) {
    if (principal.kind !== 'customer') {
      throw ApiException.forbidden('Only a customer account can accept these terms.');
    }

    const record = await this.prisma.consentRecord.create({
      data: {
        customerId: principal.id,
        privacyVersion: noticeVersion,
        termsVersion: noticeVersion,
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
      },
      select: { privacyVersion: true, acceptedAt: true },
    });

    return {
      accepted: true,
      noticeVersion: record.privacyVersion,
      acceptedAt: record.acceptedAt.toISOString(),
    };
  }
}
