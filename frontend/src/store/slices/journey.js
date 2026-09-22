import { INSPECTION_KEYS } from '@/domain/inspection';
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
  activeQuoteRequestId: null,
  requotedFromId: null,
  photosCapturedAt: null,
  selectedQuote: null,
  premiumBreakdown: null,
  paymentReceipt: null,
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
  setPolicyStartDate: (policyStartDate) => set({ policyStartDate }),
  setRtsaAnniversary: (matchRtsaAnniversary, rtsaRegistrationDate) =>
    set((state) => ({ matchRtsaAnniversary, rtsaRegistrationDate: rtsaRegistrationDate ?? state.rtsaRegistrationDate })),
  setDocuments: (updates) => set((state) => ({ documents: { ...state.documents, ...updates }, photosCapturedAt: NOW() })),
  setDocument: (type, url) =>
    set((state) => ({ documents: { ...state.documents, [type]: url }, ...(type.startsWith('insp_') ? { photosCapturedAt: NOW() } : {}) })),

  /**
   * Submit the customer's request to every active insurer at once.
   * Returns the new request id.
   */
  submitQuoteRequest: ({ customer, policyDates }) => {
    const state = get();
    const insurers = state.insurersList.filter(insurerReceivesRequests);
    const id = newReference('QR');
    const submittedAt = NOW();
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
      vehicle: vehicleLabel(state.vehicleDetails),
      vehicleDetails: state.vehicleDetails,
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

  /** Reopen an earlier request (from the account page) for comparison. */
  setActiveQuoteRequest: (activeQuoteRequestId) => set({ activeQuoteRequestId, selectedQuote: null, premiumBreakdown: null }),
  selectQuote: (quote, breakdown) => set({ selectedQuote: quote, premiumBreakdown: breakdown }),
  recordPayment: (paymentReceipt) => set({ paymentReceipt }),

  // ─── NCD code (pre-approved by an insurer) ───────────────
  setNcdCode: (ncdCode) => set({ ncdCode }),
  setNcdCodeValidated: (ncdCodeValidated) => set({ ncdCodeValidated }),
  clearNcdCode: () => set({ ncdCode: '', ncdCodeValidated: null, ncdCodeUsed: false }),
  markNcdCodeUsed: () => set({ ncdCodeUsed: true }),

  resetJourney: () => set({ ...JOURNEY_DEFAULTS, policyStartDate: TODAY() }),
});
