/** Data helpers and constants shared by the insurer portal modules. */
import { formatZMW } from '../../utils/premiumEngine';
import { COVERAGE_DURATION_OPTIONS } from '../../utils/insurerRates';
import { timeAgo } from '../../utils/time';

export const AWAITING_CERTIFICATE = 'Awaiting insurer certificate';

const OPEN_NCD_STATUSES = ['Submitted', 'Under Review'];
export const isOpenNcdApplication = (application) => OPEN_NCD_STATUSES.includes(application.status);

const STATUS_STYLES = {
  Notified: { badge: 'bg-primary/10 text-primary', dot: 'bg-primary' },
  'Received by insurer': { badge: 'bg-primary/10 text-primary', dot: 'bg-primary/50' },
  Submitted: { badge: 'bg-primary/10 text-primary' },
  'Under Review': { badge: 'bg-primary/10 text-primary' },
  Approved: { badge: 'bg-primary/10 text-primary' },
  Rejected: { badge: 'bg-red-100 text-red-800' },
};
export const statusStyle = (status) => STATUS_STYLES[status] || { badge: 'bg-gray-100 text-gray-700', dot: 'bg-gray-400' };

export const pageSlice = (items, page, pageSize) => items.slice((page - 1) * pageSize, page * pageSize);

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
  dates: request.policyDates ? `${request.policyDates.formattedStart} – ${request.policyDates.formattedEnd}` : 'From payment date',
  plate: request.vehicleDetails?.plateNumber || '',
  photos: request.inspectionShots?.length || 0,
  time: timeAgo(request.submittedAt),
  reply: request.insurerQuotes?.[insurerName] || null,
});
