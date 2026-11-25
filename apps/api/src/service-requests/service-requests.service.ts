import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { AuditService } from '../common/audit/audit.service.js';
import { auditActor, type AuditActor } from '../common/audit/audit.types.js';
import type { Principal } from '../common/auth/auth.types.js';
import { isInsurerRole, type ServiceRequestStatus } from '../common/domain/enums.js';
import { lusakaDay } from '../common/domain/lusaka.js';
import { newReference } from '../common/domain/reference.js';
import { ApiException } from '../common/errors/api.exception.js';
import { kwachaToNgwee, ngweeToKwacha } from '../common/money.js';
import { QUOTE_STAFF_EMAIL, customerDate } from '../customer/quote-workflow.service.js';
import type { CustomerPrincipal } from '../customer/customer-principal.js';
import type { Transaction } from '../db/database.module.js';
import { DocumentsService, type DocumentRecord } from '../documents/documents.service.js';
import { JobsRepository } from '../jobs/jobs.repository.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RefundsRepository } from '../payments/refunds.repository.js';
import {
  canMove,
  cancellationDateProblem,
  movesFrom,
  policyProblem,
  refundTooLarge,
  statusAfter,
  type ServiceRequestAction,
} from './domain/service-request.js';
import type {
  AdminServiceRequestQuery,
  ApproveServiceRequestDto,
  CompleteServiceRequestDto,
  DeclineServiceRequestDto,
  InformationRequestDto,
  InsurerUpdateDto,
  ReplyDto,
  SubmitServiceRequestDto,
  WithdrawDto,
} from './dto/service-request.dto.js';
import {
  toCustomerServiceRequest,
  toStaffServiceRequest,
  toSummary,
  type CustomerServiceRequest,
  type ServiceRequestSummary,
  type StaffServiceRequest,
  type UpdateWithDocuments,
} from './dto/service-request.response.js';
import {
  ServiceRequestsRepository,
  type NewServiceRequest,
  type ServiceRequestRow,
  type ServiceRequestWithParties,
} from './service-requests.repository.js';

type InsurerStaff = Extract<Principal, { kind: 'staff' }> & { insurerId: string };

const ENTITY = 'SERVICE_REQUEST';
const POLICY_PROBLEMS = {
  POLICY_NOT_SERVICEABLE: 'This policy has ended or was never issued, so the insurer cannot act on it. Contact support if you need help.',
  POLICY_NOT_ACTIVE: 'Only cover that is in force can be cancelled. While the insurer is still issuing it, ask for help instead.',
} as const;
const DATE_PROBLEMS = {
  DATE_IN_PAST: 'Choose today or a later day for the cover to end.',
  DATE_AFTER_COVER: 'Choose a day on or before the day your cover ends anyway.',
} as const;

const closed = (status: ServiceRequestStatus) =>
  ApiException.conflict('SERVICE_REQUEST_CLOSED', 'This request is closed, so nothing more can be done on it.', { status });
const wrongStep = (status: ServiceRequestStatus) =>
  ApiException.conflict('SERVICE_REQUEST_WRONG_STEP', 'This request is not at the step for that. Reload it to see where it stands.', { status });

/**
 * Service requests (US-CUS-021, rule 3 of the batch 15 plan): a customer asks
 * the insurer about a policy, the insurer reviews, asks, decides and completes.
 * The request never changes the policy by itself; a completed cancellation is
 * the only thing that does, and its refund still needs two administrators.
 */
@Injectable()
export class ServiceRequestsService {
  constructor(
    private readonly requests: ServiceRequestsRepository,
    private readonly documents: DocumentsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly jobs: JobsRepository,
    private readonly refunds: RefundsRepository,
  ) {}

  // ── The customer ───────────────────────────────────────────────

  async submit(customer: CustomerPrincipal, dto: SubmitServiceRequestDto): Promise<CustomerServiceRequest> {
    const now = new Date();
    const documentIds = dto.documentIds ?? [];
    const reference = await this.requests.transaction(async (tx) => {
      const policy = await this.requests.lockOwnedPolicy(tx, customer.id, dto.policyNumber.trim());
      if (!policy) throw ApiException.notFound('Policy', dto.policyNumber);
      const problem = policyProblem(dto.type, policy.status);
      if (problem) throw ApiException.conflict(problem, POLICY_PROBLEMS[problem]);

      let requestedEffectiveDate: string | null = null;
      if (dto.type === 'CANCELLATION') {
        requestedEffectiveDate = dto.requestedEffectiveDate!;
        const dateProblem = cancellationDateProblem(
          requestedEffectiveDate,
          lusakaDay(now),
          policy.policyEndDate ? lusakaDay(policy.policyEndDate) : null,
        );
        if (dateProblem) throw new ApiException('VALIDATION_FAILED', DATE_PROBLEMS[dateProblem], 400, { field: 'requestedEffectiveDate' });
        if (await this.requests.openCancellation(tx, policy.policyNumber)) {
          throw ApiException.conflict('CANCELLATION_ALREADY_OPEN', 'You have already asked to cancel this policy. Follow that request instead.');
        }
      }
      await this.documents.assertAttachable(tx, customer, documentIds, 'SERVICE_REQUEST_DOCUMENT');

      const created = await this.requests.insert(tx, {
        reference: newReference('SR', now, randomInt),
        policyNumber: policy.policyNumber,
        customerId: customer.id,
        insurerId: policy.insurerId,
        type: dto.type,
        status: 'SUBMITTED',
        reason: dto.reason.trim(),
        requestedEffectiveDate,
      });
      await this.requests.addUpdate(tx, {
        reference: created.reference,
        authorKind: 'CUSTOMER',
        authorId: customer.id,
        message: created.reason,
        visibleToCustomer: true,
        statusFrom: null,
        statusTo: 'SUBMITTED',
        documentIds,
      });
      const actor = auditActor(customer);
      await this.audit.write(tx, {
        actor,
        action: 'service_request.submitted',
        entityType: ENTITY,
        entityId: created.reference,
        after: { type: created.type, policyNumber: created.policyNumber, documentCount: documentIds.length },
        correlationId: created.policyNumber,
      });
      await this.transition(tx, actor, created.reference, null, 'SUBMITTED', `Customer asked for ${created.type}.`, created.policyNumber);
      const values = { reference: created.reference, insurer: policy.insurerName, policyNumber: created.policyNumber, message: '' };
      await this.notifications.notify(tx, { customerId: customer.id, key: 'service_request.submitted', entity: { type: ENTITY, id: created.reference }, values });
      await this.emailHandlers(tx, created, 'new', {
        subject: `New service request ${created.reference} on policy ${created.policyNumber}`,
        body:
          `A customer has asked for ${TYPE_WORDS[created.type]} on policy ${created.policyNumber} (request ${created.reference}, ` +
          `received ${customerDate(now)}). Open the InsurShield insurer portal to review it.`,
      });
      return created.reference;
    });
    return this.customerView(customer, reference);
  }

  async listMine(customer: CustomerPrincipal): Promise<ServiceRequestSummary[]> {
    return (await this.requests.listForCustomer(customer.id)).map(toSummary);
  }

  async getMine(customer: CustomerPrincipal, reference: string): Promise<CustomerServiceRequest> {
    return this.customerView(customer, reference);
  }

  async reply(customer: CustomerPrincipal, reference: string, dto: ReplyDto): Promise<CustomerServiceRequest> {
    const documentIds = dto.documentIds ?? [];
    await this.requests.transaction(async (tx) => {
      const found = await this.ownedLocked(tx, customer, reference);
      this.assertCan('REPLY', found.request.status);
      await this.documents.assertAttachable(tx, customer, documentIds, 'SERVICE_REQUEST_DOCUMENT');
      const message = dto.message.trim();
      await this.moveWithUpdate(tx, found, 'REPLY', {}, { authorKind: 'CUSTOMER', authorId: customer.id, message, visibleToCustomer: true, documentIds });
      await this.transition(tx, auditActor(customer), reference, found.request.status, 'IN_REVIEW', 'Customer answered the insurer.', found.request.policyNumber);
      await this.emailHandlers(tx, found.request, `reply-${Date.now()}`, {
        subject: `The customer answered on service request ${reference}`,
        body: `The customer has answered your question on service request ${reference} (policy ${found.request.policyNumber}). Open the InsurShield insurer portal to carry on.`,
      });
    });
    return this.customerView(customer, reference);
  }

  async withdraw(customer: CustomerPrincipal, reference: string, dto: WithdrawDto): Promise<CustomerServiceRequest> {
    await this.requests.transaction(async (tx) => {
      const found = await this.ownedLocked(tx, customer, reference);
      this.assertCan('WITHDRAW', found.request.status);
      const message = dto.reason?.trim() || 'The customer withdrew the request.';
      await this.moveWithUpdate(tx, found, 'WITHDRAW', {}, { authorKind: 'CUSTOMER', authorId: customer.id, message, visibleToCustomer: true, documentIds: [] });
      await this.transition(tx, auditActor(customer), reference, found.request.status, 'WITHDRAWN', 'Customer withdrew the request.', found.request.policyNumber);
    });
    return this.customerView(customer, reference);
  }

  // ── The insurer ────────────────────────────────────────────────

  async listForInsurer(principal: Principal, status?: ServiceRequestStatus): Promise<ServiceRequestSummary[]> {
    const staff = this.insurerStaff(principal);
    return (await this.requests.listForInsurer(staff.insurerId, status)).map((row) => ({ ...toSummary(row), customerName: row.customer.fullName }));
  }

  async getForInsurer(principal: Principal, reference: string): Promise<StaffServiceRequest> {
    const staff = this.insurerStaff(principal);
    const found = await this.requests.find(reference);
    if (!found || found.request.insurerId !== staff.insurerId) throw await this.absent(staff, reference, Boolean(found));
    return this.staffView(found);
  }

  async review(principal: Principal, reference: string): Promise<StaffServiceRequest> {
    return this.act(principal, reference, async (tx, staff, found) => {
      this.assertCan('REVIEW', found.request.status);
      await this.moveWithUpdate(tx, found, 'REVIEW', {}, this.insurerEntry(staff, `${found.insurerName} is looking at your request.`, true));
      await this.transition(tx, auditActor(staff), reference, found.request.status, 'IN_REVIEW', 'Taken into review.', found.request.policyNumber);
      await this.tell(tx, found, 'service_request.update', `${found.insurerName} is looking at your request.`);
    });
  }

  async requestInformation(principal: Principal, reference: string, dto: InformationRequestDto): Promise<StaffServiceRequest> {
    return this.act(principal, reference, async (tx, staff, found) => {
      this.assertCan('REQUEST_INFORMATION', found.request.status);
      const message = dto.message.trim();
      await this.moveWithUpdate(tx, found, 'REQUEST_INFORMATION', {}, this.insurerEntry(staff, message, true));
      await this.transition(tx, auditActor(staff), reference, found.request.status, 'INFORMATION_REQUIRED', 'Asked the customer for information.', found.request.policyNumber);
      await this.tell(tx, found, 'service_request.information_required', message);
    });
  }

  /** A message on the request, for the customer or kept internal. It moves nothing. */
  async postUpdate(principal: Principal, reference: string, dto: InsurerUpdateDto): Promise<StaffServiceRequest> {
    return this.act(principal, reference, async (tx, staff, found) => {
      this.assertCan('UPDATE', found.request.status);
      const documentIds = dto.documentIds ?? [];
      await this.documents.assertAttachable(tx, staff, documentIds, 'SERVICE_REQUEST_DOCUMENT');
      const message = dto.message.trim();
      await this.requests.addUpdate(tx, { reference, ...this.insurerEntry(staff, message, dto.visibleToCustomer), documentIds, statusFrom: null, statusTo: null });
      await this.requests.touch(tx, reference);
      if (dto.visibleToCustomer) await this.tell(tx, found, 'service_request.update', message);
    });
  }

  async decline(principal: Principal, reference: string, dto: DeclineServiceRequestDto): Promise<StaffServiceRequest> {
    return this.act(principal, reference, async (tx, staff, found) => {
      this.assertCan('DECLINE', found.request.status);
      const reason = dto.reason.trim();
      const at = new Date();
      await this.moveWithUpdate(
        tx,
        found,
        'DECLINE',
        { decision: 'DECLINED', decisionNote: reason, decidedByStaffId: staff.id, decidedAt: at },
        this.insurerEntry(staff, reason, true),
      );
      await this.transition(tx, auditActor(staff), reference, found.request.status, 'DECLINED', 'Insurer declined the request.', found.request.policyNumber);
      await this.tell(tx, found, 'service_request.declined', reason);
    });
  }

  async approve(principal: Principal, reference: string, dto: ApproveServiceRequestDto): Promise<StaffServiceRequest> {
    return this.act(principal, reference, async (tx, staff, found) => {
      this.assertCan('APPROVE', found.request.status);
      const terms = await this.cancellationTerms(tx, found, dto);
      const note = dto.note.trim();
      await this.moveWithUpdate(
        tx,
        found,
        'APPROVE',
        { decision: 'APPROVED', decisionNote: note, decidedByStaffId: staff.id, decidedAt: new Date(), ...terms },
        this.insurerEntry(staff, note, true),
      );
      await this.transition(tx, auditActor(staff), reference, found.request.status, 'APPROVED', 'Insurer approved the request.', found.request.policyNumber);
      await this.tell(tx, found, 'service_request.approved', terms ? `${note} ${cancellationWords(terms)}` : note);
    });
  }

  /**
   * Records what the insurer did. A correction, replacement or help is
   * approved and completed in one step when it was not approved first; a
   * cancellation must be approved first, with its refund and date, and is
   * completed on or after that date, when the policy is cancelled.
   */
  async complete(principal: Principal, reference: string, dto: CompleteServiceRequestDto): Promise<StaffServiceRequest> {
    return this.act(principal, reference, async (tx, staff, found) => {
      const { request } = found;
      const oneStep = request.type !== 'CANCELLATION' && canMove('APPROVE', request.status);
      if (!oneStep) {
        if (request.type === 'CANCELLATION' && canMove('APPROVE', request.status)) {
          throw ApiException.conflict('APPROVE_FIRST', 'Approve the cancellation with its refund and end date before you complete it.');
        }
        this.assertCan('COMPLETE', request.status);
      }
      const documentIds = dto.documentIds ?? [];
      await this.documents.assertAttachable(tx, staff, documentIds, 'SERVICE_REQUEST_DOCUMENT');
      const note = dto.note.trim();
      const at = new Date();
      const actor = auditActor(staff);

      let reconciliationItemId: string | null = null;
      if (request.type === 'CANCELLATION') reconciliationItemId = await this.cancelPolicy(tx, actor, found, at);

      const decided = oneStep ? { decision: 'APPROVED' as const, decisionNote: note, decidedByStaffId: staff.id, decidedAt: at } : {};
      const moved = await this.requests.move(tx, reference, oneStep ? movesFrom('APPROVE') : movesFrom('COMPLETE'), {
        status: 'COMPLETED',
        ...decided,
        completedAt: at,
        completedByStaffId: staff.id,
        reconciliationItemId,
        updatedAt: at,
      });
      if (!moved) throw wrongStep(request.status);
      await this.requests.addUpdate(tx, {
        reference,
        ...this.insurerEntry(staff, note, true),
        statusFrom: request.status,
        statusTo: 'COMPLETED',
        documentIds,
      });
      if (oneStep) await this.transition(tx, actor, reference, request.status, 'APPROVED', 'Insurer approved the request.', request.policyNumber);
      await this.transition(tx, actor, reference, oneStep ? 'APPROVED' : request.status, 'COMPLETED', 'Insurer completed the request.', request.policyNumber);
      await this.tell(tx, found, 'service_request.completed', note);
    });
  }

  // ── InsurShield ───────────────────────────────────────────────

  async listAll(query: AdminServiceRequestQuery) {
    return (await this.requests.listAll(query)).map((row) => ({ ...toSummary(row), customerName: row.customer.fullName }));
  }

  async getAny(reference: string): Promise<StaffServiceRequest> {
    const found = await this.requests.find(reference);
    if (!found) throw ApiException.notFound('Service request', reference);
    return this.staffView(found);
  }

  // ── Shared ─────────────────────────────────────────────────────

  private async customerView(customer: CustomerPrincipal, reference: string): Promise<CustomerServiceRequest> {
    const found = await this.requests.find(reference);
    if (!found || found.request.customerId !== customer.id) throw ApiException.notFound('Service request', reference);
    return toCustomerServiceRequest(found, await this.updatesWithDocuments(reference, { customerOnly: true }));
  }

  private async staffView(found: ServiceRequestWithParties): Promise<StaffServiceRequest> {
    return toStaffServiceRequest(found, await this.updatesWithDocuments(found.request.reference, { customerOnly: false }));
  }

  /** Signs links only for entries the reader will see, so an internal attachment is never linked for the customer. */
  private async updatesWithDocuments(reference: string, { customerOnly }: { customerOnly: boolean }): Promise<UpdateWithDocuments[]> {
    const rows = (await this.requests.updatesOf([reference])).filter(({ update }) => !customerOnly || update.visibleToCustomer);
    const entries: UpdateWithDocuments[] = [];
    for (const row of rows) {
      const documents: DocumentRecord[] = [];
      for (const id of row.update.documentIds) documents.push(await this.documents.record(id));
      entries.push({ ...row, documents });
    }
    return entries;
  }

  private async ownedLocked(tx: Transaction, customer: CustomerPrincipal, reference: string) {
    const found = await this.requests.lock(tx, reference);
    if (!found || found.request.customerId !== customer.id) throw ApiException.notFound('Service request', reference);
    return found;
  }

  private insurerStaff(principal: Principal): InsurerStaff {
    if (principal.kind !== 'staff' || !isInsurerRole(principal.role) || !principal.insurerId) {
      throw ApiException.forbidden('This account is not linked to an insurer.');
    }
    return { ...principal, insurerId: principal.insurerId };
  }

  /** Another insurer's request answers as absent, and reaching for it is audited (rule 4). */
  private async absent(staff: InsurerStaff, reference: string, exists: boolean): Promise<ApiException> {
    if (exists) {
      await this.audit.refusal({
        actor: auditActor(staff),
        action: 'access.refused',
        entityType: ENTITY,
        entityId: reference,
        note: "Reached for another insurer's service request.",
        correlationId: staff.insurerId,
      });
    }
    return ApiException.notFound('Service request', reference);
  }

  /** Locks the insurer's own request, runs one action on it, and answers with the insurer's view. */
  private async act(
    principal: Principal,
    reference: string,
    work: (tx: Transaction, staff: InsurerStaff, found: ServiceRequestWithParties) => Promise<void>,
  ): Promise<StaffServiceRequest> {
    const staff = this.insurerStaff(principal);
    const reached = { allowed: true, exists: true };
    await this.requests.transaction(async (tx) => {
      const found = await this.requests.lock(tx, reference);
      if (!found || found.request.insurerId !== staff.insurerId) {
        Object.assign(reached, { allowed: false, exists: Boolean(found) });
        return;
      }
      await work(tx, staff, found);
    });
    // Audited outside the transaction that found nothing, so the refusal row is kept.
    if (!reached.allowed) throw await this.absent(staff, reference, reached.exists);
    return this.getForInsurer(staff, reference);
  }

  private assertCan(action: ServiceRequestAction, status: ServiceRequestStatus): void {
    if (canMove(action, status)) return;
    throw canMove('UPDATE', status) ? wrongStep(status) : closed(status);
  }

  private insurerEntry(staff: InsurerStaff, message: string, visibleToCustomer: boolean) {
    return { authorKind: 'INSURER' as const, authorId: staff.id, message, visibleToCustomer };
  }

  private async moveWithUpdate(
    tx: Transaction,
    found: ServiceRequestWithParties,
    action: ServiceRequestAction,
    patch: Partial<NewServiceRequest>,
    entry: { authorKind: 'CUSTOMER' | 'INSURER'; authorId: string; message: string; visibleToCustomer: boolean; documentIds?: string[] },
  ): Promise<ServiceRequestRow> {
    const from = found.request.status;
    const to = statusAfter(action, from);
    const moved = await this.requests.move(tx, found.request.reference, movesFrom(action), { ...patch, status: to, updatedAt: new Date() });
    if (!moved) throw wrongStep(from);
    await this.requests.addUpdate(tx, {
      reference: found.request.reference,
      ...entry,
      documentIds: entry.documentIds ?? [],
      statusFrom: from,
      statusTo: to,
    });
    return moved;
  }

  private transition(tx: Transaction, actor: AuditActor, reference: string, from: string | null, to: string, note: string, policyNumber: string) {
    return this.audit.transition(tx, { actor, entityType: ENTITY, entityId: reference, fromStatus: from, toStatus: to, note, correlationId: policyNumber });
  }

  private tell(tx: Transaction, found: ServiceRequestWithParties, key: string, message: string) {
    return this.notifications.notify(tx, {
      customerId: found.request.customerId,
      key,
      entity: { type: ENTITY, id: found.request.reference },
      values: { reference: found.request.reference, insurer: found.insurerName, policyNumber: found.request.policyNumber, message },
    });
  }

  private async emailHandlers(tx: Transaction, request: ServiceRequestRow, event: string, mail: { subject: string; body: string }) {
    for (const handler of await this.requests.handlersOf(tx, request.insurerId)) {
      await this.jobs.enqueue(tx, {
        kind: QUOTE_STAFF_EMAIL,
        key: `service-request:${request.reference}:${event}:${handler.id}`,
        payload: { to: handler.email, ...mail },
      });
    }
  }

  /**
   * The refund and end date an approved cancellation carries. Both are the
   * insurer's to work out; InsurShield checks only that the refund fits in what
   * is left of the payment and that the date falls within the cover.
   */
  private async cancellationTerms(tx: Transaction, found: ServiceRequestWithParties, dto: ApproveServiceRequestDto) {
    const { request } = found;
    if (request.type !== 'CANCELLATION') {
      if (dto.refundAmount !== undefined || dto.effectiveDate !== undefined) {
        throw new ApiException('VALIDATION_FAILED', 'A refund and an end date apply only to a cancellation.', 400);
      }
      return null;
    }
    if (dto.refundAmount === undefined || dto.effectiveDate === undefined) {
      throw new ApiException('VALIDATION_FAILED', 'State the refund, zero if none is due, and the day the cover ends.', 400);
    }
    const cover = await this.requests.coverOf(tx, request.policyNumber);
    if (cover.startDate && dto.effectiveDate < lusakaDay(cover.startDate)) {
      throw new ApiException('VALIDATION_FAILED', 'The cover cannot end before it started.', 400, { field: 'effectiveDate' });
    }
    if (cover.endDate && dto.effectiveDate > lusakaDay(cover.endDate)) {
      throw new ApiException('VALIDATION_FAILED', 'Choose a day on or before the day the cover ends anyway.', 400, { field: 'effectiveDate' });
    }
    const amountMinor = kwachaToNgwee(dto.refundAmount);
    const payment = await this.requests.paymentOf(tx, request.policyNumber);
    const refunded = await this.refunds.refundedMinor(tx, payment.id);
    if (refundTooLarge(amountMinor, payment.amountMinor, refunded)) {
      throw ApiException.conflict('REFUND_TOO_LARGE', `At most ${zmw(Math.max(0, payment.amountMinor - refunded))} is left to refund on this policy.`);
    }
    return { refundAmountMinor: amountMinor, effectiveDate: dto.effectiveDate };
  }

  /** Ends the cover and, when money is due back, opens the item a refund is made from. */
  private async cancelPolicy(tx: Transaction, actor: AuditActor, found: ServiceRequestWithParties, at: Date): Promise<string | null> {
    const { request } = found;
    if (request.effectiveDate && lusakaDay(at) < request.effectiveDate) {
      throw ApiException.conflict('CANCELLATION_NOT_DUE', `The cover ends on ${request.effectiveDate}. Complete the cancellation on or after that day.`);
    }
    const cancelled = await this.requests.cancelPolicy(tx, request.policyNumber, at);
    if (!cancelled) throw ApiException.conflict('POLICY_NOT_ACTIVE', 'The policy is no longer in force, so it cannot be cancelled.');
    await this.audit.transition(tx, {
      actor,
      entityType: 'POLICY',
      entityId: request.policyNumber,
      fromStatus: 'ACTIVE',
      toStatus: 'CANCELLED',
      note: `Cancelled on service request ${request.reference}.`,
      correlationId: request.reference,
    });
    const amountMinor = request.refundAmountMinor ?? 0;
    if (amountMinor === 0) return null;
    const payment = await this.requests.paymentOf(tx, request.policyNumber);
    const item = await this.requests.openRefundItem(tx, {
      kind: 'REFUND_REQUIRED',
      paymentId: payment.id,
      policyNumber: request.policyNumber,
      insurerId: request.insurerId,
      amountMinor,
      reason: `${found.insurerName} cancelled policy ${request.policyNumber} on request ${request.reference} and refunds ${zmw(amountMinor)}.`,
    });
    if (!item) {
      throw ApiException.conflict('REFUND_ITEM_OPEN', 'A refund on this payment is already open with InsurShield. Ask InsurShield to close it first.');
    }
    await this.audit.transition(tx, {
      actor,
      entityType: 'RECONCILIATION_ITEM',
      entityId: item.id,
      fromStatus: null,
      toStatus: 'OPEN',
      note: `REFUND_REQUIRED: cancellation ${request.reference}.`,
      correlationId: request.policyNumber,
    });
    return item.id;
  }
}

const TYPE_WORDS = {
  DETAILS_CHANGE: 'a change to the policy details',
  DOCUMENT_REPLACEMENT: 'a replacement document',
  CANCELLATION: 'a cancellation',
  ASSISTANCE: 'help',
} as const;

function cancellationWords(terms: { refundAmountMinor: number; effectiveDate: string }): string {
  const refund = terms.refundAmountMinor > 0 ? `${zmw(terms.refundAmountMinor)} will be refunded` : 'No refund is due';
  return `The cover ends on ${terms.effectiveDate}. ${refund}.`;
}

/** An amount as the customer and the insurer read it: ZMW 2,500.00. */
function zmw(amountMinor: number): string {
  return `ZMW ${ngweeToKwacha(amountMinor).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
