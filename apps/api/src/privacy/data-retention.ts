import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../common/audit/audit.service.js';
import { systemActor } from '../common/audit/audit.types.js';
import { DOCUMENT_RETENTION_CLASSES, type DocumentRetentionClass } from '../common/domain/enums.js';
import { lusakaDay } from '../common/domain/lusaka.js';
import { JobsRepository } from '../jobs/jobs.repository.js';
import { SettingsService } from '../settings/settings.service.js';
import { StorageService } from '../storage/storage.service.js';
import { PrivacyRepository } from './privacy.repository.js';

export const DATA_RETENTION = 'privacy.data-retention';
const DAY_MS = 86_400_000;
/** How much one run takes on; a full batch queues the next run straight away. */
export const RETENTION_BATCH = 500;

/** One run a Lusaka day, so a restart cannot queue it twice. */
export function dataRetentionKey(at: Date): string {
  return lusakaDay(at);
}

export interface RetentionOutcome {
  documentsDeleted: Partial<Record<DocumentRetentionClass, number>>;
  documentsFailed: number;
  accountsAnonymised: number;
}

/**
 * Applies the retention settings (rule 6 of the batch 15 plan): deletes the
 * stored file of each document whose class period has passed and that nothing
 * still needs, and replaces the identity of accounts closed longer than
 * ACCOUNT_RETENTION. Each run is audited with counts, never content.
 */
@Injectable()
export class DataRetention {
  private readonly logger = new Logger(DataRetention.name);

  constructor(
    private readonly repository: PrivacyRepository,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
    private readonly jobs: JobsRepository,
    private readonly audit: AuditService,
  ) {}

  async schedule(at: Date, key = dataRetentionKey(at)): Promise<void> {
    await this.jobs.transaction((tx) => this.jobs.enqueue(tx, { kind: DATA_RETENTION, key, payload: {}, runAfter: at }));
  }

  async run(now = new Date()): Promise<RetentionOutcome> {
    await this.schedule(new Date(now.getTime() + DAY_MS));
    const outcome: RetentionOutcome = { documentsDeleted: {}, documentsFailed: 0, accountsAnonymised: 0 };
    let full = false;

    const { value: retention } = await this.settings.effective('DOCUMENT_RETENTION', now);
    for (const retentionClass of DOCUMENT_RETENTION_CLASSES) {
      const cutoff = new Date(now.getTime() - retention.daysByClass[retentionClass] * DAY_MS);
      const expired = await this.repository.expiredDocuments(retentionClass, cutoff, RETENTION_BATCH);
      full ||= expired.length === RETENTION_BATCH;
      for (const document of expired) {
        try {
          // The file goes first: a row marked deleted over a file still stored would hide it from every later run.
          await this.storage.delete(document.storageKey);
          if (await this.repository.markDeleted(document.id, now)) {
            outcome.documentsDeleted[retentionClass] = (outcome.documentsDeleted[retentionClass] ?? 0) + 1;
          }
        } catch (error: unknown) {
          outcome.documentsFailed += 1;
          this.logger.error(`Could not delete document ${document.id}: ${String(error)}`);
        }
      }
    }

    const { value: accounts } = await this.settings.effective('ACCOUNT_RETENTION', now);
    const closedBefore = new Date(now.getTime() - accounts.daysAfterClosure * DAY_MS);
    const due = await this.repository.accountsDueForAnonymising(closedBefore, RETENTION_BATCH);
    full ||= due.length === RETENTION_BATCH;
    for (const { id } of due) {
      if (await this.repository.transaction((tx) => this.repository.anonymise(tx, id, closedBefore, now))) outcome.accountsAnonymised += 1;
    }

    const deleted = Object.values(outcome.documentsDeleted).reduce((sum, count) => sum + count, 0);
    if (deleted > 0 || outcome.documentsFailed > 0 || outcome.accountsAnonymised > 0) {
      await this.repository.transaction((tx) =>
        this.audit.write(tx, {
          actor: systemActor,
          action: 'data_retention.applied',
          entityType: 'DATA_RETENTION',
          entityId: dataRetentionKey(now),
          after: { ...outcome },
          note: 'Retention settings applied: files past their period deleted, closed accounts past ACCOUNT_RETENTION anonymised.',
          correlationId: dataRetentionKey(now),
        }),
      );
      this.logger.log(`Retention applied: ${deleted} documents deleted, ${outcome.documentsFailed} failed, ${outcome.accountsAnonymised} accounts anonymised`);
    }
    // More is waiting: a run of its own straight away, keyed apart from today's.
    if (full) await this.schedule(now, `${dataRetentionKey(now)}:${now.getTime()}`);
    return outcome;
  }
}
