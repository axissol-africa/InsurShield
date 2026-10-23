import { reconcileInsurers } from '@/domain/insurers';
import { DEFAULT_QUOTE_VALIDITY_DAYS, REQUEST_VALIDITY_DAYS, addDays } from '@/domain/quoteValidity';
import { DEMO_CUSTOMER_ACCOUNT, SEED_CLAIMS, SEED_NCD_APPLICATIONS, SEED_POLICIES, SEED_QUOTE_REQUESTS, answeredByInsurers, withSeed } from './demoSeed';
import { env } from '@/config/env';
import { EMPTY_DOCUMENTS, TODAY } from './shared';

/**
 * Browser persistence for the prototype store: what is saved, how older
 * saves are migrated, and how a save is merged over the defaults.
 */

export const STORAGE_KEY = 'insurshield-storage';
export const STORAGE_VERSION = 7;

/** Keys from the v1 "select up to five insurers" model plus support-ticket and chat state. */
const LEGACY_KEYS = ['selectedInsurers', 'quoteStatus', 'quoteRulesAgreed', 'quoteRulesTimestamp', 'supportTickets', 'chatMessages', 'userPhone'];

const PERSISTED_KEYS = [
  'customer', 'isAuthenticated', 'authToken', 'registeredAccounts', 'staffSession',
  'consentAccepted', 'consentTimestamp', 'consentRecord',
  'vehicleDetails', 'vehicleValue', 'vehicleUsage', 'insuranceType', 'coverageDurationId', 'policyStartDate', 'matchRtsaAnniversary', 'rtsaRegistrationDate', 'policyDates',
  'activeQuoteRequestId', 'requotedFromId', 'renewalOfPolicyNumber', 'photosCapturedAt', 'selectedQuote', 'premiumBreakdown', 'paymentReceipt',
  'ncdCode', 'ncdCodeValidated', 'ncdCodeUsed', 'ncdApplications',
  'piaConfig', 'insurersList', 'mockStaffUsers', 'quoteRequests', 'policies', 'claims', 'inspections', 'insurerReviews',
];

/** Only data is persisted, never actions. */
export const partialize = (state) => Object.fromEntries(PERSISTED_KEYS.map((key) => [key, state[key]]));

/**
 * Requests saved before quote validity existed get a deadline from the reply's
 * sent date and the insurer's validity window, and a request expiry from the
 * submission date, so the customer sees the same rules on old data.
 */
export const backfillValidity = (requests, insurers) =>
  (Array.isArray(requests) ? requests : []).map((request) => {
    const insurerQuotes = Object.fromEntries(
      Object.entries(request.insurerQuotes || {}).map(([name, reply]) => {
        if (reply?.validUntil || !reply?.sentAt) return [name, reply];
        const days = reply.validityDays || insurers.find((insurer) => insurer.name === name)?.quoteValidityDays || DEFAULT_QUOTE_VALIDITY_DAYS;
        return [name, { ...reply, validityDays: days, validUntil: addDays(reply.sentAt, days) }];
      }),
    );
    return { ...request, insurerQuotes, expiresAt: request.expiresAt || (request.submittedAt ? addDays(request.submittedAt, REQUEST_VALIDITY_DAYS) : undefined) };
  });

/**
 * Stored state is merged over the defaults; the insurer list is reconciled
 * with the catalogue so stale or partial entries can never break quoting.
 */
export const merge = (persisted, current) => ({
  ...current,
  ...persisted,
  insurersList: reconcileInsurers(persisted?.insurersList),
  quoteRequests: backfillValidity(persisted?.quoteRequests ?? current.quoteRequests, reconcileInsurers(persisted?.insurersList)),
  // A start date saved on an earlier day would fail the date input's minimum.
  policyStartDate: persisted?.policyStartDate >= TODAY() ? persisted.policyStartDate : TODAY(),
  // Inspection images are deliberately not persisted. Seven camera data URLs
  // can exceed browser storage partway through a capture, leaving the phone
  // and computer out of sync. They remain available during the active quote
  // (and through the short-lived QR relay), then every new quote starts clean.
  documents: { ...EMPTY_DOCUMENTS },
});

export const migrate = (persisted, version) => {
  const state = Object.fromEntries(Object.entries(persisted || {}).filter(([key]) => !LEGACY_KEYS.includes(key)));
  // v3: accounts registered while testing earlier builds are cleared so the
  // same names and emails can be used fresh in client demos.
  if (version < 3) {
    state.registeredAccounts = [DEMO_CUSTOMER_ACCOUNT];
    if (state.customer?.email !== DEMO_CUSTOMER_ACCOUNT.email) {
      Object.assign(state, { customer: null, isAuthenticated: false, consentAccepted: false, consentTimestamp: null, consentRecord: null });
    }
  }
  if (version < 4) state.insurersList = reconcileInsurers(state.insurersList);
  // v5: insurer-portal demo records moved into the store so portal actions work on them.
  if (version < 5) {
    state.quoteRequests = withSeed(state.quoteRequests, SEED_QUOTE_REQUESTS);
    state.claims = withSeed(state.claims, SEED_CLAIMS);
    state.ncdApplications = withSeed(state.ncdApplications, SEED_NCD_APPLICATIONS);
    state.policies = withSeed(state.policies, SEED_POLICIES, 'policyNumber');
  }
  // v6: remove old persisted photos/White Books. Keeping them caused stale
  // captures to appear in a new quote and could exhaust localStorage.
  if (version < 6) state.documents = { ...EMPTY_DOCUMENTS };
  // v7: insurers answer the demo customer's own open requests, so a browser
  // that already holds a request from an earlier session shows the quotation
  // and cover guide a customer receives — rather than sitting on "0 of 5
  // insurers have replied" with nobody able to reply. Requests from the other
  // demo customers are left open, or the insurer's own queue would be empty.
  if (version < 7 && env.apiMode === 'mock') {
    state.quoteRequests = withSeed(state.quoteRequests, SEED_QUOTE_REQUESTS).map(answeredByInsurers);
  }
  return state;
};
