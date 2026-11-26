export type ContentType = 'FAQ' | 'NOTICE' | 'LEGAL';
export type ContentStatus = 'DRAFT' | 'APPROVED' | 'WITHDRAWN';
export interface PublicationVersion {
  slug: string;
  version: number;
  status: ContentStatus;
  effectiveFrom: string;
  expiresOn: string | null;
  approvedAt: Date | null;
}

/** Select before checking expiry: a retired version never revives older wording. */
export function publishedVersions<T extends PublicationVersion>(versions: T[], day: string): T[] {
  const latest = new Map<string, T>();
  for (const row of versions) {
    if (!row.approvedAt || (row.status !== 'WITHDRAWN' && row.effectiveFrom > day)) continue;
    if ((latest.get(row.slug)?.version ?? 0) < row.version) latest.set(row.slug, row);
  }
  return [...latest.values()].filter(row => row.status === 'APPROVED' && (!row.expiresOn || row.expiresOn >= day));
}

export function transitionAllowed(status: ContentStatus, action: 'approve' | 'withdraw'): boolean {
  return action === 'approve' ? status === 'DRAFT' : status !== 'WITHDRAWN';
}

export function plainText(value: string): boolean {
  if (!value.trim() || /<\/?[a-z][^>]*>/i.test(value)) return false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127) return false;
  }
  return true;
}
