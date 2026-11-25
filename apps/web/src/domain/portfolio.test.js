import { describe, expect, it } from 'vitest';
import { matchesSearch, policyMatches, requestFilterOf, requestInFilter, requestMatches } from './portfolio';

const NOW = new Date('2026-11-25T10:00:00.000Z');

describe('portfolio search', () => {
  it('matches any remembered word, ignoring case and spaces in a plate', () => {
    const policy = { policyNumber: 'POL-7Q2', insurer: 'Prestige Assurance', vehicle: '2021 Toyota Corolla', vehicleDetails: { plateNumber: 'BAP 1415' } };
    expect(policyMatches(policy, 'prestige')).toBe(true);
    expect(policyMatches(policy, 'bap1415')).toBe(true);
    expect(policyMatches(policy, 'pol-7q2')).toBe(true);
    expect(policyMatches(policy, 'madison')).toBe(false);
    expect(matchesSearch('  ', ['anything'])).toBe(true);
  });

  it('finds a request by its reference or a chosen product', () => {
    const request = { id: 'QR-55', vehicle: 'Hilux', selectedProducts: [{ insurerName: 'Madison General', productName: 'Motor Plus' }] };
    expect(requestMatches(request, 'qr-55')).toBe(true);
    expect(requestMatches(request, 'motor plus')).toBe(true);
    expect(requestMatches(request, 'prestige')).toBe(false);
  });
});

describe('request filters', () => {
  const future = '2026-12-20T10:00:00.000Z';
  it('puts each request under one filter', () => {
    expect(requestFilterOf({ status: 'Submitted', expiresAt: future, insurerQuotes: {} }, NOW)).toBe('waiting');
    expect(requestFilterOf({ status: 'Quoted', expiresAt: future, insurerQuotes: { A: { quotedAt: '2026-11-24T10:00:00.000Z', validUntil: future } } }, NOW)).toBe('quoted');
    expect(requestFilterOf({ status: 'Expired', expiresAt: '2026-11-01T10:00:00.000Z' }, NOW)).toBe('expired');
  });

  it('lets everything through under All', () => {
    expect(requestInFilter({ status: 'Expired' }, 'all', NOW)).toBe(true);
    expect(requestInFilter({ status: 'Expired' }, 'waiting', NOW)).toBe(false);
  });
});
