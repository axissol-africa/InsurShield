/** Data helpers and constants shared by the insurer portal modules. */
import { formatDate, formatZMW } from '@/domain/premiumEngine';
import { addDays, quoteValidity } from '@/domain/quoteValidity';
import { coverPeriodLabel } from '@/domain/coverPeriod';
import { COVERAGE_DURATION_OPTIONS } from '@/domain/insurers';
import { timeAgo } from '@/lib/time';
import { canQuote, endedWithoutQuote } from '@/domain/quoteWorkflow';

export const AWAITING_CERTIFICATE = 'Awaiting insurer certificate';
export const CLAIM_NOTIFIED = 'Notified';
export const CLAIM_RECEIVED = 'Received by insurer';
/** How far one "extend" pushes a sent quote's validity. */
export const EXTENSION_DAYS = 7;
/** The element every portal screen renders into; the skip link and screen changes move focus to it. */
export const PORTAL_CONTENT_ID = 'insurer-content';

const OPEN_NCD_STATUSES = ['Submitted', 'Under Review', 'Verification Required'];
export const isOpenNcdApplication = (application) => OPEN_NCD_STATUSES.includes(application.status);

/**
 * What a status asks of the insurer: `open` work is waiting on them, `settled`
 * work is dealt with, and `declined` is a closed outcome that was a refusal.
 * An unrecognised status is settled, so it can never read as open work.
 */
const STATUS_TONES = {
  ...Object.fromEntries([CLAIM_NOTIFIED, AWAITING_CERTIFICATE, ...OPEN_NCD_STATUSES].map((status) => [status, 'open'])),
  Rejected: 'declined',
};
export const statusTone = (status) => STATUS_TONES[status] || 'settled';

/**
 * One policy sale as the insurer lives it. Each stage is named twice: as the
 * thing still to do and as the thing done, so a screen can say whose turn it is.
 */
export const CASE_STAGES = [
  { id: 'requested', todo: 'Request received', done: 'Request received' },
  { id: 'quoted', todo: 'Send your quote', done: 'Quote sent' },
  { id: 'paid', todo: 'Customer pays', done: 'Customer paid' },
  { id: 'issued', todo: 'Issue the certificate', done: 'Policy active' },
];

export const days = (count) => `${count} day${count === 1 ? '' : 's'}`;

/**
 * The date the customer's request expects its quotes by, worded for the
 * insurer who still has to reply. `urgent` when little or no time is left.
 * Past that date the reply is overdue, not refused: nothing stops a late
 * quote being sent, so the label does not say the request is closed.
 */
export const replyDeadline = (request, now = new Date()) => {
  // A chosen product's clock stops while the customer is being waited for.
  if (request.workflow?.clockPausedAt) {
    const waitingFor = request.workflow.status === 'INSPECTION_REQUIRED' ? 'the inspection' : 'the customer';
    return { label: `Clock stopped · waiting for ${waitingFor}`, urgent: false };
  }
  const { validUntil, daysLeft, expired, expiringSoon } = quoteValidity({ validUntil: request.workflow?.replyDueAt || request.expiresAt }, now);
  if (!validUntil || Number.isNaN(daysLeft)) return null;
  return {
    label: expired ? `Reply was due ${formatDate(validUntil)}` : `Reply by ${formatDate(validUntil)} · ${days(daysLeft)} left`,
    urgent: expired || expiringSoon,
  };
};

/** The date a quote sent now stays open until. */
export const quoteOpenUntil = (validityDays, now = new Date()) => formatDate(addDays(now.toISOString(), validityDays));

/**
 * A premium under half or over double InsurShield's estimate is far more
 * often a slipped digit than a pricing decision, and the customer is charged
 * what is typed. Returns `'low'`, `'high'`, or `null` when there is nothing to question.
 */
const PREMIUM_CHECK_FACTOR = 2;
export const premiumCheck = (premium, estimate) => {
  if (!(premium > 0) || !(estimate > 0)) return null;
  if (premium * PREMIUM_CHECK_FACTOR < estimate) return 'low';
  if (premium > estimate * PREMIUM_CHECK_FACTOR) return 'high';
  return null;
};

/** When the customer's payment was confirmed: the start of their wait for a certificate. */
export const policyPaidAt = (policy) => policy.paymentProof?.confirmedAt || policy.receivedAt;

/**
 * Sort comparator for a work queue: whoever has waited longest is served
 * first. A record with no usable date is put first too, where it will be
 * seen, rather than wherever an unsortable value happens to land.
 */
const waitStart = (value) => new Date(value || 0).getTime() || 0;
export const waitingLongestFirst = (since) => (first, second) => waitStart(since(first)) - waitStart(since(second));

/** Addresses of the portal's screens. The section is a query parameter so the staff route stays one path. */
const PORTAL_ROOT = '/insurer';
export const portalPath = {
  section: (id) => (id === 'overview' ? PORTAL_ROOT : `${PORTAL_ROOT}?view=${id}`),
  quote: (caseKey) => `${PORTAL_ROOT}?quote=${encodeURIComponent(caseKey)}`,
  replace: (caseKey) => `${PORTAL_ROOT}?replace=${encodeURIComponent(caseKey)}`,
  issue: (policyNumber) => `${PORTAL_ROOT}?view=policies&issue=${encodeURIComponent(policyNumber)}`,
};

/** Benefits that only apply when the customer has selected comprehensive cover. */
const COMPREHENSIVE_ONLY_BENEFITS = /own damage|theft|fire|natural disaster|windscreen|accessor/i;

/**
 * Snapshot the benefits that belong to the cover type being quoted. This is
 * stored with the insurer's reply so a later catalogue edit cannot alter what
 * the customer was shown before paying.
 */
export const benefitsForCoverage = (insurer, insuranceType) =>
  (insurer?.benefits || []).filter((benefit) => insuranceType !== 'ThirdParty' || !COMPREHENSIVE_ONLY_BENEFITS.test(benefit));

/** The cover type a request asks for. Anything that is not third party is quoted as comprehensive. */
export const coverTypeOf = (request) =>
  (request.insuranceType === 'ThirdParty' || (!request.insuranceType && request.coverage === 'Third Party Only') ? 'ThirdParty' : 'Comprehensive');

/**
 * Which policy a renewal request renews, as the portal says it, or null for a
 * new request. The previous insurer is named so a different insurer knows it
 * is being asked to take the cover over.
 */
export const renewalNote = (request) => {
  const previous = request.renewalOf;
  if (!previous?.policyNumber) return null;
  const ends = previous.endDate ? `, ends ${formatDate(previous.endDate)}` : '';
  return `Renewal of ${previous.policyNumber} (${previous.insurer || 'another insurer'}${ends})`;
};

/** Shape a stored quote request for the portal: display strings plus this insurer's reply, if any. */
export const toPortalRequest = (request, insurerName) => ({
  ...request,
  vehicle: request.vehicle || 'Vehicle pending',
  value: formatZMW(request.vehicleValue || 0),
  usage: request.vehicleUsage || 'Private',
  coverage: coverTypeOf(request) === 'ThirdParty' ? 'Third Party Only' : 'Comprehensive',
  client: request.customer?.fullName || 'Customer',
  period: COVERAGE_DURATION_OPTIONS.find((option) => option.id === request.coverageDurationId)?.label || '—',
  dates: request.policyDates ? coverPeriodLabel(request.policyDates) : 'From payment date',
  plate: request.vehicleDetails?.plateNumber || '',
  registrationCountry: request.vehicleDetails?.registrationCountry || '',
  photos: request.inspectionShots?.length || 0,
  time: timeAgo(request.submittedAt),
  reply: request.insurerQuotes?.[insurerName] || null,
  caseKey: request.id,
  productVersionId: null,
});

/**
 * The pieces of work one request gives this insurer. A request made before
 * product selection is one case. A request with chosen products is one case
 * per product the customer chose from this insurer, because the insurer quotes,
 * and is paid for, each product separately. A product InsurShield has cancelled
 * for this insurer is no longer work to do, but a quote already sent for it
 * stays listed.
 */
export const toPortalCases = (request, insurerName) => {
  const base = toPortalRequest(request, insurerName);
  const products = (request.selectedProducts || []).filter((product) => product.insurerName === insurerName);
  if (products.length === 0) return request.selectedProducts?.length ? [] : [base];
  return products
    .map((product) => ({
      ...base,
      caseKey: portalCaseKey(request.id, product.productVersionId),
      productVersionId: product.productVersionId,
      productName: product.productName,
      productVersionNumber: product.productVersionNumber,
      coverGuide: product.coverGuide,
      reply: product.reply
        ?? request.productQuotes?.find((quote) => quote.productVersionId === product.productVersionId)
        ?? null,
      unavailable: Boolean(product.unavailableAt),
      workflow: productWorkflow(product),
    }))
    .filter((portalCase) => portalCase.reply || !portalCase.unavailable);
};

/**
 * One shape for a product's workflow whichever source it came from: the
 * portal route nests it under `workflow`, the browser-only prototype keeps it
 * on the product as the customer route does. A product with no state at all
 * predates the workflow and is treated as new.
 */
export const productWorkflow = (product) => {
  if (product.workflow) return product.workflow;
  return {
    status: product.status || 'SUBMITTED',
    replyDueAt: product.replyDueAt || null,
    clockPausedAt: product.status === 'VERIFICATION_REQUIRED'
      ? product.informationRequests?.find((asked) => asked.open)?.askedAt ?? null
      : null,
    decline: product.decline ? { customerText: product.decline.reason, customerNote: product.decline.note } : null,
    informationRequests: product.informationRequests || [],
    owner: product.owner || null,
    priority: product.priority || 'NORMAL',
    sla: null,
  };
};

/** Which part of the queue a person is looking at: everything, their own work, or work nobody owns. */
export const QUEUE_VIEWS = [
  { id: 'all', label: 'All' },
  { id: 'mine', label: 'Mine' },
  { id: 'unassigned', label: 'Unassigned' },
];
export const inQueueView = (view, staffId) => (portalCase) => {
  if (view === 'mine') return portalCase.workflow?.owner?.id === staffId;
  // A request from before product selection has no owner, so it stays visible to everyone.
  if (view === 'unassigned') return !portalCase.workflow?.owner;
  return true;
};

/** Work still waiting on the insurer: no quote yet, and not closed. */
export const awaitsInsurer = (portalCase) =>
  !portalCase.reply && !endedWithoutQuote(portalCase.workflow?.status);

/** Whether the insurer can send a quote for this case now. */
export const quotableNow = (portalCase) => canQuote(portalCase.workflow?.status);

/** One address per piece of work: the request, and the chosen product when there is one. */
export const portalCaseKey = (requestId, productVersionId) =>
  (productVersionId ? `${requestId}~${productVersionId}` : requestId);
