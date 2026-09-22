import { describe, expect, it } from 'vitest';
import { isOpenNcdApplication, pageSlice, statusStyle, toPortalRequest } from './portal';

describe('toPortalRequest', () => {
  const request = {
    id: 'QR-1', submittedAt: new Date().toISOString(), customer: { fullName: 'Mwiza Banda', phone: '0970123456' },
    vehicle: '2020 Toyota Hilux', vehicleDetails: { plateNumber: 'BAA 1234' }, vehicleValue: 250000, vehicleUsage: 'Individual',
    insuranceType: 'ThirdParty', coverageDurationId: '4q', policyDates: null, inspectionShots: ['insp_front', 'insp_rear'],
    insurerQuotes: { 'Prestige Assurance': { premium: 10900 } },
  };

  it('formats the request for display and picks out this insurer’s reply', () => {
    const portal = toPortalRequest(request, 'Prestige Assurance');
    expect(portal).toMatchObject({ value: 'ZMW 250,000.00', coverage: 'Third Party Only', client: 'Mwiza Banda', contact: '0970123456', period: '1 Year (12 Months)', dates: 'From payment date', plate: 'BAA 1234', photos: 2, time: 'just now' });
    expect(portal.reply).toEqual({ premium: 10900 });
    expect(toPortalRequest(request, 'Global Guard Insurance').reply).toBeNull();
  });

  it('has sensible fallbacks for sparse records', () => {
    const portal = toPortalRequest({ id: 'QR-2', insurers: [] }, 'Prestige Assurance');
    expect(portal).toMatchObject({ vehicle: 'Vehicle pending', value: 'ZMW 0.00', usage: 'Private', coverage: 'Comprehensive', client: 'Customer', contact: '', period: '—', plate: '', photos: 0, reply: null });
  });
});

describe('portal helpers', () => {
  it('treats submitted and under-review NCD applications as open', () => {
    expect(isOpenNcdApplication({ status: 'Submitted' })).toBe(true);
    expect(isOpenNcdApplication({ status: 'Under Review' })).toBe(true);
    expect(isOpenNcdApplication({ status: 'Approved' })).toBe(false);
  });

  it('pages a list and styles unknown statuses neutrally', () => {
    expect(pageSlice([1, 2, 3, 4, 5], 2, 2)).toEqual([3, 4]);
    expect(pageSlice([1, 2], 3, 2)).toEqual([]);
    expect(statusStyle('Notified').dot).toBe('bg-primary');
    expect(statusStyle('Whatever').badge).toContain('bg-gray-100');
  });
});
