/** Steps of the quote-to-policy journey, in order. */
export const JOURNEY_STEPS = [
  { short: 'Cover', label: 'Coverage type' },
  { short: 'Vehicle', label: 'Vehicle details' },
  { short: 'Usage', label: 'Vehicle use' },
  { short: 'Request', label: 'Request quotes' },
  { short: 'Compare', label: 'Compare quotes' },
  { short: 'Pay', label: 'Payment' },
];

/** Pass as `current` to render every step as complete. */
export const JOURNEY_COMPLETE = JOURNEY_STEPS.length + 1;
