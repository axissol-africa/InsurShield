import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ApiException } from '../common/errors/api.exception.js';
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

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Who the caller is. Authentication itself happens against Keycloak — this
   * returns the domain record behind the verified token.
   */
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
