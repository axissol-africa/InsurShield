import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import { INSURER_RATES, PIA_CONFIG, reconcileInsurers } from '../utils/insurerRates';
import { INSPECTION_KEYS } from '../utils/inspection';
import { DEFAULT_QUOTE_VALIDITY_DAYS, REQUEST_VALIDITY_DAYS, addDays, photosReusable, requestStatus } from '../utils/quoteValidity';

/**
 * InsurShield — Application Store
 * -------------------------------
 * Single persisted Zustand store for the prototype.
 *
 * Business model
 *  - Guests may explore every public page, including vehicle and cover steps.
 *  - A customer account is required to submit a quote request, manage claims or renew.
 *  - Every quote request is sent to ALL active insurers on the platform so each
 *    partner has an equal chance to win the customer. Insurers reply with their
 *    own final quotes; until then the customer sees an indicative estimate.
 *
 * Prototype-only identities live here. A production implementation must
 * authenticate against a secure service and never keep passwords, OTPs or
 * consent audit records in browser storage.
 */

export const DEMO_CUSTOMER_ACCOUNT = {
  id: 'CUS-DEMO-001',
  fullName: 'Mwiza Banda',
  email: 'mwiza.banda@insurshield.zm',
  phone: '0970123456',
  password: 'Customer123!',
  consentTimestamp: '2026-09-01T09:00:00.000Z',
};

const EMPTY_DOCUMENTS = { whiteBook: null, ...Object.fromEntries(INSPECTION_KEYS.map((key) => [key, null])) };

const TODAY = () => new Date().toISOString().split('T')[0];

const LEGACY_KEYS = ['selectedInsurers', 'quoteStatus', 'quoteRulesAgreed', 'quoteRulesTimestamp', 'supportTickets', 'chatMessages', 'userPhone'];

const toCustomerProfile = (account) => ({ fullName: account.fullName, email: account.email, phone: account.phone });

const matchesIdentifier = (account, identifier) =>
  account.email.toLowerCase() === identifier.toLowerCase() || account.phone === identifier;

const withTimestamp = (record, key = 'updatedAt') => ({ ...record, [key]: new Date().toISOString() });

const updateById = (items, id, updater) => items.map((item) => (item.id === id ? updater(item) : item));

/** Unique, human-readable reference: prefix + timestamp + random suffix (two requests in the same instant never collide). */
const newReference = (prefix) => `${prefix}-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

/** State cleared when a quote journey ends (policy issued) or a new one starts. */
const JOURNEY_DEFAULTS = {
  vehicleDetails: null,
  vehicleValue: 0,
  vehicleUsage: '',
  insuranceType: '',
  coverageDurationId: '4q',
  policyStartDate: TODAY(),
  matchRtsaAnniversary: false,
  rtsaRegistrationDate: '',
  policyDates: null,
  activeQuoteRequestId: null,
  requotedFromId: null,
  photosCapturedAt: null,
  selectedQuote: null,
  premiumBreakdown: null,
  ncdCode: '',
  ncdCodeValidated: null,
  ncdCodeUsed: false,
  documents: { ...EMPTY_DOCUMENTS },
};

export const useStore = create(
  persist(
    (set, get) => ({
      // ─── Customer account ────────────────────────────────────
      customer: null,
      isAuthenticated: false,
      registeredAccounts: [DEMO_CUSTOMER_ACCOUNT],

      seedDemoAccount: () =>
        set((state) =>
          state.registeredAccounts.some((account) => account.email === DEMO_CUSTOMER_ACCOUNT.email)
            ? state
            : { registeredAccounts: [DEMO_CUSTOMER_ACCOUNT, ...state.registeredAccounts] },
        ),

      registerCustomerAccount: (account) =>
        set((state) => ({
          registeredAccounts: [...state.registeredAccounts, account],
          customer: toCustomerProfile(account),
          isAuthenticated: true,
          consentAccepted: true,
          consentTimestamp: account.consentTimestamp,
        })),

      authenticateCustomer: (identifier, password) => {
        // The seeded account is always included so a stale browser session can
        // never lock an evaluator out of the prototype.
        const accounts = [
          DEMO_CUSTOMER_ACCOUNT,
          ...get().registeredAccounts.filter((account) => account.email !== DEMO_CUSTOMER_ACCOUNT.email),
        ];
        const account = accounts.find((candidate) => matchesIdentifier(candidate, identifier) && candidate.password === password);
        if (!account) return false;
        set({
          customer: toCustomerProfile(account),
          isAuthenticated: true,
          consentAccepted: true,
          consentTimestamp: account.consentTimestamp || new Date().toISOString(),
        });
        return true;
      },

      resetCustomerPassword: (identifier, password) =>
        set((state) => ({
          registeredAccounts: state.registeredAccounts.map((account) =>
            matchesIdentifier(account, identifier) ? { ...account, password } : account,
          ),
        })),

      signOut: () =>
        set({ customer: null, isAuthenticated: false, consentAccepted: false, consentTimestamp: null, consentRecord: null }),

      /** Prototype only: remove the signed-in account so its details can be reused in a demo. */
      deleteCurrentAccount: () =>
        set((state) => ({
          registeredAccounts: state.registeredAccounts.filter((account) => account.email !== state.customer?.email || account.email === DEMO_CUSTOMER_ACCOUNT.email),
          customer: null, isAuthenticated: false, consentAccepted: false, consentTimestamp: null, consentRecord: null,
        })),

      // ─── Staff / insurer portal session ──────────────────────
      staffSession: null, // { role: 'admin' | 'support' | 'insurer', name }
      startStaffSession: (session) => set({ staffSession: session }),
      endStaffSession: () => set({ staffSession: null }),

      // ─── Data-protection consent ─────────────────────────────
      consentAccepted: false,
      consentTimestamp: null,
      consentRecord: null,
      setConsent: (accepted, record = null) =>
        set({
          consentAccepted: accepted,
          consentTimestamp: accepted ? record?.acceptedAt || new Date().toISOString() : null,
          consentRecord: accepted ? record : null,
        }),

      // ─── Quote journey ───────────────────────────────────────
      ...JOURNEY_DEFAULTS,
      setVehicleDetails: (vehicleDetails) => set({ vehicleDetails }),
      setVehicleValue: (vehicleValue) => set({ vehicleValue }),
      setVehicleUsage: (vehicleUsage) => set({ vehicleUsage }),
      setInsuranceType: (insuranceType) => set({ insuranceType }),
      setCoverageDuration: (coverageDurationId) => set({ coverageDurationId }),
      setPolicyStartDate: (policyStartDate) => set({ policyStartDate }),
      setRtsaAnniversary: (matchRtsaAnniversary, rtsaRegistrationDate) =>
        set((state) => ({ matchRtsaAnniversary, rtsaRegistrationDate: rtsaRegistrationDate ?? state.rtsaRegistrationDate })),
      setDocuments: (updates) => set((state) => ({ documents: { ...state.documents, ...updates }, photosCapturedAt: new Date().toISOString() })),
      setDocument: (type, url) =>
        set((state) => ({ documents: { ...state.documents, [type]: url }, ...(type.startsWith('insp_') ? { photosCapturedAt: new Date().toISOString() } : {}) })),

      /**
       * Submit the customer's request to every active insurer at once.
       * Returns the new request id.
       */
      submitQuoteRequest: ({ customer, policyDates }) => {
        const state = get();
        const insurers = state.insurersList.filter((insurer) => insurer.status !== 'Inactive');
        const id = newReference('QR');
        const { vehicleDetails } = state;
        const submittedAt = new Date().toISOString();
        const request = {
          id,
          status: 'Submitted',
          submittedAt,
          // The declared value and live photos go stale; without valid quotes the request expires.
          expiresAt: addDays(submittedAt, REQUEST_VALIDITY_DAYS),
          requotedFromId: state.requotedFromId,
          customer,
          insurers: insurers.map((insurer) => insurer.name),
          insurerIds: insurers.map((insurer) => insurer.id),
          insurerQuotes: {},
          vehicle: vehicleDetails
            ? `${vehicleDetails.year || ''} ${vehicleDetails.make || ''} ${vehicleDetails.model || ''}`.trim()
            : 'Vehicle details pending',
          vehicleDetails,
          vehicleValue: state.vehicleValue,
          vehicleUsage: state.vehicleUsage,
          insuranceType: state.insuranceType,
          coverageDurationId: state.coverageDurationId,
          matchRtsaAnniversary: state.matchRtsaAnniversary,
          rtsaRegistrationDate: state.rtsaRegistrationDate,
          policyDates,
          // Photo blobs stay in `documents`; the request records which shots were captured.
          inspectionShots: INSPECTION_KEYS.filter((key) => Boolean(state.documents[key])),
          photosCapturedAt: state.photosCapturedAt,
        };
        const quoteRequests = state.requotedFromId
          ? updateById(state.quoteRequests, state.requotedFromId, (old) => ({ ...old, status: 'Expired', requotedAs: id }))
          : state.quoteRequests;
        set({ quoteRequests: [request, ...quoteRequests], activeQuoteRequestId: id, policyDates, requotedFromId: null });
        return id;
      },

      /**
       * Start a fresh request from an expired one: the journey is pre-filled
       * with the old vehicle, value, usage, period and documents. Live photos
       * are reused only while still within the reuse window.
       */
      requoteFromRequest: (requestId) => {
        const state = get();
        const old = state.quoteRequests.find((request) => request.id === requestId);
        if (!old) return false;
        const reusePhotos = photosReusable(old.photosCapturedAt);
        set({
          ...JOURNEY_DEFAULTS,
          policyStartDate: TODAY(),
          vehicleDetails: old.vehicleDetails,
          vehicleValue: old.vehicleValue,
          vehicleUsage: old.vehicleUsage,
          insuranceType: old.insuranceType,
          coverageDurationId: old.coverageDurationId,
          matchRtsaAnniversary: Boolean(old.matchRtsaAnniversary),
          rtsaRegistrationDate: old.rtsaRegistrationDate || '',
          documents: reusePhotos ? { ...state.documents } : { ...EMPTY_DOCUMENTS, whiteBook: state.documents.whiteBook },
          photosCapturedAt: reusePhotos ? old.photosCapturedAt : null,
          requotedFromId: requestId,
        });
        return true;
      },

      /** Insurer portal: attach a final quote to a request. The quote is valid for the insurer's configured number of days. */
      addInsurerQuote: (requestId, insurerName, quote) =>
        set((state) => {
          const insurer = state.insurersList.find((item) => item.name === insurerName);
          const validityDays = quote.validityDays || insurer?.quoteValidityDays || DEFAULT_QUOTE_VALIDITY_DAYS;
          const sentAt = new Date().toISOString();
          return {
            quoteRequests: updateById(state.quoteRequests, requestId, (request) => ({
              ...request,
              status: 'Quoted',
              insurerQuotes: { ...request.insurerQuotes, [insurerName]: { ...quote, sentAt, validityDays, validUntil: addDays(sentAt, validityDays) } },
            })),
          };
        }),

      /** Insurer portal: extend an unexpired quote's validity. */
      extendInsurerQuote: (requestId, insurerName, extraDays) =>
        set((state) => ({
          quoteRequests: updateById(state.quoteRequests, requestId, (request) => {
            const reply = request.insurerQuotes?.[insurerName];
            if (!reply?.validUntil) return request;
            return { ...request, insurerQuotes: { ...request.insurerQuotes, [insurerName]: { ...reply, validUntil: addDays(reply.validUntil, extraDays), extendedAt: new Date().toISOString() } } };
          }),
        })),

      /** Reopen an earlier request (from the account page) for comparison. */
      setActiveQuoteRequest: (activeQuoteRequestId) => set({ activeQuoteRequestId, selectedQuote: null, premiumBreakdown: null }),

      selectQuote: (quote, breakdown) => set({ selectedQuote: quote, premiumBreakdown: breakdown }),

      // ─── NCD code (pre-approved by an insurer) ───────────────
      setNcdCode: (ncdCode) => set({ ncdCode }),
      setNcdCodeValidated: (ncdCodeValidated) => set({ ncdCodeValidated }),
      clearNcdCode: () => set({ ncdCode: '', ncdCodeValidated: null, ncdCodeUsed: false }),
      markNcdCodeUsed: () => set({ ncdCodeUsed: true }),

      ncdApplications: [],
      addNcdApplication: (application) =>
        set((state) => ({
          ncdApplications: [
            {
              ...application,
              id: `NCDA-${Date.now()}`,
              applicationNumber: `NCD-${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
              status: 'Submitted',
              submittedAt: new Date().toISOString(),
              approvedCode: null,
            },
            ...state.ncdApplications,
          ],
        })),
      updateNcdApplicationStatus: (applicationId, status, approvedCode) =>
        set((state) => ({
          ncdApplications: updateById(state.ncdApplications, applicationId, (application) =>
            withTimestamp({ ...application, status, approvedCode: approvedCode || application.approvedCode }),
          ),
        })),

      // ─── Platform configuration ──────────────────────────────
      piaConfig: { ...PIA_CONFIG },
      setPiaConfig: (config) => set((state) => ({ piaConfig: { ...state.piaConfig, ...config } })),

      insurersList: INSURER_RATES,
      addInsurer: (insurer) =>
        set((state) => ({ insurersList: [...state.insurersList, { ...insurer, id: Date.now().toString() }] })),
      updateInsurerRate: (insurerId, updates) =>
        set((state) => ({ insurersList: updateById(state.insurersList, insurerId, (insurer) => ({ ...insurer, ...updates })) })),

      // ─── Records shared across portals ───────────────────────
      quoteRequests: [],
      policies: [],
      addPolicy: (policy) =>
        set((state) =>
          state.policies.some((item) => item.policyNumber === policy.policyNumber)
            ? state
            : { policies: [{ ...policy, issuedAt: new Date().toISOString(), status: 'Active' }, ...state.policies] },
        ),

      // ─── Claims (first notification only) ───────────────────
      // InsurShield records the notification and issues a claim number. The
      // customer then calls the insurer, who handles assessment and settlement
      // outside the platform; the insurer can mark the notification as received.
      claims: [],
      addClaim: (claim) =>
        set((state) => ({
          claims: [{ ...claim, id: claim.claimNumber, status: 'Notified', submittedAt: new Date().toISOString() }, ...state.claims],
        })),
      markClaimReceived: (claimId) =>
        set((state) => ({
          claims: updateById(state.claims, claimId, (claim) => ({ ...claim, status: 'Received by insurer', receivedAt: new Date().toISOString() })),
        })),

      // ─── Inspections ─────────────────────────────────────────
      inspections: [],
      addInspection: (inspection) =>
        set((state) => ({
          inspections: [{ ...inspection, id: `INS-${Date.now()}`, createdAt: new Date().toISOString() }, ...state.inspections],
        })),
      updateInspectionStatus: (inspectionId, status, data) =>
        set((state) => ({
          inspections: updateById(state.inspections, inspectionId, (inspection) => withTimestamp({ ...inspection, status, ...data })),
        })),

      // ─── Journey reset ───────────────────────────────────────
      resetJourney: () => set({ ...JOURNEY_DEFAULTS, policyStartDate: TODAY() }),
    }),
    {
      name: 'insurshield-storage',
      version: 4,
      // Stored state is merged over the defaults; the insurer list is reconciled
      // with the catalogue so stale or partial entries can never break quoting.
      merge: (persisted, current) => ({
        ...current,
        ...persisted,
        insurersList: reconcileInsurers(persisted?.insurersList),
        // A start date saved on an earlier day would fail the date input's minimum.
        policyStartDate: persisted?.policyStartDate >= TODAY() ? persisted.policyStartDate : TODAY(),
        documents: { ...EMPTY_DOCUMENTS, ...Object.fromEntries(Object.entries(persisted?.documents || {}).filter(([key]) => key in EMPTY_DOCUMENTS)) },
      }),
      migrate: (persisted, version) => {
        // v1 persisted the "select up to five insurers" model plus support-ticket and chat state.
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
        return state;
      },
      partialize: ({
        customer, isAuthenticated, registeredAccounts, staffSession,
        consentAccepted, consentTimestamp, consentRecord,
        vehicleDetails, vehicleValue, vehicleUsage, insuranceType, coverageDurationId, policyStartDate, matchRtsaAnniversary, rtsaRegistrationDate, policyDates,
        activeQuoteRequestId, requotedFromId, photosCapturedAt, selectedQuote, premiumBreakdown, documents,
        ncdCode, ncdCodeValidated, ncdCodeUsed, ncdApplications,
        piaConfig, insurersList, quoteRequests, policies, claims, inspections,
      }) => ({
        customer, isAuthenticated, registeredAccounts, staffSession,
        consentAccepted, consentTimestamp, consentRecord,
        vehicleDetails, vehicleValue, vehicleUsage, insuranceType, coverageDurationId, policyStartDate, matchRtsaAnniversary, rtsaRegistrationDate, policyDates,
        activeQuoteRequestId, requotedFromId, photosCapturedAt, selectedQuote, premiumBreakdown, documents,
        ncdCode, ncdCodeValidated, ncdCodeUsed, ncdApplications,
        piaConfig, insurersList, quoteRequests, policies, claims, inspections,
      }),
    },
  ),
);

/** Insurers that currently receive quote requests (shallow-compared so the filtered array is stable). */
const selectActiveInsurers = (state) => state.insurersList.filter((insurer) => insurer.status !== 'Inactive');
export const useActiveInsurers = () => useStore(useShallow(selectActiveInsurers));

/** Status of every request for the signed-in customer, newest first. */
export const requestStatusOf = (request) => requestStatus(request);

/** The quote request currently being compared / paid for, if any. */
export const selectActiveQuoteRequest = (state) =>
  state.quoteRequests.find((request) => request.id === state.activeQuoteRequestId) || null;

/** Records that belong to the signed-in customer. */
export const belongsToCustomer = (customer) => (item) => {
  if (!customer) return false;
  const emails = [item.customer?.email, item.customerEmail];
  const phones = [item.customer?.phone, item.customerPhone, item.phone];
  return emails.includes(customer.email) || phones.includes(customer.phone);
};
