import type { InspectionStatus } from '../../common/domain/enums.js';

/** Once an inspector is on the job the appointment is no longer the customer's to move. */
export const CUSTOMER_EDITABLE_STATUSES = ['REQUESTED', 'SCHEDULED'] as const satisfies readonly InspectionStatus[];

export const isCustomerEditable = (status: InspectionStatus) =>
  (CUSTOMER_EDITABLE_STATUSES as readonly InspectionStatus[]).includes(status);
