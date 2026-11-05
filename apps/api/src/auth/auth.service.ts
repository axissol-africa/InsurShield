import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/errors/api.exception.js';
import type { Principal } from '../common/auth/auth.types.js';
import { shownPhone } from '../common/auth/phone.js';
import type { Transaction } from '../db/database.module.js';
import { AuthRepository } from './auth.repository.js';

export interface StaffSession {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'insurer' | 'support';
  isSuperAdmin: boolean;
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
  constructor(private readonly repository: AuthRepository) {}

  /** Who the caller is: the domain record behind the session, and the Better Auth user the session belongs to. */
  async me(principal: Principal): Promise<{
    userId: string | null;
    customer: unknown;
    consent?: { accepted: boolean; noticeVersion: string | null; acceptedAt: string | null };
    staffSession: StaffSession | null;
  }> {
    if (principal.kind === 'staff') {
      const staff = await this.repository.findStaffSession(principal.id);
      if (!staff) throw ApiException.unauthorized();

      return {
        userId: staff.userId,
        customer: null,
        staffSession: {
          id: staff.id,
          name: staff.fullName,
          email: staff.email,
          role: PORTAL_ROLE[principal.role],
          isSuperAdmin: principal.role === 'SUPER_ADMIN',
          insurerId: staff.insurerId,
          insurerName: staff.insurerName,
        },
      };
    }

    const profile = await this.repository.findCustomerProfile(principal.id);
    if (!profile) throw ApiException.unauthorized();
    // Most recent acceptance only; the rest is the audit trail.
    const consent = await this.repository.findLatestConsent(principal.id);

    return {
      userId: profile.userId,
      customer: {
        id: profile.id,
        fullName: profile.fullName,
        email: profile.email,
        phone: shownPhone(profile.phone),
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

    const record = await this.repository.insertConsent({
      customerId: principal.id,
      privacyVersion: noticeVersion,
      termsVersion: noticeVersion,
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
    });

    return {
      accepted: true,
      noticeVersion: record.privacyVersion,
      acceptedAt: record.acceptedAt.toISOString(),
    };
  }

  /** Ends every session of the user, in the caller's transaction. */
  async revokeSessions(tx: Transaction, userId: string): Promise<void> {
    await this.repository.deleteSessions(tx, userId);
  }
}
