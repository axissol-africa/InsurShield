import type { InspectionMethod, InspectionRule, InspectionStatus, InspectionTiming } from '../../common/domain/enums.js';

/** A chosen product as the inspection rules see it. */
export interface InspectedProduct {
  productVersionId: string;
  insurerId: string;
  inspectionRule: InspectionRule;
  inspectionTiming: InspectionTiming | null;
  inspectionMethod: InspectionMethod | null;
}

export interface PlannedInspection {
  insurerId: string;
  method: InspectionMethod;
  stage: InspectionTiming;
  productVersionIds: string[];
}

/**
 * One inspection per insurer serves every one of its chosen products whose
 * rule needs an inspection before quotation or before payment. A physical
 * inspection meets a self-capture rule, and one before quotation also meets
 * a before-payment rule, so the group takes the stronger of each. Rules after
 * payment are inspected later, on their own (batch 16), and optional rules
 * only when the insurer asks.
 */
export function planInspections(products: readonly InspectedProduct[]): PlannedInspection[] {
  const byInsurer = new Map<string, InspectedProduct[]>();
  for (const product of products) {
    const blocking = product.inspectionRule === 'REQUIRED'
      && (product.inspectionTiming === 'BEFORE_QUOTATION' || product.inspectionTiming === 'BEFORE_PAYMENT');
    if (!blocking) continue;
    byInsurer.set(product.insurerId, [...(byInsurer.get(product.insurerId) ?? []), product]);
  }
  return [...byInsurer.entries()].map(([insurerId, served]) => ({
    insurerId,
    method: served.some((product) => product.inspectionMethod === 'PHYSICAL') ? 'PHYSICAL' : 'SELF_CAPTURE',
    stage: served.some((product) => product.inspectionTiming === 'BEFORE_QUOTATION') ? 'BEFORE_QUOTATION' : 'BEFORE_PAYMENT',
    productVersionIds: served.map((product) => product.productVersionId),
  }));
}

export type InspectionEvent = 'SCHEDULE' | 'ASSIGN' | 'APPROVE' | 'FAIL' | 'NO_SHOW' | 'CANCEL';

/** Finished either way; a successor is a new inspection, never a reopened one. */
export const CLOSED_INSPECTION_STATUSES = ['APPROVED', 'FAILED', 'CANCELLED', 'NO_SHOW'] as const satisfies readonly InspectionStatus[];
export const isOpenInspection = (status: InspectionStatus) =>
  !(CLOSED_INSPECTION_STATUSES as readonly InspectionStatus[]).includes(status);

const DECIDABLE: readonly InspectionStatus[] = ['SCHEDULED', 'INSPECTOR_ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'REPORT_READY'];

/**
 * Where `event` takes an inspection, or null when it may not happen now. A
 * physical inspection is decided only once it has been booked; a self-capture
 * one can be decided from the photos as soon as it is requested.
 */
export function nextInspectionStatus(
  current: InspectionStatus,
  method: InspectionMethod | null,
  event: InspectionEvent,
): InspectionStatus | null {
  if (!isOpenInspection(current)) return null;
  switch (event) {
    case 'SCHEDULE':
      return current === 'REQUESTED' || current === 'SCHEDULED' ? 'SCHEDULED' : null;
    case 'ASSIGN':
      return current === 'SCHEDULED' || current === 'INSPECTOR_ASSIGNED' ? 'INSPECTOR_ASSIGNED' : null;
    case 'APPROVE':
    case 'FAIL': {
      const decidable = DECIDABLE.includes(current) || (method === 'SELF_CAPTURE' && current === 'REQUESTED');
      if (!decidable) return null;
      return event === 'APPROVE' ? 'APPROVED' : 'FAILED';
    }
    case 'NO_SHOW':
      return current === 'SCHEDULED' || current === 'INSPECTOR_ASSIGNED' ? 'NO_SHOW' : null;
    case 'CANCEL':
      return 'CANCELLED';
  }
}
