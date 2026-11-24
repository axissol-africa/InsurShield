import { Inject, Injectable, Logger } from '@nestjs/common';
import { MAIL_SENDER, type MailSender } from '../mail/mail.port.js';
import { AuditService } from '../common/audit/audit.service.js';
import type { AuditActor } from '../common/audit/audit.types.js';
import type { QuoteProductStatus } from '../common/domain/enums.js';
import { ApiException } from '../common/errors/api.exception.js';
import type { Transaction } from '../db/database.module.js';
import { JobsRepository } from '../jobs/jobs.repository.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { nextStatus, type QuoteProductEvent } from './domain/quote-workflow.js';
import { QuoteProductsRepository, type VersionPatch, type VersionRow } from './quote-products.repository.js';

export const QUOTE_WORKFLOW_SWEEP = 'quote-workflow.sweep';
export const QUOTE_WORKFLOW_SWEEP_INTERVAL_MS = 60 * 60_000;
export const QUOTE_WORKFLOW_SWEEP_BATCH = 500;
/** An email to insurer staff about their own work. Customers are told through notifications instead. */
export const QUOTE_STAFF_EMAIL = 'quote-workflow.staff-email';

const SYSTEM: AuditActor = { type: 'SYSTEM', id: null };
const DAY_MS = 24 * 60 * 60 * 1000;

/** One sweep per hour, so a restart cannot queue the same work twice. */
export function quoteWorkflowSweepKey(at: Date): string {
  return at.toISOString().slice(0, 13);
}

/** A date as a customer in Zambia reads it, for a notification. */
export function customerDate(at: Date): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lusaka' }).format(at);
}

/**
 * Moves chosen product versions through their states. Every change is checked
 * against the transition table, written only if nobody moved the version
 * first, and recorded in the state history with who did it and why.
 */
@Injectable()
export class QuoteWorkflowService {
  private readonly logger = new Logger(QuoteWorkflowService.name);

  constructor(
    private readonly versions: QuoteProductsRepository,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    private readonly jobs: JobsRepository,
    @Inject(MAIL_SENDER) private readonly mail: MailSender,
  ) {}

  /** The reply due date for a version chosen at `submittedAt`, from the deadline rule in force then. */
  async replyDueAt(submittedAt: Date, tx?: Transaction): Promise<Date> {
    const { value } = await this.settings.effective('QUOTE_REPLY_DEADLINE', submittedAt, tx);
    return new Date(submittedAt.getTime() + value.days * DAY_MS);
  }

  /** How long before a reply is due its owner is warned, as the rule in force says. */
  slaWarning(now = new Date(), tx?: Transaction) {
    return this.settings.effective('QUOTE_SLA_WARNING', now, tx);
  }

  /** The add-ons a quote may offer, from the catalogue in force. */
  async addOnCatalogue(now = new Date(), tx?: Transaction) {
    return (await this.settings.effective('ADD_ON_CATALOGUE', now, tx)).value.addOns;
  }

  /** The approved decline reasons in force now. */
  async declineReasons(now = new Date(), tx?: Transaction) {
    const { value } = await this.settings.effective('QUOTE_DECLINE_REASONS', now, tx);
    return value.reasons;
  }

  /**
   * Refuses an insurer action on a version whose reply deadline has passed
   * while the clock was running. The sweep marks it timed out within the hour;
   * until then it is treated as already timed out, so the hour never matters.
   */
  assertWithinDeadline(version: VersionRow, now: Date): void {
    if (version.pausedAt || !version.replyDueAt) return;
    if (version.replyDueAt <= now && (version.status === 'SUBMITTED' || version.status === 'INSURER_PROCESSING')) {
      throw ApiException.conflict(
        'REPLY_DEADLINE_PASSED',
        'The reply deadline for this product has passed. The customer can request fresh quotes.',
      );
    }
  }

  /** Why `event` cannot happen to a version in `status`, in words the caller can act on. */
  refusal(status: QuoteProductStatus, event: QuoteProductEvent): ApiException {
    if (status === 'INSPECTION_REQUIRED' && event === 'QUOTE') {
      return ApiException.conflict(
        'INSPECTION_REQUIRED',
        'This product needs a vehicle inspection before it can be quoted. Arrange the inspection with the customer first.',
      );
    }
    if (status === 'VERIFICATION_REQUIRED' && event === 'REQUEST_INFORMATION') {
      return ApiException.conflict(
        'INFORMATION_ALREADY_REQUESTED',
        'You have already asked the customer for information about this product. Wait for their answer.',
      );
    }
    if (event === 'CUSTOMER_ANSWERED') {
      return ApiException.conflict('NO_OPEN_QUESTION', 'The insurer is not waiting for an answer about this product.');
    }
    const closed: Partial<Record<QuoteProductStatus, [string, string]>> = {
      QUOTED: ['ALREADY_QUOTED', 'This product has already been quoted.'],
      DECLINED: ['ALREADY_DECLINED', 'This product has already been declined.'],
      TIMED_OUT: ['REPLY_DEADLINE_PASSED', 'The reply deadline for this product has passed. The customer can request fresh quotes.'],
      EXPIRED: ['QUOTE_EXPIRED', 'The quote for this product has expired.'],
      CANCELLED: ['PRODUCT_VERSION_UNAVAILABLE', 'This selected product is no longer available to quote.'],
    };
    const [code, message] = closed[status] ?? ['INVALID_TRANSITION', 'This product cannot change that way from where it is now.'];
    return ApiException.conflict(code, message);
  }

  /**
   * Applies `event` to a locked version. Leaving VERIFICATION_REQUIRED for any
   * reason but an answer closes the open question unanswered, so it can no
   * longer be answered into a version that has moved on.
   */
  async move(
    tx: Transaction,
    version: VersionRow,
    event: QuoteProductEvent,
    input: { actor: AuditActor; note: string; at: Date; patch?: VersionPatch },
  ): Promise<QuoteProductStatus> {
    const to = nextStatus(version.status, event);
    if (!to) throw this.refusal(version.status, event);
    const moved = await this.versions.move(tx, version.id, version.status, to, input.at, input.patch);
    if (!moved) {
      throw ApiException.conflict('VERSION_CHANGED', 'This product changed while you were working on it. Reload and try again.');
    }
    if (version.status === 'VERIFICATION_REQUIRED' && event !== 'CUSTOMER_ANSWERED') {
      await this.versions.closeOpenInformationRequest(tx, version.quoteRequestId, version.productVersionId, input.at);
    }
    await this.audit.transition(tx, {
      actor: input.actor,
      entityType: 'QUOTE_REQUEST_PRODUCT',
      entityId: version.id,
      fromStatus: version.status,
      toStatus: to,
      note: input.note,
      correlationId: version.quoteRequestId,
    });
    return to;
  }

  /**
   * Decision 24 for one insurer's chosen versions: every one still open or
   * quoted but unpaid is cancelled; a paid one keeps its state and is only
   * marked. Returns the requests whose customers must be told.
   */
  async cancelForSuspendedInsurer(tx: Transaction, insurerId: string, at: Date): Promise<string[]> {
    const affected = new Set<string>();
    for (const version of await this.versions.lockCancellableForInsurer(tx, insurerId)) {
      if (version.paid || !nextStatus(version.status, 'CANCEL')) {
        await this.versions.markCancelled(tx, version.id, at);
      } else {
        await this.move(tx, version, 'CANCEL', {
          actor: SYSTEM,
          note: 'The insurer became unavailable.',
          at,
          patch: { cancelledAt: at, cancelledReason: 'INSURER_SUSPENDED', pausedAt: null },
        });
      }
      affected.add(version.quoteRequestId);
    }
    return [...affected];
  }

  // ── Hourly sweep ───────────────────────────────────────────────

  async schedule(at: Date): Promise<void> {
    await this.jobs.transaction((tx) =>
      this.jobs.enqueue(tx, { kind: QUOTE_WORKFLOW_SWEEP, key: quoteWorkflowSweepKey(at), payload: {}, runAfter: at }),
    );
  }

  /** Warns owners of products nearly due, times out those nobody answered, then expires quotes nobody paid. */
  async sweep(now = new Date()): Promise<{ warned: number; timedOut: number; expired: number }> {
    await this.schedule(new Date(now.getTime() + QUOTE_WORKFLOW_SWEEP_INTERVAL_MS));
    const warned = await this.warnDue(now);
    const timedOut = await this.timeOutDue(now);
    const expired = await this.expireDue(now);
    if (warned + timedOut + expired > 0) {
      this.logger.log(`Warned ${warned}, timed out ${timedOut} and expired ${expired} chosen products`);
    }
    if ([warned, timedOut, expired].includes(QUOTE_WORKFLOW_SWEEP_BATCH)) await this.schedule(now);
    return { warned, timedOut, expired };
  }

  /**
   * Emails the owner of each product whose reply is nearly due, or the
   * insurer's administrators when nobody owns it yet. Each product is warned
   * once; the email is a job, so a mail outage delays it rather than losing it.
   */
  async warnDue(now: Date): Promise<number> {
    const { value } = await this.slaWarning(now);
    let count = 0;
    for (const due of await this.versions.dueForWarning(now, value.hoursBeforeDue, QUOTE_WORKFLOW_SWEEP_BATCH)) {
      const warned = await this.versions.transaction(async (tx) => {
        if (!(await this.versions.markWarned(tx, due.id, now))) return false;
        const owner = due.assignedStaffId
          ? await this.versions.insurerStaffMember(due.insurerId, due.assignedStaffId, tx)
          : undefined;
        const recipients = owner
          ? [owner]
          : await this.versions.insurerStaffWithRoles(due.insurerId, ['INSURER_ADMIN'], tx);
        for (const recipient of recipients) {
          await this.jobs.enqueue(tx, {
            kind: QUOTE_STAFF_EMAIL,
            key: `sla-warning:${due.id}:${recipient.id}`,
            payload: {
              to: recipient.email,
              subject: `Reply due soon: ${due.productName} on ${due.quoteRequestId}`,
              body:
                `The reply for ${due.productName} on quote request ${due.quoteRequestId} is due by ` +
                `${customerDate(due.replyDueAt!)}. Open the InsurShield insurer portal to quote, ask the ` +
                'customer for information or decline it. After the due date the customer can no longer receive your quote.',
            },
          });
        }
        return true;
      });
      if (warned) count += 1;
    }
    return count;
  }

  /** Sends one staff email; a retryable failure is thrown so the runner tries again later. */
  async sendStaffEmail(key: string, payload: { to: string; subject: string; body: string }): Promise<void> {
    const result = await this.mail.send({ ...payload, idempotencyKey: `quote-workflow:${key}` });
    if (result.result === 'sent') return;
    if (!result.retryable) {
      this.logger.error(`Mail refused for staff email ${key}: ${result.reason}`);
      return;
    }
    throw new Error(`Mail provider unavailable for staff email ${key}: ${result.reason}`);
  }

  async timeOutDue(now: Date): Promise<number> {
    let count = 0;
    for (const due of await this.versions.dueForTimeOut(now, QUOTE_WORKFLOW_SWEEP_BATCH)) {
      const done = await this.versions.transaction(async (tx) => {
        const version = await this.versions.lock(tx, due.quoteRequestId, due.productVersionId, { insurerId: due.insurerId });
        // Re-read under the lock: the insurer may have answered, or the clock stopped, since the scan.
        if (!version || version.pausedAt || !version.replyDueAt || version.replyDueAt > now) return false;
        if (version.status !== 'SUBMITTED' && version.status !== 'INSURER_PROCESSING') return false;
        await this.move(tx, version, 'TIME_OUT', { actor: SYSTEM, note: 'No reply by the reply due date.', at: now });
        await this.notifications.notify(tx, {
          customerId: version.customerId,
          key: 'quote.version_timed_out',
          entity: { type: 'QUOTE_REQUEST', id: version.quoteRequestId },
          values: { insurer: version.insurerName, product: version.productName, quoteRequestId: version.quoteRequestId },
        });
        return true;
      });
      if (done) count += 1;
    }
    return count;
  }

  async expireDue(now: Date): Promise<number> {
    let count = 0;
    for (const due of await this.versions.dueForExpiry(now, QUOTE_WORKFLOW_SWEEP_BATCH)) {
      const done = await this.versions.transaction(async (tx) => {
        const version = await this.versions.lock(tx, due.quoteRequestId, due.productVersionId, { insurerId: due.insurerId });
        // Re-checked under the lock, so a payment confirmed since the scan keeps its quote.
        if (!version || version.status !== 'QUOTED' || !(await this.versions.isLapsedUnpaid(tx, version.id, now))) return false;
        await this.move(tx, version, 'EXPIRE', { actor: SYSTEM, note: 'The quote passed its validity date unpaid.', at: now });
        await this.notifications.notify(tx, {
          customerId: version.customerId,
          key: 'quote.expired',
          entity: { type: 'QUOTE_REQUEST', id: version.quoteRequestId },
          values: { insurer: version.insurerName, product: version.productName, quoteRequestId: version.quoteRequestId },
        });
        return true;
      });
      if (done) count += 1;
    }
    return count;
  }
}
