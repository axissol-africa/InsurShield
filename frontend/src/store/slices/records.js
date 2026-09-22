import { DEFAULT_QUOTE_VALIDITY_DAYS, addDays } from '@/domain/quoteValidity';
import { SEED_CLAIMS, SEED_NCD_APPLICATIONS, SEED_POLICIES, SEED_QUOTE_REQUESTS } from '../demoSeed';
import { NOW, updateById, withTimestamp } from '../shared';

/**
 * Records shared between the customer site, the insurer portal and the admin
 * console: quote requests and insurer replies, policies, claim notifications,
 * NCD applications and inspections. Demo records are seeded so the portal is
 * never empty; they behave exactly like customer-submitted ones.
 */
export const createRecordsSlice = (set) => ({
  // ─── Quote requests and insurer replies ─────────────────
  quoteRequests: SEED_QUOTE_REQUESTS,

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
  policies: SEED_POLICIES,
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

  // ─── Claims (first notification only) ───────────────────
  // InsurShield records the notification and issues a claim number. The
  // customer then calls the insurer, who handles assessment and settlement
  // outside the platform; the insurer marks the notification as received.
  claims: SEED_CLAIMS,
  addClaim: (claim) =>
    set((state) => ({ claims: [{ ...claim, id: claim.claimNumber, status: 'Notified', submittedAt: NOW() }, ...state.claims] })),
  markClaimReceived: (claimId) =>
    set((state) => ({ claims: updateById(state.claims, claimId, (claim) => ({ ...claim, status: 'Received by insurer', receivedAt: NOW() })) })),

  // ─── NCD applications ────────────────────────────────────
  ncdApplications: SEED_NCD_APPLICATIONS,
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
