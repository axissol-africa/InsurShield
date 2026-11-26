import type { DocumentRecord } from '../../documents/documents.service.js';

export interface ClaimTimelineUpdate {
  id: string;
  status: string;
  actorKind: 'CUSTOMER' | 'INSURER';
  message: string;
  evidenceRequest: string | null;
  createdAt: string;
  documents: DocumentRecord[];
}

export interface ClaimTimeline {
  claimNumber: string;
  revision: string;
  status: string;
  responseDueOn: string | null;
  lateSubmission: boolean;
  insurerClaimReference: string | null;
  updates: ClaimTimelineUpdate[];
}
