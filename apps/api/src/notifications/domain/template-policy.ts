/** Event contracts from the existing delivery callers and seeded templates. Changes require a delivery-flow review. */
export interface TemplatePolicy {
  category: string;
  mandatory: boolean;
  placeholders: readonly string[];
}
export const TEMPLATE_POLICIES: Readonly<Record<string, TemplatePolicy>> = {
  'quote.ready:IN_APP': {
    category: 'QUOTE',
    mandatory: true,
    placeholders: ['insurer'],
  },
  'quote.ready:EMAIL': {
    category: 'QUOTE',
    mandatory: true,
    placeholders: ['insurer'],
  },
  'payment.confirmed:IN_APP': {
    category: 'PAYMENT',
    mandatory: true,
    placeholders: ['insurer'],
  },
  'payment.confirmed:EMAIL': {
    category: 'PAYMENT',
    mandatory: true,
    placeholders: ['insurer'],
  },
  'policy.created:IN_APP': {
    category: 'POLICY',
    mandatory: true,
    placeholders: ['insurer', 'policyNumber'],
  },
  'policy.certificate_issued:IN_APP': {
    category: 'POLICY',
    mandatory: true,
    placeholders: ['insurer', 'policyNumber'],
  },
  'policy.certificate_issued:EMAIL': {
    category: 'POLICY',
    mandatory: true,
    placeholders: ['insurer', 'policyNumber'],
  },
  'claim.received:IN_APP': {
    category: 'CLAIM',
    mandatory: true,
    placeholders: ['claimNumber', 'insurer'],
  },
  'claim.received:EMAIL': {
    category: 'CLAIM',
    mandatory: true,
    placeholders: ['claimNumber', 'insurer'],
  },
  'claim.acknowledged:IN_APP': {
    category: 'CLAIM',
    mandatory: true,
    placeholders: ['claimNumber', 'insurer'],
  },
  'claim.acknowledged:EMAIL': {
    category: 'CLAIM',
    mandatory: true,
    placeholders: ['claimNumber', 'insurer'],
  },
  'ncd.decided:IN_APP': {
    category: 'NCD',
    mandatory: true,
    placeholders: ['insurer'],
  },
  'ncd.decided:EMAIL': {
    category: 'NCD',
    mandatory: true,
    placeholders: ['insurer'],
  },
  'quote.cancelled:IN_APP': {
    category: 'QUOTE',
    mandatory: true,
    placeholders: ['insurer', 'quoteRequestId'],
  },
  'quote.cancelled:EMAIL': {
    category: 'QUOTE',
    mandatory: true,
    placeholders: ['insurer', 'quoteRequestId'],
  },
  'quote.version_declined:IN_APP': {
    category: 'QUOTE',
    mandatory: true,
    placeholders: ['insurer', 'product', 'quoteRequestId', 'reason'],
  },
  'quote.version_declined:EMAIL': {
    category: 'QUOTE',
    mandatory: true,
    placeholders: ['insurer', 'product', 'quoteRequestId', 'reason'],
  },
  'quote.information_requested:IN_APP': {
    category: 'QUOTE',
    mandatory: true,
    placeholders: ['dueDate', 'insurer', 'product', 'quoteRequestId'],
  },
  'quote.information_requested:EMAIL': {
    category: 'QUOTE',
    mandatory: true,
    placeholders: ['dueDate', 'insurer', 'product', 'quoteRequestId'],
  },
  'quote.version_timed_out:IN_APP': {
    category: 'QUOTE',
    mandatory: true,
    placeholders: ['insurer', 'product', 'quoteRequestId'],
  },
  'quote.version_timed_out:EMAIL': {
    category: 'QUOTE',
    mandatory: true,
    placeholders: ['insurer', 'product', 'quoteRequestId'],
  },
  'quote.expired:IN_APP': {
    category: 'QUOTE',
    mandatory: true,
    placeholders: ['insurer', 'product', 'quoteRequestId'],
  },
  'quote.expired:EMAIL': {
    category: 'QUOTE',
    mandatory: true,
    placeholders: ['insurer', 'product', 'quoteRequestId'],
  },
  'quote.withdrawn:IN_APP': {
    category: 'QUOTE',
    mandatory: true,
    placeholders: ['insurer', 'product', 'quoteRequestId'],
  },
  'quote.withdrawn:EMAIL': {
    category: 'QUOTE',
    mandatory: true,
    placeholders: ['insurer', 'product', 'quoteRequestId'],
  },
  'quote.replaced:IN_APP': {
    category: 'QUOTE',
    mandatory: true,
    placeholders: ['insurer', 'product', 'quoteRequestId'],
  },
  'quote.replaced:EMAIL': {
    category: 'QUOTE',
    mandatory: true,
    placeholders: ['insurer', 'product', 'quoteRequestId'],
  },
  'inspection.scheduled:IN_APP': {
    category: 'INSPECTION',
    mandatory: true,
    placeholders: ['date', 'vehicle'],
  },
  'inspection.scheduled:EMAIL': {
    category: 'INSPECTION',
    mandatory: true,
    placeholders: ['date', 'vehicle'],
  },
  'inspection.approved:IN_APP': {
    category: 'INSPECTION',
    mandatory: true,
    placeholders: ['vehicle'],
  },
  'inspection.approved:EMAIL': {
    category: 'INSPECTION',
    mandatory: true,
    placeholders: ['vehicle'],
  },
  'inspection.failed:IN_APP': {
    category: 'INSPECTION',
    mandatory: true,
    placeholders: ['vehicle'],
  },
  'inspection.failed:EMAIL': {
    category: 'INSPECTION',
    mandatory: true,
    placeholders: ['vehicle'],
  },
  'inspection.rebooked:IN_APP': {
    category: 'INSPECTION',
    mandatory: true,
    placeholders: ['vehicle'],
  },
  'inspection.rebooked:EMAIL': {
    category: 'INSPECTION',
    mandatory: true,
    placeholders: ['vehicle'],
  },
  'payment.failed:IN_APP': {
    category: 'PAYMENT',
    mandatory: true,
    placeholders: ['insurer'],
  },
  'payment.failed:EMAIL': {
    category: 'PAYMENT',
    mandatory: true,
    placeholders: ['insurer'],
  },
  'payment.expired:IN_APP': {
    category: 'PAYMENT',
    mandatory: true,
    placeholders: ['insurer'],
  },
  'payment.held:IN_APP': {
    category: 'PAYMENT',
    mandatory: true,
    placeholders: ['insurer'],
  },
  'payment.held:EMAIL': {
    category: 'PAYMENT',
    mandatory: true,
    placeholders: ['insurer'],
  },
  'policy.issuance_accepted:IN_APP': {
    category: 'POLICY',
    mandatory: true,
    placeholders: ['insurer', 'policyNumber'],
  },
  'policy.issuance_delayed:IN_APP': {
    category: 'POLICY',
    mandatory: true,
    placeholders: ['insurer', 'policyNumber'],
  },
  'policy.issuance_delayed:EMAIL': {
    category: 'POLICY',
    mandatory: true,
    placeholders: ['insurer', 'policyNumber'],
  },
  'policy.issuance_failed:IN_APP': {
    category: 'POLICY',
    mandatory: true,
    placeholders: ['insurer', 'policyNumber', 'reason'],
  },
  'policy.issuance_failed:EMAIL': {
    category: 'POLICY',
    mandatory: true,
    placeholders: ['insurer', 'policyNumber', 'reason'],
  },
  'payment.refunded:IN_APP': {
    category: 'PAYMENT',
    mandatory: true,
    placeholders: ['amount', 'transactionId'],
  },
  'payment.refunded:EMAIL': {
    category: 'PAYMENT',
    mandatory: true,
    placeholders: ['amount', 'transactionId'],
  },
  'policy.renewal_due:IN_APP': {
    category: 'POLICY',
    mandatory: false,
    placeholders: ['daysRemaining', 'endDate', 'insurer', 'policyNumber'],
  },
  'policy.renewal_due:EMAIL': {
    category: 'POLICY',
    mandatory: false,
    placeholders: ['daysRemaining', 'endDate', 'insurer', 'policyNumber'],
  },
  'policy.lapsed:IN_APP': {
    category: 'POLICY',
    mandatory: false,
    placeholders: ['endDate', 'insurer', 'policyNumber'],
  },
  'policy.lapsed:EMAIL': {
    category: 'POLICY',
    mandatory: false,
    placeholders: ['endDate', 'insurer', 'policyNumber'],
  },
  'service_request.submitted:IN_APP': {
    category: 'POLICY',
    mandatory: true,
    placeholders: ['insurer', 'policyNumber', 'reference'],
  },
  'service_request.submitted:EMAIL': {
    category: 'POLICY',
    mandatory: true,
    placeholders: ['insurer', 'policyNumber', 'reference'],
  },
  'service_request.information_required:IN_APP': {
    category: 'POLICY',
    mandatory: true,
    placeholders: ['insurer', 'message', 'reference'],
  },
  'service_request.information_required:EMAIL': {
    category: 'POLICY',
    mandatory: true,
    placeholders: ['insurer', 'message', 'policyNumber', 'reference'],
  },
  'service_request.update:IN_APP': {
    category: 'POLICY',
    mandatory: true,
    placeholders: ['insurer', 'message', 'reference'],
  },
  'service_request.update:EMAIL': {
    category: 'POLICY',
    mandatory: true,
    placeholders: ['insurer', 'message', 'policyNumber', 'reference'],
  },
  'service_request.approved:IN_APP': {
    category: 'POLICY',
    mandatory: true,
    placeholders: ['insurer', 'message', 'reference'],
  },
  'service_request.approved:EMAIL': {
    category: 'POLICY',
    mandatory: true,
    placeholders: ['insurer', 'message', 'policyNumber', 'reference'],
  },
  'service_request.declined:IN_APP': {
    category: 'POLICY',
    mandatory: true,
    placeholders: ['insurer', 'message', 'reference'],
  },
  'service_request.declined:EMAIL': {
    category: 'POLICY',
    mandatory: true,
    placeholders: ['insurer', 'message', 'policyNumber', 'reference'],
  },
  'service_request.completed:IN_APP': {
    category: 'POLICY',
    mandatory: true,
    placeholders: ['insurer', 'message', 'reference'],
  },
  'service_request.completed:EMAIL': {
    category: 'POLICY',
    mandatory: true,
    placeholders: ['insurer', 'message', 'policyNumber', 'reference'],
  },
  'claim.review_started:IN_APP': {
    category: 'CLAIM',
    mandatory: true,
    placeholders: ['claimNumber'],
  },
  'claim.review_started:EMAIL': {
    category: 'CLAIM',
    mandatory: true,
    placeholders: ['claimNumber'],
  },
  'claim.evidence_requested:IN_APP': {
    category: 'CLAIM',
    mandatory: true,
    placeholders: ['claimNumber'],
  },
  'claim.evidence_requested:EMAIL': {
    category: 'CLAIM',
    mandatory: true,
    placeholders: ['claimNumber'],
  },
  'claim.evidence_submitted:IN_APP': {
    category: 'CLAIM',
    mandatory: true,
    placeholders: ['claimNumber'],
  },
  'claim.evidence_submitted:EMAIL': {
    category: 'CLAIM',
    mandatory: true,
    placeholders: ['claimNumber'],
  },
  'claim.approved:IN_APP': {
    category: 'CLAIM',
    mandatory: true,
    placeholders: ['claimNumber'],
  },
  'claim.approved:EMAIL': {
    category: 'CLAIM',
    mandatory: true,
    placeholders: ['claimNumber'],
  },
  'claim.declined:IN_APP': {
    category: 'CLAIM',
    mandatory: true,
    placeholders: ['claimNumber'],
  },
  'claim.declined:EMAIL': {
    category: 'CLAIM',
    mandatory: true,
    placeholders: ['claimNumber'],
  },
  'claim.closed:IN_APP': {
    category: 'CLAIM',
    mandatory: true,
    placeholders: ['claimNumber'],
  },
  'claim.closed:EMAIL': {
    category: 'CLAIM',
    mandatory: true,
    placeholders: ['claimNumber'],
  },
  'ncd.submitted:IN_APP': {
    category: 'NCD',
    mandatory: true,
    placeholders: ['insurer'],
  },
  'ncd.submitted:EMAIL': {
    category: 'NCD',
    mandatory: true,
    placeholders: ['insurer'],
  },
  'ncd.review_started:IN_APP': {
    category: 'NCD',
    mandatory: true,
    placeholders: ['insurer'],
  },
  'ncd.review_started:EMAIL': {
    category: 'NCD',
    mandatory: true,
    placeholders: ['insurer'],
  },
  'ncd.verification_requested:IN_APP': {
    category: 'NCD',
    mandatory: true,
    placeholders: ['insurer'],
  },
  'ncd.verification_requested:EMAIL': {
    category: 'NCD',
    mandatory: true,
    placeholders: ['insurer'],
  },
  'ncd.evidence_submitted:IN_APP': {
    category: 'NCD',
    mandatory: true,
    placeholders: ['insurer'],
  },
  'ncd.evidence_submitted:EMAIL': {
    category: 'NCD',
    mandatory: true,
    placeholders: ['insurer'],
  },
  'inspection.required:IN_APP': {
    category: 'INSPECTION',
    mandatory: true,
    placeholders: ['purpose', 'reference'],
  },
  'inspection.required:EMAIL': {
    category: 'INSPECTION',
    mandatory: true,
    placeholders: ['purpose', 'reference'],
  },
  'inspection.report_ready:IN_APP': {
    category: 'INSPECTION',
    mandatory: true,
    placeholders: ['reference'],
  },
  'inspection.report_ready:EMAIL': {
    category: 'INSPECTION',
    mandatory: true,
    placeholders: ['reference'],
  },
  'REVIEW_MODERATED:IN_APP': {
    category: 'ACCOUNT',
    mandatory: true,
    placeholders: [],
  },
  'REVIEW_MODERATED:EMAIL': {
    category: 'ACCOUNT',
    mandatory: true,
    placeholders: [],
  },
  'REVIEW_APPEAL_DECIDED:IN_APP': {
    category: 'ACCOUNT',
    mandatory: true,
    placeholders: [],
  },
  'REVIEW_APPEAL_DECIDED:EMAIL': {
    category: 'ACCOUNT',
    mandatory: true,
    placeholders: [],
  },
};
