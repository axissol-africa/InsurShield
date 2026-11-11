import type { EvidenceKind, EvidenceReviewState } from '../../common/domain/enums.js';
import { currentOn } from '../../common/domain/lusaka.js';

/**
 * What an insurer must have on file before it may trade.
 *
 * US-ADM-002 asks that activation be refused while evidence is incomplete,
 * expired or unapproved, and that the refusal say which. So this answers with
 * every reason rather than the first one found: an administrator chasing one
 * missing document at a time learns nothing about the next.
 */

/**
 * The kinds an insurer cannot trade without. Only the licence, because that is
 * the one US-ADM-002 and FR-ADM-007 tie to trading; the rest are captured and
 * reviewed, and are blocking only once somebody adds them here. Whether Zambian
 * practice demands tax clearance and incorporation papers too is a question for
 * the business, and this is the one line that answers it.
 */
export const REQUIRED_EVIDENCE = ['LICENCE'] as const satisfies readonly EvidenceKind[];

export interface EvidenceOnFile {
  kind: EvidenceKind;
  state: EvidenceReviewState;
  /** A date-only expiry, or null for a document that does not lapse. */
  expiresAt: Date | null;
}

export type ActivationBlock =
  | { reason: 'MISSING'; kind: EvidenceKind }
  | { reason: 'UNAPPROVED'; kind: EvidenceKind }
  | { reason: 'EXPIRED'; kind: EvidenceKind };

/** Every reason this insurer may not be activated yet, or an empty list. */
export function activationBlocks(evidence: readonly EvidenceOnFile[], now: Date): ActivationBlock[] {
  const blocks: ActivationBlock[] = [];

  for (const kind of REQUIRED_EVIDENCE) {
    if (!evidence.some((piece) => piece.kind === kind)) blocks.push({ reason: 'MISSING', kind });
  }
  // Anything on file has to be in order, not only the required kinds: an
  // insurer that volunteered a lapsed tax clearance has a lapsed document.
  for (const piece of evidence) {
    if (piece.state !== 'APPROVED') blocks.push({ reason: 'UNAPPROVED', kind: piece.kind });
    else if (!currentOn(piece.expiresAt, now)) blocks.push({ reason: 'EXPIRED', kind: piece.kind });
  }
  return blocks;
}

/** What an administrator is told, naming each reason once. */
export function describeBlocks(blocks: readonly ActivationBlock[]): string {
  const say = (block: ActivationBlock) =>
    block.reason === 'MISSING'
      ? `no ${label(block.kind)} on file`
      : block.reason === 'EXPIRED'
        ? `an expired ${label(block.kind)}`
        : `an unapproved ${label(block.kind)}`;
  return [...new Set(blocks.map(say))].join(', ');
}

const LABELS: Record<EvidenceKind, string> = {
  LICENCE: 'licence',
  TAX_CLEARANCE: 'tax clearance',
  INCORPORATION: 'certificate of incorporation',
  AGREEMENT: 'agreement',
  OTHER: 'supporting document',
};

function label(kind: EvidenceKind): string {
  return LABELS[kind];
}
