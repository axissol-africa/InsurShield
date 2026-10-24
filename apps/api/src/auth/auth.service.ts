import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/errors/api.exception.js';
import type { Principal, StaffRoleName } from '../common/auth/auth.types.js';
import { ACCOUNT_CLOSED } from '../common/auth/messages.js';
import { AuthRepository } from './auth.repository.js';

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
  constructor(private readonly repository: AuthRepository) {}

  /**
   * Staff are pre-provisioned, because `insurerId` is a relationship this
   * service owns and Keycloak knows nothing about. A token carrying a staff
   * role with no matching row is refused rather than silently upgraded.
   */
  async resolveStaff(keycloakId: string, email: string, role: StaffRoleName): Promise<Principal> {
    const staff = await this.repository.findStaffByKeycloakId(keycloakId);
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

  /**
   * Customers are created on first call, so signup lives entirely in Keycloak.
   * The web fires several requests at sign-in, so the first ones race to create the row.
   */
  async resolveCustomer(keycloakId: string, email: string, name: string): Promise<Principal> {
    const existing = await this.repository.findCustomerByKeycloakId(keycloakId);
    if (existing) return this.customerPrincipal(existing);

    if (!email) {
      throw ApiException.unauthorized('Your account is missing an email address.');
    }

    await this.repository.insertCustomerIfAbsent({
      keycloakId,
      email: email.toLowerCase(),
      fullName: name || email,
      // Keycloak's signup does not collect a phone number, so this placeholder,
      // namespaced by the Keycloak id, satisfies the unique constraint on `phone`.
      phone: `pending:${keycloakId}`,
    });

    const created = await this.repository.findCustomerByKeycloakId(keycloakId);
    if (!created) {
      throw ApiException.conflict(
        'ACCOUNT_CONFLICT',
        'Another InsurShield account already uses this email address or phone number.',
      );
    }
    return this.customerPrincipal(created);
  }

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
      const staff = await this.repository.findStaffSession(principal.id);
      if (!staff) throw ApiException.unauthorized();

      return {
        customer: null,
        staffSession: {
          id: staff.id,
          name: staff.fullName,
          email: staff.email,
          role: PORTAL_ROLE[principal.role],
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
      customer: {
        id: profile.id,
        fullName: profile.fullName,
        email: profile.email,
        // The placeholder set at provisioning time is not a real number.
        phone: profile.phone.startsWith('pending:') ? null : profile.phone,
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

  private customerPrincipal(customer: { id: string; email: string; deletedAt: Date | null }): Principal {
    if (customer.deletedAt) throw ApiException.forbidden(ACCOUNT_CLOSED);
    return { kind: 'customer', id: customer.id, email: customer.email };
  }
}
