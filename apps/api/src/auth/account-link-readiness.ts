export interface MissingAccountLinks {
  customers: number;
  staffUsers: number;
}

/** Whether a deployment may safely make the Better Auth links non-null. */
export function accountLinksReady(counts: MissingAccountLinks): boolean {
  return counts.customers === 0 && counts.staffUsers === 0;
}

/** Kept free of identifiers so the operational check can be safely logged. */
export function accountLinkReadinessMessage(counts: MissingAccountLinks): string {
  if (accountLinksReady(counts)) {
    return 'Every customer and staff record has a Better Auth user link. The narrowing migration may be scheduled.';
  }
  return `Cannot narrow Better Auth account links: ${counts.customers} customer record(s) and ${counts.staffUsers} staff record(s) still lack userId.`;
}
