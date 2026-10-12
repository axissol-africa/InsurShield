/** Data helpers and constants shared by the insurer portal modules. */
import { formatDate, formatZMW } from '@/domain/premiumEngine';
import { addDays, quoteValidity } from '@/domain/quoteValidity';
import { coverPeriodLabel } from '@/domain/coverPeriod';
import { COVERAGE_DURATION_OPTIONS } from '@/domain/insurers';
import { timeAgo } from '@/lib/time';

export const AWAITING_CERTIFICATE = 'Awaiting insurer certificate';

const OPEN_NCD_STATUSES = ['Submitted', 'Under Review'];
export const isOpenNcdApplication = (application) => OPEN_NCD_STATUSES.includes(application.status);

/**
 * What a status asks of the insurer: `open` work is waiting on them, `settled`
 * work is dealt with, and `declined` is a closed outcome that was a refusal.
 * An unrecognised status is settled, so it can never read as open work.
 */
const STATUS_TONES = {
  Notified: 'open',
  Submitted: 'open',
  'Under Review': 'open',
  [AWAITING_CERTIFICATE]: 'open',
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
 * When the customer's request stops taking quotes, worded for the insurer who
 * still has to reply. `urgent` when little or no time is left.
 */
export const replyDeadline = (request, now = new Date()) => {
  const { validUntil, daysLeft, expired, expiringSoon } = quoteValidity({ validUntil: request.expiresAt }, now);
  if (!validUntil) return null;
  return {
    label: expired ? `Closed for quotes on ${formatDate(validUntil)}` : `Reply by ${formatDate(validUntil)} · ${days(daysLeft)} left`,
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

/** Sort comparator for a work queue: whoever has waited longest is served first. */
export const waitingLongestFirst = (since) => (first, second) => new Date(since(first) || 0) - new Date(since(second) || 0);

/** Addresses of the portal's screens. The section is a query parameter so the staff route stays one path. */
const PORTAL_ROOT = '/insurer';
export const portalPath = {
  section: (id) => (id === 'overview' ? PORTAL_ROOT : `${PORTAL_ROOT}?view=${id}`),
  quote: (requestId) => `${PORTAL_ROOT}?quote=${encodeURIComponent(requestId)}`,
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

/** Shape a stored quote request for the portal: display strings plus this insurer's reply, if any. */
export const toPortalRequest = (request, insurerName) => ({
  ...request,
  vehicle: request.vehicle || 'Vehicle pending',
  value: formatZMW(request.vehicleValue || 0),
  usage: request.vehicleUsage || 'Private',
  coverage: request.insuranceType === 'ThirdParty' ? 'Third Party Only' : 'Comprehensive',
  client: request.customer?.fullName || 'Customer',
  contact: [request.customer?.phone, request.customer?.email].filter(Boolean).join(' · '),
  period: COVERAGE_DURATION_OPTIONS.find((option) => option.id === request.coverageDurationId)?.label || '—',
  dates: request.policyDates ? coverPeriodLabel(request.policyDates) : 'From payment date',
  plate: request.vehicleDetails?.plateNumber || '',
  registrationCountry: request.vehicleDetails?.registrationCountry || '',
  photos: request.inspectionShots?.length || 0,
  time: timeAgo(request.submittedAt),
  reply: request.insurerQuotes?.[insurerName] || null,
});
