import { useShallow } from 'zustand/react/shallow';
import { requestStatus } from '@/domain/quoteValidity';
import { useStore } from './store';
import { insurerReceivesRequests } from './shared';

/** Insurers that currently receive quote requests (shallow-compared so the filtered array is stable). */
const selectActiveInsurers = (state) => state.insurersList.filter(insurerReceivesRequests);
export const useActiveInsurers = () => useStore(useShallow(selectActiveInsurers));

/** Status of a quote request for the customer's account. */
export const requestStatusOf = (request) => requestStatus(request);

/** The quote request currently being compared / paid for, if any. */
export const selectActiveQuoteRequest = (state) =>
  state.quoteRequests.find((request) => request.id === state.activeQuoteRequestId) || null;

/**
 * Records that belong to the signed-in customer.
 *
 * Records name their customer in more than one shape — a nested `customer` on
 * a quote request, flat `customerEmail` on a policy, the contact details the
 * person typed on a claim — so every one of them is checked. A phone is only
 * matched when the account actually has one, otherwise two accounts without a
 * number would match each other.
 */
export const belongsToCustomer = (customer) => (item) => {
  if (!customer) return false;
  const emails = [item.customer?.email, item.customerEmail, item.email];
  if (customer.email && emails.includes(customer.email)) return true;
  const phones = [item.customer?.phone, item.customerPhone, item.phone];
  return Boolean(customer.phone) && phones.includes(customer.phone);
};
