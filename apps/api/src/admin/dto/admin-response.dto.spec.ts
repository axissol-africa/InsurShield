import { describe, expect, it } from 'vitest';
import type { CustomerMatch } from '../admin.repository.js';
import { toCustomerLookupResponse } from './admin-response.dto.js';

const customer = (phone: string) =>
  ({
    id: 'c1',
    fullName: 'Chanda Mwale',
    email: 'chanda@example.invalid',
    phone,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    quoteRequests: 0,
    policies: 0,
    claims: 0,
  }) as unknown as CustomerMatch;

const consent = { privacyVersion: 'v1', acceptedAt: new Date('2026-10-01T00:00:00Z') };

describe('the admin customer view', () => {
  it('shows no phone for an old pending: placeholder', () => {
    expect(toCustomerLookupResponse(customer('pending:7f3a'), consent).phone).toBeNull();
  });

  it('shows a real phone as stored', () => {
    expect(toCustomerLookupResponse(customer('+260971000000'), consent).phone).toBe('+260971000000');
  });
});
