/**
 * Where one chosen product stands with its insurer. The API owns the states
 * and their transitions (apps/api/src/customer/domain/quote-workflow.ts);
 * this module only words them for each audience.
 */

/** What the customer reads for each state. Matches the API's own labels. */
export const CUSTOMER_STATUS_LABELS = {
  SUBMITTED: 'Waiting for the insurer',
  INSURER_PROCESSING: 'The insurer is working on it',
  VERIFICATION_REQUIRED: 'The insurer needs more information',
  INSPECTION_REQUIRED: 'Inspection needed, the insurer will contact you',
  QUOTED: 'Quote ready',
  DECLINED: 'Declined',
  TIMED_OUT: 'The insurer did not respond in time',
  EXPIRED: 'Quote expired',
  CANCELLED: 'Cancelled',
  MANUAL_REVIEW: 'Under review',
};

/** What the insurer's own staff read for each state, in their queue. */
export const PORTAL_STATUS_LABELS = {
  SUBMITTED: 'New',
  INSURER_PROCESSING: 'In progress',
  VERIFICATION_REQUIRED: 'Waiting for the customer',
  INSPECTION_REQUIRED: 'Inspection needed',
  QUOTED: 'Quoted',
  DECLINED: 'Declined',
  TIMED_OUT: 'Reply deadline passed',
  EXPIRED: 'Quote expired',
  CANCELLED: 'Cancelled',
  MANUAL_REVIEW: 'Under review',
};

/** States that ended without a quote the customer could pay. */
const CLOSED_WITHOUT_QUOTE = ['DECLINED', 'TIMED_OUT', 'CANCELLED'];
export const endedWithoutQuote = (status) => CLOSED_WITHOUT_QUOTE.includes(status);

/** States in which the insurer can still send a quote. */
const QUOTABLE = ['SUBMITTED', 'INSURER_PROCESSING', 'VERIFICATION_REQUIRED'];
/** A product with no recorded state predates the workflow and is quotable as before. */
export const canQuote = (status) => !status || QUOTABLE.includes(status);

/** States the insurer may still decline from. */
const DECLINABLE = ['SUBMITTED', 'INSURER_PROCESSING', 'VERIFICATION_REQUIRED', 'INSPECTION_REQUIRED'];
export const canDecline = (status) => DECLINABLE.includes(status);

/** States from which the insurer may ask the customer a question. */
export const canAskCustomer = (status) => status === 'SUBMITTED' || status === 'INSURER_PROCESSING';

/** The customer's open question on a product, if the insurer is waiting for an answer. */
export const openQuestion = (product) =>
  (product?.status === 'VERIFICATION_REQUIRED' && product.informationRequests?.find((asked) => asked.open)) || null;

/**
 * The approved decline reasons the browser-only prototype offers. The API
 * reads its list from the QUOTE_DECLINE_REASONS rule, which compliance owns.
 */
export const PROTOTYPE_DECLINE_REASONS = [
  {
    code: 'OUTSIDE_APPETITE',
    customerText: 'This insurer does not offer this cover for your vehicle at the moment.',
    internalText: "Risk is outside the insurer's underwriting appetite.",
  },
  {
    code: 'VEHICLE_NOT_ELIGIBLE',
    customerText: "Your vehicle does not meet this product's eligibility rules.",
    internalText: 'Vehicle fails the product eligibility rules (age, value, use or type).',
  },
  {
    code: 'INFORMATION_NOT_PROVIDED',
    customerText: 'The insurer could not quote without the information it asked for.',
    internalText: 'Customer did not provide the requested information.',
  },
  {
    code: 'INSPECTION_FAILED',
    customerText: "The vehicle did not pass the insurer's inspection.",
    internalText: 'Vehicle failed the underwriting inspection.',
  },
  {
    code: 'OTHER',
    customerText: 'The insurer is unable to quote for this request.',
    internalText: 'Other reason; see the internal note.',
  },
];
