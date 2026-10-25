import { INSPECTION_STATUSES } from '../../common/domain/enums.js';
import { isCustomerEditable } from './inspection.js';

describe('isCustomerEditable', () => {
  it('lets the customer change an inspection only before an inspector is assigned', () => {
    const editable = INSPECTION_STATUSES.filter(isCustomerEditable);

    expect(editable).toEqual(['REQUESTED', 'SCHEDULED']);
  });
});
