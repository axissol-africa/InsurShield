/** Data helpers and constants shared by the insurer portal modules. */
import { formatZMW } from '@/domain/premiumEngine';
import { coverPeriodLabel } from '@/domain/coverPeriod';
import { COVERAGE_DURATION_OPTIONS } from '@/domain/insurers';
import { timeAgo } from '@/lib/time';

export const AWAITING_CERTIFICATE = 'Awaiting insurer certificate';

const OPEN_NCD_STATUSES = ['Submitted', 'Under Review'];
export const isOpenNcdApplication = (application) => OPEN_NCD_STATUSES.includes(application.status);

/**
 * Status chips. Open work carries the accent; anything already dealt with is
 * neutral, so a queue reads at a glance without relying on colour alone —
 * the label is always present.
 */
const STATUS_STYLES = {
  Notified: { badge: 'border-primary/30 bg-primary/10 text-primary', dot: 'bg-primary' },
  'Received by insurer': { badge: 'border-line-strong text-ink-muted', dot: 'bg-line-strong' },
  Submitted: { badge: 'border-primary/30 bg-primary/10 text-primary', dot: 'bg-primary' },
  'Under Review': { badge: 'border-primary/30 bg-primary/10 text-primary', dot: 'bg-primary' },
  Approved: { badge: 'border-line-strong text-ink-muted', dot: 'bg-line-strong' },
  Rejected: { badge: 'border-primary bg-primary text-white', dot: 'bg-primary' },
};
export const statusStyle = (status) =>
  STATUS_STYLES[status] || { badge: 'border-line-strong text-ink-muted', dot: 'bg-line-strong' };

export const pageSlice = (items, page, pageSize) => items.slice((page - 1) * pageSize, page * pageSize);

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
  photos: request.inspectionShots?.length || 0,
  time: timeAgo(request.submittedAt),
  reply: request.insurerQuotes?.[insurerName] || null,
});
