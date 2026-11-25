import { INSPECTION_KEYS } from '@/domain/inspection';
import { env } from '@/config/env';
import { SEED_ACTIVE_REQUEST_ID } from '../demoSeed';
import { answeredByInsurers } from '../demoSeed';
import { REQUEST_VALIDITY_DAYS, addDays, photosReusable } from '@/domain/quoteValidity';
import { EMPTY_DOCUMENTS, NOW, TODAY, insurerReceivesRequests, newReference, updateById } from '../shared';

/**
 * The customer's current quote journey: cover, vehicle, value, usage, period,
 * documents, the request they are comparing and the quote they are paying for.
 * Everything here is reset when a policy is issued or a new journey starts.
 */

/** State cleared when a quote journey ends (policy issued) or a new one starts. */
export const JOURNEY_DEFAULTS = {
  vehicleDetails: null,
  vehicleValue: 0,
  vehicleUsage: '',
  insuranceType: '',
  coverageDurationId: '4q',
  policyStartDate: TODAY(),
  matchRtsaAnniversary: false,
  rtsaRegistrationDate: '',
  policyDates: null,
  selectedProductVersionIds: [],
  selectedProductVersions: [],
  // Answers are kept per immutable product version. This avoids accidentally
  // sharing a response between insurers whose fields merely have the same key.
  productRequirementAnswers: {},
  productRequirementDeclarations: {},
  productRequirementDocuments: {},
  // The demo customer lands on their own answered request, so the comparison
  // page shows quotations and cover guides rather than an empty state. With a
  // backend there is nothing seeded to point at.
  activeQuoteRequestId: env.apiMode === 'mock' ? SEED_ACTIVE_REQUEST_ID : null,
  requotedFromId: null,
  renewalOfPolicyNumber: null,
  photosCapturedAt: null,
  selectedQuote: null,
  premiumBreakdown: null,
  paymentReceipt: null,
  /** The open payment attempt, kept across a card checkout round trip: its key, transaction and the quote it pays. */
  paymentAttempt: null,
  /** Contact choices in mock mode; absence of a row means the category is on. */
  contactPreferences: [],
  marketingConsent: false,
  ncdCode: '',
  ncdCodeValidated: null,
  ncdCodeUsed: false,
  documents: { ...EMPTY_DOCUMENTS },
};

const vehicleLabel = (vehicle) => (vehicle ? `${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim() : 'Vehicle details pending');

export const createJourneySlice = (set, get) => ({
  ...JOURNEY_DEFAULTS,

  setVehicleDetails: (vehicleDetails) => set({ vehicleDetails }),
  setVehicleValue: (vehicleValue) => set({ vehicleValue }),
  setVehicleUsage: (vehicleUsage) => set({ vehicleUsage }),
  setInsuranceType: (insuranceType) => set({ insuranceType }),
  setCoverageDuration: (coverageDurationId) => set({ coverageDurationId }),
  setSelectedProductVersions: (selectedProductVersionIds, selectedProductVersions = []) =>
    set((state) => {
      const ids = [...new Set(selectedProductVersionIds || [])];
      const keepSelected = (entries) =>
        Object.fromEntries(Object.entries(entries).filter(([key]) => ids.some((id) => key.startsWith(`${id}:`))));
      return {
        selectedProductVersionIds: ids,
        selectedProductVersions,
        productRequirementAnswers: keepSelected(state.productRequirementAnswers),
        productRequirementDeclarations: keepSelected(state.productRequirementDeclarations),
        productRequirementDocuments: keepSelected(state.productRequirementDocuments),
      };
    }),
  setProductRequirementAnswer: (key, value) =>
    set((state) => ({ productRequirementAnswers: { ...state.productRequirementAnswers, [key]: value } })),
  setProductRequirementDeclaration: (key, accepted) =>
    set((state) => ({ productRequirementDeclarations: { ...state.productRequirementDeclarations, [key]: accepted } })),
  setProductRequirementDocument: (key, document) =>
    set((state) => ({ productRequirementDocuments: { ...state.productRequirementDocuments, [key]: document } })),
  /** Restores the exact product-specific data carried by a secure phone hand-off. */
  setProductRequirementResponses: ({ answers = {}, declarations = {}, documents = {} }) =>
    set((state) => {
      const keepSelected = (entries) =>
        Object.fromEntries(
          Object.entries(entries).filter(([key]) => state.selectedProductVersionIds.some((id) => key.startsWith(`${id}:`))),
        );
      return {
        productRequirementAnswers: keepSelected(answers),
        productRequirementDeclarations: keepSelected(declarations),
        productRequirementDocuments: keepSelected(documents),
      };
    }),
  setPolicyStartDate: (policyStartDate) => set({ policyStartDate }),
  setRtsaAnniversary: (matchRtsaAnniversary, rtsaRegistrationDate) =>
    set((state) => ({ matchRtsaAnniversary, rtsaRegistrationDate: rtsaRegistrationDate ?? state.rtsaRegistrationDate })),
  setDocuments: (updates) => set((state) => ({ documents: { ...state.documents, ...updates }, photosCapturedAt: NOW() })),
  setDocument: (type, url) =>
    set((state) => ({ documents: { ...state.documents, [type]: url }, ...(type.startsWith('insp_') ? { photosCapturedAt: NOW() } : {}) })),

  /**
   * Save the customer's verified details, then let them compare published
   * cover guides before choosing which insurers receive the quote request.
   */
  submitQuoteRequest: ({ customer, policyDates, rtsaAnniversaryFee = 0, selectedProducts = [] }) => {
    const state = get();
    const id = newReference('QR');
    const submittedAt = NOW();
    const request = {
      id,
      status: selectedProducts.length ? 'Submitted' : 'GuidesReady',
      guideSelectionPending: selectedProducts.length === 0,
      submittedAt,
      // The declared value and live photos go stale; without valid quotes the request expires.
      expiresAt: addDays(submittedAt, REQUEST_VALIDITY_DAYS),
      requotedFromId: state.requotedFromId,
      renewalOfPolicyNumber: state.renewalOfPolicyNumber,
      customer,
      insurers: [...new Map(selectedProducts.map((product) => [product.insurerId, product.insurerName])).values()],
      insurerIds: [...new Set(selectedProducts.map((product) => product.insurerId))],
      insurerQuotes: {},
      productQuotes: [],
      selectedProducts,
      vehicle: vehicleLabel(state.vehicleDetails),
      vehicleDetails: state.vehicleDetails,
      vehicleValue: state.vehicleValue,
      vehicleUsage: state.vehicleUsage,
      insuranceType: state.insuranceType,
      coverageDurationId: state.coverageDurationId,
      matchRtsaAnniversary: state.matchRtsaAnniversary,
      // This value is returned by the API. In mock mode it is supplied by the
      // mock server adapter so payment screens use the same response contract.
      rtsaAnniversaryFee,
      rtsaRegistrationDate: state.rtsaRegistrationDate,
      policyDates,
      // Photo blobs stay in `documents`; the request records which shots were captured.
      inspectionShots: INSPECTION_KEYS.filter((key) => Boolean(state.documents[key])),
      photosCapturedAt: state.photosCapturedAt,
    };
    const quoteRequests = state.requotedFromId
      ? updateById(state.quoteRequests, state.requotedFromId, (old) => ({ ...old, status: 'Expired', requotedAs: id }))
      : state.quoteRequests;
    set({ quoteRequests: [request, ...quoteRequests], activeQuoteRequestId: id, policyDates, requotedFromId: null, renewalOfPolicyNumber: null });
    return id;
  },

  /**
   * Distribute a saved request only to the insurers whose published cover
   * guide the customer chose. This keeps the choice explicit and auditable.
   */
  requestQuotesFromGuides: (requestId, insurerIds, { createDemoReplies = false } = {}) => {
    const state = get();
    const selectedIds = [...new Set(insurerIds || [])];
    const insurers = state.insurersList.filter(
      (insurer) => selectedIds.includes(insurer.id) && insurerReceivesRequests(insurer),
    );
    if (!insurers.length) return false;

    set((current) => ({
      quoteRequests: updateById(current.quoteRequests, requestId, (request) => ({
        ...request,
        status: 'Submitted',
        guideSelectionPending: false,
        quotesRequestedAt: NOW(),
        insurers: insurers.map((insurer) => insurer.name),
        insurerIds: insurers.map((insurer) => insurer.id),
      })),
    }));
    // Demo mode needs a complete customer journey without asking the
    // presenter to play every insurer as well. Real insurers still reply
    // through their portal, with their own uploaded PDF or image.
    if (createDemoReplies && env.apiMode === 'mock') get().completeDemoQuoteReplies(requestId);
    return true;
  },

  /** Create immediately available example PDF quotations in mock mode only. */
  completeDemoQuoteReplies: (requestId) => {
    if (env.apiMode !== 'mock') return false;
    set((current) => ({
      quoteRequests: updateById(current.quoteRequests, requestId, (request) => {
        if (!request?.insurers?.length || Object.keys(request.insurerQuotes || {}).length) return request;
        return answeredByInsurers(request, { replies: request.insurers.length, immediate: true });
      }),
    }));
    return true;
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

  /**
   * Start a renewal from an existing policy: the journey is pre-filled with the
   * policy's vehicle, value and cover, and new cover starts the day the old
   * policy ends so there is no gap. Photos are never carried over — an insurer
   * quoting a renewal needs to see the vehicle as it is now.
   */
  renewFromPolicy: (policyNumber) => {
    const state = get();
    const policy = state.policies.find((entry) => entry.policyNumber === policyNumber);
    if (!policy) return false;
    const endDate = policy.policyDates?.endDate;
    const resumeDate = endDate ? new Date(endDate).toISOString().slice(0, 10) : TODAY();
    set({
      ...JOURNEY_DEFAULTS,
      // Renewing late must not backdate cover to a day that has already passed.
      policyStartDate: resumeDate > TODAY() ? resumeDate : TODAY(),
      vehicleDetails: policy.vehicleDetails || null,
      vehicleValue: policy.vehicleValue || policy.insuredValue || 0,
      ...(policy.vehicleUsage ? { vehicleUsage: policy.vehicleUsage } : {}),
      insuranceType: /third/i.test(policy.coverage || '') ? 'ThirdParty' : 'Comprehensive',
      documents: { ...EMPTY_DOCUMENTS, whiteBook: state.documents.whiteBook },
      renewalOfPolicyNumber: policyNumber,
      // The product the server says this renewal continues with, so the
      // customer starts from it and can add others to compare.
      ...(policy.renewalProduct?.available
        ? { selectedProductVersionIds: [policy.renewalProduct.productVersionId], selectedProductVersions: [] }
        : {}),
    });
    return true;
  },

  /** Reopen an earlier request (from the account page) for comparison. */
  setActiveQuoteRequest: (activeQuoteRequestId) => set({ activeQuoteRequestId, selectedQuote: null, premiumBreakdown: null }),
  selectQuote: (quote, breakdown) => set({ selectedQuote: quote, premiumBreakdown: breakdown }),
  recordPayment: (paymentReceipt) => set({ paymentReceipt }),
  setPaymentAttempt: (paymentAttempt) => set({ paymentAttempt }),

  /** One row per category and channel; saving again replaces the choice. */
  saveContactPreference: (choice) =>
    set((state) => ({
      contactPreferences: [
        ...state.contactPreferences.filter(
          (existing) => !(existing.category === choice.category && existing.channel === choice.channel),
        ),
        choice,
      ],
      marketingConsent:
        choice.category === 'MARKETING' ? choice.enabled : state.marketingConsent,
    })),

  // ─── NCD code (pre-approved by an insurer) ───────────────
  setNcdCode: (ncdCode) => set({ ncdCode }),
  setNcdCodeValidated: (ncdCodeValidated) => set({ ncdCodeValidated }),
  clearNcdCode: () => set({ ncdCode: '', ncdCodeValidated: null, ncdCodeUsed: false }),
  markNcdCodeUsed: () => set({ ncdCodeUsed: true }),

  resetJourney: () => set({ ...JOURNEY_DEFAULTS, policyStartDate: TODAY(), activeQuoteRequestId: null }),
});
