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
    const result = await fetcher();
    if (useStore.getState().leaving) return false;
    apply(result);
    return true;
  } catch (error) {
    if (useStore.getState().leaving) return false;
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

/**
 * Everything the insurer portal works from, scoped to the signed-in insurer.
 *
 * The `/insurer/*` routes already return only this insurer's records, so they
 * do not repeat its name on each one. The portal screens also run in mock mode,
 * where one store holds every insurer's records and the name is what tells them
 * apart, so each record is tagged with the signed-in insurer as it is loaded.
 */
export const hydrateInsurerPortal = async () => {
  const store = useStore.getState();
  let insurerName = store.staffSession?.insurerName ?? null;
  await load('your insurer profile', api.insurers.profile, (profile) => {
    store.setInsurers(profile ? [profile] : []);
    insurerName = profile?.name ?? insurerName;
  });
  await Promise.all([
    load('the quote queue', api.quotes.listForInsurer, (requests) => store.setQuoteRequests(scopeQuoteRequests(requests, insurerName))),
    load('paid policies', api.policies.listForInsurer, (policies) => store.setPolicies(scopeRecords(policies, insurerName))),
    load('claim notifications', api.claims.listForInsurer, (claims) => store.setClaims(scopeRecords(claims, insurerName))),
    load('NCD applications', api.ncd.listForInsurer, (applications) => store.setNcdApplications(scopeRecords(applications, insurerName))),
  ]);
};

/** Marks records from an `/insurer/*` route as belonging to that insurer. */
export const scopeRecords = (records, insurerName) =>
  (records || []).map((record) => ({ ...record, insurer: record.insurer ?? insurerName }));

/**
 * The portal route returns this insurer's own reply as `reply`; the screens
 * read replies by insurer name, as the customer view and mock mode hold them.
 */
export const scopeQuoteRequests = (requests, insurerName) =>
  (requests || []).map((request) => ({
    ...request,
    insurers: request.insurers ?? (insurerName ? [insurerName] : []),
    insurerQuotes: request.insurerQuotes ?? (request.reply && insurerName ? { [insurerName]: request.reply } : {}),
    selectedProducts: request.selectedProducts?.map((product) => ({ ...product, insurerName: product.insurerName ?? insurerName })),
  }));

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
