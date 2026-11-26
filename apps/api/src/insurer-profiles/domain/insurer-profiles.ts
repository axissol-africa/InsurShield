export type ProfileRevisionStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED';
export function canDecideProfile(status: ProfileRevisionStatus): boolean {
  return status === 'PENDING';
}
