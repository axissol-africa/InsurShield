import { Injectable } from '@nestjs/common';
import { AuditService } from '../common/audit/audit.service.js';
import { systemActor } from '../common/audit/audit.types.js';
import { lusakaDay } from '../common/domain/lusaka.js';
import { JobsRepository } from '../jobs/jobs.repository.js';
import { SettingsService } from '../settings/settings.service.js';
import { StorageService } from '../storage/storage.service.js';
import { RetentionRepository } from './retention.repository.js';

export const RETENTION_SWEEP = 'retention.sweep';
const DAY_MS = 86_400_000;

@Injectable()
export class RetentionService {
  constructor(
    private readonly repository: RetentionRepository,
    private readonly jobs: JobsRepository,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async schedule(at: Date): Promise<void> {
    await this.jobs.transaction((tx) =>
      this.jobs.enqueue(tx, {
        kind: RETENTION_SWEEP,
        key: lusakaDay(at),
        payload: {},
        runAfter: at,
      }),
    );
  }

  async run(now = new Date()): Promise<void> {
    await this.schedule(new Date(now.getTime() + DAY_MS));
    const { value: documentRule } = await this.settings.effective(
      'DOCUMENT_RETENTION',
      now,
    );
    const { value: accountRule } = await this.settings.effective(
      'ACCOUNT_RETENTION',
      now,
    );
    const candidates = await this.repository.documentCandidates(
      documentRule.daysByClass,
      now,
    );
    let failures = 0;
    for (const candidate of candidates) {
      try {
        const document = await this.repository.transaction((tx) =>
          this.repository.claimDocument(
            tx,
            candidate.id,
            documentRule.daysByClass,
            now,
          ),
        );
        if (!document) continue;
        // The committed intent fences new references/holds and survives a process crash.
        // S3 DeleteObject is idempotent, including a retry after deletion but before completion.
        await this.storage.delete(document.storageKey);
        await this.repository.transaction(async (tx) => {
          if (!(await this.repository.finishDocument(tx, document.id, now)))
            return;
          await this.audit.write(tx, {
            actor: systemActor,
            action: 'document.retention_deleted',
            entityType: 'DOCUMENT',
            entityId: document.id,
            after: { count: 1 },
          });
        });
      } catch {
        failures += 1;
      }
    }
    const cutoff = new Date(
      now.getTime() - accountRule.daysAfterClosure * DAY_MS,
    );
    for (const customer of await this.repository.accountCandidates(cutoff)) {
      try {
        await this.repository.transaction(async (tx) => {
          if (!(await this.repository.anonymise(tx, customer.id, cutoff, now)))
            return;
          await this.audit.write(tx, {
            actor: systemActor,
            action: 'customer.anonymised',
            entityType: 'CUSTOMER',
            entityId: customer.id,
            after: { count: 1 },
          });
        });
      } catch {
        failures += 1;
      }
    }
    const reviewRule = await this.settings.effective('REVIEW_POLICY', now);
    if (!reviewRule.provisional) {
      for (const review of await this.repository.reviewCandidates(now, reviewRule.value.privateRetentionDays, reviewRule.value.appealDays)) {
        try {
          await this.repository.transaction(async (tx) => {
            const active = await this.settings.effective('REVIEW_POLICY', now, tx);
            if (active.provisional) return;
            const counts = await this.repository.purgeReview(tx, review.id, now, active.value.privateRetentionDays, active.value.appealDays);
            if (counts.revisions + counts.appeals === 0) return;
            await this.audit.write(tx, { actor: systemActor, action: 'review.private_content_purged', entityType: 'REVIEW', entityId: review.id, after: counts });
          });
        } catch {
          failures += 1;
        }
      }
    }
    if (failures > 0)
      throw new Error(
        `Retention sweep has ${failures} incomplete operations; retry required.`,
      );
  }
}
