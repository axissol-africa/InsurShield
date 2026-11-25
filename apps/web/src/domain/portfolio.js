/**
 * Search and filters for the customer's portfolio (FR-SELF-002, FR-SELF-007).
 * One search box looks through the words a customer remembers a record by:
 * its reference, the insurer, the vehicle and its plate.
 */
import { requestStatus } from '@/domain/quoteValidity';

const normalise = (value) => String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Whether `needle` appears in any of `haystack`; an empty search matches everything. */
export const matchesSearch = (needle, haystack) => {
  const wanted = normalise(needle);
  if (!wanted) return true;
  return haystack.some((value) => normalise(value).includes(wanted) || normalise(value).replaceAll(' ', '').includes(wanted.replaceAll(' ', '')));
};

export const policyMatches = (policy, search) =>
  matchesSearch(search, [policy.policyNumber, policy.insurerPolicyNumber, policy.insurer, policy.vehicle, policy.vehicleDetails?.plateNumber, policy.plan]);

const requestInsurers = (request) => [
  ...(request.insurers || []),
  ...(request.selectedProducts || []).flatMap((product) => [product.insurerName, product.productName]),
];

export const requestMatches = (request, search) =>
  matchesSearch(search, [request.id, request.vehicle, request.vehicleDetails?.plateNumber, ...requestInsurers(request)]);

/** The status filters a customer can pick for quote requests, in the words the page uses. */
export const REQUEST_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'waiting', label: 'Waiting for quotes' },
  { id: 'quoted', label: 'Quotes received' },
  { id: 'expired', label: 'Expired' },
];

/** Which filter a request falls under. */
export function requestFilterOf(request, now = new Date()) {
  const { status } = requestStatus(request, now);
  if (status === 'expired') return 'expired';
  if (status === 'quoted' || status === 'expiring') return 'quoted';
  return 'waiting';
}

export const requestInFilter = (request, filter, now = new Date()) => !filter || filter === 'all' || requestFilterOf(request, now) === filter;
