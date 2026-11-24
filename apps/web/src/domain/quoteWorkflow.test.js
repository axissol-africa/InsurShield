import { describe, expect, it } from 'vitest';
import { canAskCustomer, canDecline, canQuote, CUSTOMER_STATUS_LABELS, endedWithoutQuote, openQuestion, PORTAL_STATUS_LABELS } from './quoteWorkflow';

const STATES = ['SUBMITTED', 'INSURER_PROCESSING', 'VERIFICATION_REQUIRED', 'INSPECTION_REQUIRED', 'QUOTED', 'DECLINED', 'TIMED_OUT', 'EXPIRED', 'CANCELLED', 'MANUAL_REVIEW'];

describe('quote workflow wording', () => {
  it('words every state for the customer and for the insurer', () => {
    for (const state of STATES) {
      expect(CUSTOMER_STATUS_LABELS[state]).toMatch(/\w/);
      expect(PORTAL_STATUS_LABELS[state]).toMatch(/\w/);
    }
  });

  it('allows a quote only where the API does, and for a product from before the workflow', () => {
    expect(STATES.filter(canQuote)).toEqual(['SUBMITTED', 'INSURER_PROCESSING', 'VERIFICATION_REQUIRED']);
    expect(canQuote(undefined)).toBe(true);
  });

  it('allows a decline from every open state and a question only before one is pending', () => {
    expect(STATES.filter(canDecline)).toEqual(['SUBMITTED', 'INSURER_PROCESSING', 'VERIFICATION_REQUIRED', 'INSPECTION_REQUIRED']);
    expect(STATES.filter(canAskCustomer)).toEqual(['SUBMITTED', 'INSURER_PROCESSING']);
  });

  it('treats a decline, a missed deadline and a cancellation as ending without a quote', () => {
    expect(STATES.filter(endedWithoutQuote)).toEqual(['DECLINED', 'TIMED_OUT', 'CANCELLED']);
  });

  it('finds the open question only while the insurer is waiting for it', () => {
    const asked = { id: 'q1', message: 'Odometer?', open: true };
    expect(openQuestion({ status: 'VERIFICATION_REQUIRED', informationRequests: [asked] })).toBe(asked);
    expect(openQuestion({ status: 'INSURER_PROCESSING', informationRequests: [asked] })).toBeNull();
    expect(openQuestion({ status: 'VERIFICATION_REQUIRED', informationRequests: [{ ...asked, open: false }] })).toBeNull();
  });
});
