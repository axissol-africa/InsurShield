import { DEFAULT_QUOTE_VALIDITY_DAYS, addDays } from '@/domain/quoteValidity';
import { env } from '@/config/env';
import { SEED_CLAIMS, SEED_INSURER_REVIEWS, SEED_NCD_APPLICATIONS, SEED_POLICIES, SEED_QUOTE_REQUESTS } from '../demoSeed';

/**
 * Demo records exist so the portal is never empty when the app runs on its
 * own. With a backend the server is the only source of records — seeding
 * here would show invented policies and claims alongside real ones.
 */
const seed = (records) => (env.apiMode === 'mock' ? records : []);
import { NOW, updateById, withTimestamp } from '../shared';

/**
 * Records shared between the customer site, the insurer portal and the admin
 * console: quote requests and insurer replies, policies, claim notifications,
 * NCD applications and inspections. Demo records are seeded so the portal is
 * never empty; they behave exactly like customer-submitted ones.
 */
export const createRecordsSlice = (set) => ({
  // ─── Replacing a collection wholesale ────────────────────
  // Used when the backend is the source of truth: a load answers with the
  // authoritative list, which replaces whatever the device was holding.
  setQuoteRequests: (quoteRequests) => set({ quoteRequests }),

  /**
   * Stores one request the server has just confirmed and opens it for
   * comparison. Replaces any earlier copy so a re-quote does not leave two
   * versions of the same id behind.
   */
  receiveQuoteRequest: (request) =>
    set((state) => ({
      quoteRequests: [request, ...state.quoteRequests.filter((item) => item.id !== request.id)],
      activeQuoteRequestId: request.id,
      requotedFromId: null,
    })),
  setPolicies: (policies) => set({ policies }),
  setClaims: (claims) => set({ claims }),
  setNcdApplications: (ncdApplications) => set({ ncdApplications }),
  setInspections: (inspections) => set({ inspections }),

  // ─── Quote requests and insurer replies ─────────────────
  quoteRequests: seed(SEED_QUOTE_REQUESTS),

  /** Insurer portal: attach a final quote to a request. The quote is valid for the insurer's configured number of days. */
  addInsurerQuote: (requestId, insurerName, quote) =>
    set((state) => {
      const insurer = state.insurersList.find((item) => item.name === insurerName);
      const validityDays = quote.validityDays || insurer?.quoteValidityDays || DEFAULT_QUOTE_VALIDITY_DAYS;
      const sentAt = NOW();
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
        return { ...request, insurerQuotes: { ...request.insurerQuotes, [insurerName]: { ...reply, validUntil: addDays(reply.validUntil, extraDays), extendedAt: NOW() } } };
      }),
    })),

  // ─── Policies ────────────────────────────────────────────
  // A policy is created when the customer pays and becomes Active only once
  // the insurer uploads the official certificate from its own system.
  policies: seed(SEED_POLICIES),
  addPolicy: (policy) =>
    set((state) =>
      state.policies.some((item) => item.policyNumber === policy.policyNumber)
        ? state
        : { policies: [{ ...policy, receivedAt: NOW(), status: policy.status || 'Active' }, ...state.policies] },
    ),
  issuePolicyCertificate: (policyNumber, { certificateDocument, insurerPolicyNumber }) =>
    set((state) => ({
      policies: state.policies.map((policy) => (policy.policyNumber === policyNumber ? {
        ...policy,
        status: 'Active',
        certificateDocument,
        insurerPolicyNumber: insurerPolicyNumber || policy.insurerPolicyNumber || policy.policyNumber,
        issuedAt: NOW(),
      } : policy)),
    })),

  // ─── Customer experience reviews ───────────────────────
  // One review per purchased policy. The user may amend their own review,
  // but cannot add duplicate ratings for the same policy.
  insurerReviews: seed(SEED_INSURER_REVIEWS),
  submitInsurerReview: ({ insurer, policyNumber, customerEmail, rating, comment = '' }) =>
    set((state) => {
      const safeRating = Math.max(1, Math.min(5, Number(rating) || 0));
      if (!insurer || !policyNumber || !customerEmail || !safeRating) return state;
      const existing = state.insurerReviews.find((review) => review.policyNumber === policyNumber && review.customerEmail === customerEmail);
      const review = {
        id: existing?.id || `REV-${Date.now().toString(36).toUpperCase()}`,
        insurer,
        policyNumber,
        customerEmail,
        rating: safeRating,
        comment: comment.trim().slice(0, 500),
        createdAt: existing?.createdAt || NOW(),
        updatedAt: NOW(),
      };
      return {
        insurerReviews: existing
          ? state.insurerReviews.map((item) => (item.id === existing.id ? review : item))
          : [review, ...state.insurerReviews],
      };
    }),

  // ─── Claims (first notification only) ───────────────────
  // InsurShield records the notification and issues a claim number. The
  // customer then calls the insurer, who handles assessment and settlement
  // outside the platform; the insurer marks the notification as received.
  claims: seed(SEED_CLAIMS),
  addClaim: (claim) =>
    set((state) => ({ claims: [{ ...claim, id: claim.claimNumber, status: 'Notified', submittedAt: NOW() }, ...state.claims] })),
  markClaimReceived: (claimId) =>
    set((state) => ({ claims: updateById(state.claims, claimId, (claim) => ({ ...claim, status: 'Received by insurer', receivedAt: NOW() })) })),

  // ─── NCD applications ────────────────────────────────────
  ncdApplications: seed(SEED_NCD_APPLICATIONS),
  addNcdApplication: (application) =>
    set((state) => ({
      ncdApplications: [
        { ...application, id: `NCDA-${Date.now()}`, applicationNumber: `NCD-${Math.random().toString(36).substring(2, 7).toUpperCase()}`, status: 'Submitted', submittedAt: NOW(), approvedCode: null },
        ...state.ncdApplications,
      ],
    })),
  updateNcdApplicationStatus: (applicationId, status, approvedCode) =>
    set((state) => ({
      ncdApplications: updateById(state.ncdApplications, applicationId, (application) =>
        withTimestamp({ ...application, status, approvedCode: approvedCode || application.approvedCode }),
      ),
    })),

  // ─── Inspections ─────────────────────────────────────────
  inspections: [],
  addInspection: (inspection) =>
    set((state) => ({ inspections: [{ ...inspection, id: `INS-${Date.now()}`, createdAt: NOW() }, ...state.inspections] })),
  updateInspectionStatus: (inspectionId, status, data) =>
    set((state) => ({ inspections: updateById(state.inspections, inspectionId, (inspection) => withTimestamp({ ...inspection, status, ...data })) })),
});
