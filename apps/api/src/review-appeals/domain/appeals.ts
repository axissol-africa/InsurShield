import { lusakaDay } from '../../common/domain/lusaka.js';

export function deadline(moment: Date, days: number): string {
  const day = new Date(`${lusakaDay(moment)}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

export function appealAllowed(party: 'CUSTOMER' | 'INSURER', kind: 'REVIEW' | 'RESPONSE', action: 'PUBLISH' | 'REJECT' | 'REMOVE' | 'REINSTATE'): boolean {
  const adverse = action === 'REJECT' || action === 'REMOVE';
  return party === 'CUSTOMER' ? kind === 'REVIEW' && adverse : kind === 'REVIEW' ? !adverse : adverse;
}

export function inverse(action: 'PUBLISH' | 'REJECT' | 'REMOVE' | 'REINSTATE') {
  return action === 'PUBLISH' || action === 'REINSTATE' ? 'REMOVE' as const : 'REINSTATE' as const;
}
