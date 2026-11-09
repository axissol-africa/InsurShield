import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Counts the download links signed while serving one request.
 *
 * A list response embeds a link for every document it carries, so auditing each
 * one would bury the trail it is meant to provide. One entry per response,
 * carrying how many links were issued and of what kinds, still answers the
 * question that matters — who pulled four hundred links in an hour — without a
 * row per document.
 */
export interface LinkIssueLog {
  kinds: Map<string, number>;
}

const storage = new AsyncLocalStorage<LinkIssueLog>();

export function withLinkIssueLog<T>(work: (log: LinkIssueLog) => T): T {
  return storage.run({ kinds: new Map() }, () => work(storage.getStore() as LinkIssueLog));
}

/** Called where a link is signed. Outside a request-scoped log this does nothing. */
export function noteLinkIssued(kind: string): void {
  const log = storage.getStore();
  if (!log) return;
  log.kinds.set(kind, (log.kinds.get(kind) ?? 0) + 1);
}

/** The audit payload for a finished request, or null when it issued no links. */
export function summarise(log: LinkIssueLog): { count: number; kinds: string[] } | null {
  if (log.kinds.size === 0) return null;
  let count = 0;
  for (const issued of log.kinds.values()) count += issued;
  return { count, kinds: [...log.kinds.keys()].sort() };
}
