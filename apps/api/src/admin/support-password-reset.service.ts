import { randomBytes } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { AUTH_SETTINGS, PASSWORD_RESET_TOKEN_LIFETIME_SECONDS, SUPPORT_PASSWORD_RESET_MAX_PER_CUSTOMER, SUPPORT_PASSWORD_RESET_MAX_PER_STAFF, SUPPORT_PASSWORD_RESET_WINDOW_SECONDS, identityBasePath } from '../auth/auth.constants.js';
import type { AuthSettings } from '../auth/auth.instance.js';
import { normalizeEmail } from '../auth/credential-user.js';
import { sendPasswordResetEmail } from '../auth/identity-mailer.js';
import { auditActor } from '../common/audit/audit.types.js';
import { AuditService } from '../common/audit/audit.service.js';
import type { Principal } from '../common/auth/auth.types.js';
import { ApiException } from '../common/errors/api.exception.js';
import { type Transaction } from '../db/database.module.js';
import { MAIL_SENDER, type MailSender } from '../mail/mail.port.js';
import type { SupportPasswordResetDto } from './dto/support-password-reset.dto.js';
import { SupportPasswordResetRepository, type SupportResetTarget } from './support-password-reset.repository.js';

type StaffPrincipal = Extract<Principal, { kind: 'staff' }>;

interface RequestedReset {
  attempt: { id: string; createdAt: Date };
  customer: SupportResetTarget & { userId: string };
}

/**
 * A deliberate administrative recovery path. The request/audit transaction
 * commits before an external email provider is touched; its eventual result is
 * written in a second atomic update without ever handing a reset secret to the
 * administrator.
 */
@Injectable()
export class SupportPasswordResetService {
  private readonly logger = new Logger(SupportPasswordResetService.name);

  constructor(
    private readonly resets: SupportPasswordResetRepository,
    private readonly audit: AuditService,
    @Inject(MAIL_SENDER) private readonly mail: MailSender,
    @Inject(AUTH_SETTINGS) private readonly authSettings: AuthSettings,
  ) {}

  async request(principal: StaffPrincipal, dto: SupportPasswordResetDto) {
    let requested: RequestedReset;
    try {
      requested = await this.resets.transaction((tx) => this.recordRequest(tx, principal, dto));
    } catch (error) {
      await this.auditRefusal(principal, dto.customerId, error);
      throw error;
    }

    let prepared: { token: string; verificationId: string } | undefined;
    let delivered = false;
    try {
      prepared = await this.prepareToken(requested, dto.confirmationEmail);
      const receipt = await sendPasswordResetEmail(this.mail, {
        user: { email: requested.customer.email },
        url: this.resetUrl(prepared.token),
        token: prepared.token,
      });
      delivered = true;

      await this.resets.transaction(async (tx) => {
        await this.resets.markDelivered(tx, {
          id: requested.attempt.id,
          provider: receipt.provider,
          providerReference: receipt.providerReference,
          deliveredAt: new Date(),
        });
        await this.audit.write(tx, {
          actor: auditActor(principal),
          action: 'customer_password_reset.delivered',
          entityType: 'SUPPORT_PASSWORD_RESET',
          entityId: requested.attempt.id,
          after: { deliveryStatus: 'DELIVERED', deliveryChannel: 'EMAIL', provider: receipt.provider },
          note: 'The administrator-requested password-reset email was accepted by the delivery provider.',
          correlationId: requested.customer.id,
        });
      });

      return { id: requested.attempt.id, deliveryStatus: 'DELIVERED', requestedAt: requested.attempt.createdAt.toISOString() };
    } catch (error) {
      if (delivered) {
        // The customer may have a working message even though its receipt could
        // not be persisted. Never call this a failed delivery or invite a
        // duplicate send; operations can inspect the pending request instead.
        this.logger.error(`Password-reset delivery receipt could not be recorded for attempt ${requested.attempt.id}.`);
        throw new ApiException(
          'PASSWORD_RESET_STATUS_UNKNOWN',
          'The reset email may have been sent, but its delivery record could not be saved. Do not resend it yet; contact an administrator.',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }

      if (error instanceof ApiException && error.code === 'CUSTOMER_ACCOUNT_CHANGED') {
        await this.recordUndelivered(
          principal,
          requested,
          prepared?.verificationId,
          'customer_password_reset.invalidated',
          'The customer account changed before the password-reset email could be sent.',
        );
        throw error;
      }

      await this.recordFailedDelivery(principal, requested, prepared?.verificationId);
      throw new ApiException(
        'PASSWORD_RESET_DELIVERY_FAILED',
        'The reset request was recorded, but the email could not be delivered. Please try again later.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  private async recordRequest(tx: Transaction, principal: StaffPrincipal, dto: SupportPasswordResetDto): Promise<RequestedReset> {
    const confirmationEmail = normalizeEmail(dto.confirmationEmail);
    await this.resets.lockRateBuckets(tx, principal.id);
    const customer = await this.resets.lockOpenCustomer(tx, dto.customerId);
    if (!customer?.userId) throw ApiException.notFound('Customer account');
    if (customer.email !== confirmationEmail) {
      throw ApiException.forbidden('Re-enter the customer email address exactly before requesting a reset.');
    }

    const now = new Date();
    const since = new Date(now.getTime() - SUPPORT_PASSWORD_RESET_WINDOW_SECONDS * 1000);
    const [customerAttempts, staffAttempts] = await Promise.all([
      this.resets.attemptsForCustomerSince(tx, customer.id, since),
      this.resets.attemptsForStaffSince(tx, principal.id, since),
    ]);
    if (customerAttempts >= SUPPORT_PASSWORD_RESET_MAX_PER_CUSTOMER) {
      throw new ApiException(
        'PASSWORD_RESET_RATE_LIMITED',
        'This customer has reached the password-reset limit. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (staffAttempts >= SUPPORT_PASSWORD_RESET_MAX_PER_STAFF) {
      throw new ApiException(
        'PASSWORD_RESET_RATE_LIMITED',
        'You have reached the password-reset limit. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const attempt = await this.resets.createAttempt(tx, { customerId: customer.id, staffId: principal.id, reason: dto.reason });
    await this.audit.write(tx, {
      actor: auditActor(principal),
      action: 'customer_password_reset.requested',
      entityType: 'SUPPORT_PASSWORD_RESET',
      entityId: attempt.id,
      after: { deliveryStatus: 'PENDING', deliveryChannel: 'EMAIL' },
      note: dto.reason,
      correlationId: customer.id,
    });
    return { attempt, customer: { ...customer, userId: customer.userId } };
  }

  /** Re-lock after the audit commit so a closed or changed account is never mailed. */
  private async prepareToken(requested: RequestedReset, confirmationEmail: string) {
    return this.resets.transaction(async (tx) => {
      const current = await this.resets.lockOpenCustomer(tx, requested.customer.id);
      if (!current?.userId || current.userId !== requested.customer.userId || current.email !== normalizeEmail(confirmationEmail)) {
        throw ApiException.conflict('CUSTOMER_ACCOUNT_CHANGED', 'The customer account changed. Search again before requesting a reset.');
      }
      const token = randomBytes(32).toString('base64url');
      const verification = await this.resets.createToken(tx, {
        userId: current.userId,
        token,
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TOKEN_LIFETIME_SECONDS * 1000),
      });
      return { token, verificationId: verification.id };
    });
  }

  private resetUrl(token: string) {
    const link = new URL(`${identityBasePath(this.authSettings.API_PREFIX)}/reset-password/${token}`, this.authSettings.BETTER_AUTH_URL);
    link.searchParams.set('callbackURL', `${this.authSettings.CORS_ORIGINS[0]}/reset-password`);
    return link.toString();
  }

  private async recordFailedDelivery(
    principal: StaffPrincipal,
    requested: RequestedReset,
    verificationId: string | undefined,
  ): Promise<void> {
    await this.recordUndelivered(
      principal,
      requested,
      verificationId,
      'customer_password_reset.delivery_failed',
      'The administrator-requested password-reset email could not be delivered.',
    );
  }

  /** Records any request that could not progress to delivery and removes its unused credential. */
  private async recordUndelivered(
    principal: StaffPrincipal,
    requested: RequestedReset,
    verificationId: string | undefined,
    action: 'customer_password_reset.delivery_failed' | 'customer_password_reset.invalidated',
    note: string,
  ): Promise<void> {
    try {
      await this.resets.transaction(async (tx) => {
        if (verificationId) await this.resets.deleteToken(tx, verificationId);
        await this.resets.markFailed(tx, requested.attempt.id, new Date());
        await this.audit.write(tx, {
          actor: auditActor(principal),
          action,
          entityType: 'SUPPORT_PASSWORD_RESET',
          entityId: requested.attempt.id,
          after: { deliveryStatus: 'FAILED', deliveryChannel: 'EMAIL' },
          note,
          correlationId: requested.customer.id,
        });
      });
    } catch {
      this.logger.error(`Password-reset undelivered status could not be recorded for attempt ${requested.attempt.id}.`);
    }
  }

  private async auditRefusal(principal: StaffPrincipal, customerId: string, error: unknown): Promise<void> {
    if (!(error instanceof ApiException) || ![
      'FORBIDDEN',
      'PASSWORD_RESET_RATE_LIMITED',
      'CUSTOMER_ACCOUNT_CHANGED',
    ].includes(error.code)) return;
    await this.audit.refusal({
      actor: auditActor(principal),
      action: 'customer_password_reset.refused',
      entityType: 'CUSTOMER_ACCOUNT',
      entityId: customerId,
      after: { reason: error.code },
      note: 'A support password-reset request was refused.',
      correlationId: customerId,
    });
  }
}
