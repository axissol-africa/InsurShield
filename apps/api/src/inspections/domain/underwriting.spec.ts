import { describe, expect, it } from 'vitest';
import { INSPECTION_STATUSES } from '../../common/domain/enums.js';
import { nextInspectionStatus, planInspections, type InspectedProduct } from './underwriting.js';

const product = (overrides: Partial<InspectedProduct>): InspectedProduct => ({
  productVersionId: 'pv',
  insurerId: 'insurer-a',
  inspectionRule: 'REQUIRED',
  inspectionTiming: 'BEFORE_PAYMENT',
  inspectionMethod: 'SELF_CAPTURE',
  ...overrides,
});

describe('planInspections', () => {
  it('gives one insurer one inspection, physical and before quotation when any product needs it', () => {
    expect(planInspections([
      product({ productVersionId: 'pv-1', inspectionMethod: 'SELF_CAPTURE', inspectionTiming: 'BEFORE_QUOTATION' }),
      product({ productVersionId: 'pv-2', inspectionMethod: 'PHYSICAL', inspectionTiming: 'BEFORE_PAYMENT' }),
    ])).toEqual([{ insurerId: 'insurer-a', method: 'PHYSICAL', stage: 'BEFORE_QUOTATION', productVersionIds: ['pv-1', 'pv-2'] }]);
  });

  it('keeps insurers apart and leaves after-payment, optional and unneeded rules out', () => {
    expect(planInspections([
      product({ productVersionId: 'pv-1' }),
      product({ productVersionId: 'pv-2', insurerId: 'insurer-b', inspectionMethod: 'PHYSICAL' }),
      product({ productVersionId: 'pv-3', inspectionTiming: 'AFTER_PAYMENT' }),
      product({ productVersionId: 'pv-4', inspectionRule: 'OPTIONAL', inspectionTiming: 'BEFORE_QUOTATION' }),
      product({ productVersionId: 'pv-5', inspectionRule: 'NOT_REQUIRED', inspectionTiming: null, inspectionMethod: null }),
    ])).toEqual([
      { insurerId: 'insurer-a', method: 'SELF_CAPTURE', stage: 'BEFORE_PAYMENT', productVersionIds: ['pv-1'] },
      { insurerId: 'insurer-b', method: 'PHYSICAL', stage: 'BEFORE_PAYMENT', productVersionIds: ['pv-2'] },
    ]);
  });
});

describe('nextInspectionStatus', () => {
  it('books, assigns and decides a physical inspection in order', () => {
    expect(nextInspectionStatus('REQUESTED', 'PHYSICAL', 'SCHEDULE')).toBe('SCHEDULED');
    expect(nextInspectionStatus('SCHEDULED', 'PHYSICAL', 'ASSIGN')).toBe('INSPECTOR_ASSIGNED');
    expect(nextInspectionStatus('REQUESTED', 'PHYSICAL', 'APPROVE')).toBeNull();
    expect(nextInspectionStatus('INSPECTOR_ASSIGNED', 'PHYSICAL', 'APPROVE')).toBe('APPROVED');
    expect(nextInspectionStatus('SCHEDULED', 'PHYSICAL', 'FAIL')).toBe('FAILED');
    expect(nextInspectionStatus('INSPECTOR_ASSIGNED', 'PHYSICAL', 'NO_SHOW')).toBe('NO_SHOW');
    expect(nextInspectionStatus('REQUESTED', 'PHYSICAL', 'NO_SHOW')).toBeNull();
  });

  it('decides a self-capture inspection from its photos without booking it', () => {
    expect(nextInspectionStatus('REQUESTED', 'SELF_CAPTURE', 'APPROVE')).toBe('APPROVED');
  });

  it('never moves a finished inspection', () => {
    for (const closed of ['APPROVED', 'FAILED', 'CANCELLED', 'NO_SHOW'] as const) {
      for (const event of ['SCHEDULE', 'ASSIGN', 'APPROVE', 'FAIL', 'NO_SHOW', 'CANCEL'] as const) {
        expect(nextInspectionStatus(closed, 'PHYSICAL', event)).toBeNull();
      }
    }
  });

  it('lets any open inspection be cancelled', () => {
    const open = INSPECTION_STATUSES.filter((status) => !['APPROVED', 'FAILED', 'CANCELLED', 'NO_SHOW'].includes(status));
    for (const status of open) expect(nextInspectionStatus(status, 'PHYSICAL', 'CANCEL')).toBe('CANCELLED');
  });
});
