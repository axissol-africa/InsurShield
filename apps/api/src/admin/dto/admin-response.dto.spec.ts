import { describe, expect, it } from 'vitest';
import type { AuditLogRow, CustomerMatch } from '../admin.repository.js';
import { toAuditLogResponse, toCustomerLookupResponse } from './admin-response.dto.js';

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

describe('the admin audit reader', () => {
  it('shows only changed field names, never raw audit values', () => {
    const entry = {
      id: 'audit-1', actorType: 'STAFF', action: 'insurer.updated', entityType: 'INSURER', entityId: 'insurer-1',
      note: 'Updated insurer.', correlationId: null, createdAt: new Date('2026-11-06T10:00:00Z'),
      before: { rateBps: 400, email: 'old@example.invalid' },
      after: { rateBps: 500, email: 'new@example.invalid' },
    } as unknown as AuditLogRow;

    expect(toAuditLogResponse(entry)).toEqual({
      id: 'audit-1', actorType: 'STAFF', action: 'insurer.updated', entityType: 'INSURER', entityId: 'insurer-1',
      note: 'Updated insurer.', correlationId: null, changedFields: ['email', 'rateBps'], createdAt: '2026-11-06T10:00:00.000Z',
    });
  });
});
