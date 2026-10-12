import { env } from '@/config/env';
import { useStore } from '@/store';
import { api } from './index';

/**
 * Loading server records into the store.
 *
 * Pages read from the store, so the API is never called from a render path:
 * a screen asks for the records it needs when it opens, the response replaces
 * that collection, and the page re-renders from the store as usual.
 *
 * In mock mode the store already holds everything, so each of these is a
 * no-op — which is what lets one page work unchanged in both modes.
 */

const live = () => env.apiMode === 'http';

/** Runs a load and reports failure once, without taking the page down with it. */
const load = async (label, fetcher, apply) => {
  if (!live()) return false;
  try {
    apply(await fetcher());
    return true;
  } catch (error) {
    console.error(`Could not load ${label}`, error);
    return false;
  }
};

/** The signed-in customer's own records: quotes, policies, claims, NCD, inspections. */
export const hydrateCustomer = async () => {
  if (!live() || !useStore.getState().isAuthenticated) return;
  const store = useStore.getState();
  await Promise.all([
    load('your quote requests', api.quotes.listMine, store.setQuoteRequests),
    load('your policies', api.policies.listMine, store.setPolicies),
    load('your claims', api.claims.listMine, store.setClaims),
    load('your NCD applications', api.ncd.listMine, store.setNcdApplications),
    load('your inspections', api.inspections.list, store.setInspections),
  ]);
};

/** Everything the insurer portal works from, scoped to the signed-in insurer. */
export const hydrateInsurerPortal = async () => {
  const store = useStore.getState();
  await Promise.all([
    load('the quote queue', api.quotes.listForInsurer, store.setQuoteRequests),
    load('paid policies', api.policies.listForInsurer, store.setPolicies),
    load('claim notifications', api.claims.listForInsurer, store.setClaims),
    load('NCD applications', api.ncd.listForInsurer, store.setNcdApplications),
  ]);
};

/** The insurer catalogue and PIA floor the administrator maintains. */
export const hydrateAdmin = async () => {
  const store = useStore.getState();
  await Promise.all([
    load('the insurer list', api.insurers.list, store.setInsurers),
    load('the PIA configuration', api.config.getPia, store.setPiaConfig),
  ]);
};

/** The public insurer directory, used by the contact page and the home page. */
export const hydrateDirectory = () =>
  load('the insurer directory', api.insurers.directory, useStore.getState().setInsurers);
