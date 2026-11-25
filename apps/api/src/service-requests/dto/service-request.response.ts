import { ngweeToKwacha } from '../../common/money.js';
import type { DocumentRecord } from '../../documents/documents.service.js';
import type { ServiceRequestAuthor, ServiceRequestStatus, ServiceRequestType } from '../../common/domain/enums.js';
import type { ServiceRequestRow, ServiceRequestUpdateRow, ServiceRequestWithParties } from '../service-requests.repository.js';

export interface ServiceRequestDecision {
  outcome: 'APPROVED' | 'DECLINED';
  note: string | null;
  /** Kwacha the insurer will refund on a cancellation; null for any other request. */
  refundAmount: number | null;
  effectiveDate: string | null;
  decidedAt: string;
}

export interface CustomerUpdate {
  id: string;
  author: ServiceRequestAuthor;
  message: string;
  statusFrom: ServiceRequestStatus | null;
  statusTo: ServiceRequestStatus | null;
  documents: DocumentRecord[];
  createdAt: string;
}

export interface StaffUpdate extends CustomerUpdate {
  /** Who wrote it: the customer's name or the staff member's. */
  authorName: string | null;
  visibleToCustomer: boolean;
}

export interface ServiceRequestSummary {
  reference: string;
  policyNumber: string;
  insurer: string;
  type: ServiceRequestType;
  status: ServiceRequestStatus;
  reason: string;
  requestedEffectiveDate: string | null;
  decision: ServiceRequestDecision | null;
  /** What the customer is asked to do next, if anything. */
  nextAction: 'REPLY' | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerServiceRequest extends ServiceRequestSummary {
  updates: CustomerUpdate[];
}

export interface StaffServiceRequest extends ServiceRequestSummary {
  customer: { fullName: string; email: string; phone: string };
  reconciliationItemId: string | null;
  updates: StaffUpdate[];
}

export type UpdateWithDocuments = { update: ServiceRequestUpdateRow; staffName: string | null; documents: DocumentRecord[] };

function decisionOf(request: ServiceRequestRow): ServiceRequestDecision | null {
  if (!request.decision || !request.decidedAt) return null;
  return {
    outcome: request.decision,
    note: request.decisionNote,
    refundAmount: request.refundAmountMinor === null ? null : ngweeToKwacha(request.refundAmountMinor),
    effectiveDate: request.effectiveDate,
    decidedAt: request.decidedAt.toISOString(),
  };
}

export function toSummary({ request, insurerName }: ServiceRequestWithParties): ServiceRequestSummary {
  return {
    reference: request.reference,
    policyNumber: request.policyNumber,
    insurer: insurerName,
    type: request.type,
    status: request.status,
    reason: request.reason,
    requestedEffectiveDate: request.requestedEffectiveDate,
    decision: decisionOf(request),
    nextAction: request.status === 'INFORMATION_REQUIRED' ? 'REPLY' : null,
    completedAt: request.completedAt?.toISOString() ?? null,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
  };
}

const customerUpdate = ({ update, documents }: UpdateWithDocuments): CustomerUpdate => ({
  id: update.id,
  author: update.authorKind,
  message: update.message,
  statusFrom: update.statusFrom,
  statusTo: update.statusTo,
  documents,
  createdAt: update.createdAt.toISOString(),
});

/** The customer's view: only what was meant for them, and never a staff member's name. */
export function toCustomerServiceRequest(row: ServiceRequestWithParties, updates: UpdateWithDocuments[]): CustomerServiceRequest {
  return {
    ...toSummary(row),
    updates: updates.filter(({ update }) => update.visibleToCustomer).map(customerUpdate),
  };
}

/** The insurer's and InsurShield's view: every entry, with who wrote it and whether the customer saw it. */
export function toStaffServiceRequest(row: ServiceRequestWithParties, updates: UpdateWithDocuments[]): StaffServiceRequest {
  return {
    ...toSummary(row),
    customer: row.customer,
    reconciliationItemId: row.request.reconciliationItemId,
    updates: updates.map((entry) => ({
      ...customerUpdate(entry),
      authorName: entry.update.authorKind === 'CUSTOMER' ? row.customer.fullName : entry.staffName,
      visibleToCustomer: entry.update.visibleToCustomer,
    })),
  };
}
