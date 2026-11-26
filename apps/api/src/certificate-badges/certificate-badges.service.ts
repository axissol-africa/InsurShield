import { Injectable } from '@nestjs/common';
import { AuditService } from '../common/audit/audit.service.js';
import { auditActor, systemActor } from '../common/audit/audit.types.js';
import type { Principal } from '../common/auth/auth.types.js';
import { holds } from '../common/auth/permissions.js';
import { lusakaDay } from '../common/domain/lusaka.js';
import { ApiException } from '../common/errors/api.exception.js';
import type { Transaction } from '../db/database.module.js';
import { SettingsService } from '../settings/settings.service.js';
import { CertificateBadgesRepository, type BadgeSnapshot, type BadgeState } from './certificate-badges.repository.js';
import { BADGE_DISCLAIMER, BADGE_METHOD, BADGE_SOURCE, badgeWindow, qualifies, type PublicCertificateBadge } from './domain/badge.js';
export type { PublicCertificateBadge } from './domain/badge.js';

@Injectable()
export class CertificateBadgesService {
  constructor(private readonly badges: CertificateBadgesRepository, private readonly settings: SettingsService, private readonly audit: AuditService) {}

  async publicBadges(ids: string[], version: number, now: Date, tx?: Transaction): Promise<PublicCertificateBadge[]> {
    if (!ids.length) return [];
    const rule = await this.settings.effective('REPUTATION_POLICY', now, tx);
    if (rule.provisional || rule.version !== version) return [];
    const candidates = await this.badges.publicCandidates(ids, now, tx);
    return candidates.filter(({ snapshot, state }) => !state.suspendedAt && snapshot.generation === state.generation &&
      snapshot.qualifies && snapshot.ruleVersion === version && snapshot.calculatedAt <= now && snapshot.expiresAt > now)
      .map(({ snapshot: row }) => ({
        insurerId: row.insurerId, code: 'ON_TIME_CERTIFICATES', label: 'On-time policy certificates',
        sampleCount: row.sampleCount, onTimeCount: row.onTimeCount, minimumPolicies: row.minimumPolicies,
        thresholdBps: row.thresholdBps, percentage: Math.round(row.onTimeCount / row.sampleCount * 1000) / 10,
        periodStart: row.periodStart.toISOString(), periodEnd: row.periodEnd.toISOString(),
        awardedAt: row.calculatedAt.toISOString(), expiresAt: row.expiresAt.toISOString(), ruleVersion: row.ruleVersion,
        dataSource: row.dataSource, method: row.method, disclaimer: row.disclaimer,
      }));
  }

  /** Each insurer commits independently, so a retry can finish the remaining calculations. */
  async calculate(now = new Date()): Promise<number> {
    let inserted = 0;
    const failures: unknown[] = [];
    for (const { id } of await this.badges.insurerIds()) {
      try {
        inserted += await this.calculateForInsurer(id, now);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) {
      throw new AggregateError(failures, `Certificate badge calculation failed for ${failures.length} insurer(s)`);
    }
    return inserted;
  }

  private calculateForInsurer(id: string, now: Date): Promise<number> {
    return this.badges.transaction(async (tx) => {
      const state = await this.badges.lockState(tx, id);
      if (!state || state.suspendedAt || (state.generation > 0 && state.updatedAt > now)) return 0;
      const rule = await this.settings.effective('REPUTATION_POLICY', now, tx);
      if (rule.provisional || rule.version === null) return 0;
      const latest = await this.badges.latest(id, tx);
      if (latest && latest.calculatedAt > now) return 0;
      const window = badgeWindow(rule.value, now);
      const counts = await this.badges.counts(tx, id, window.periodStart, now);
      const eligible = await this.badges.eligible(tx, id, now);
      const snapshot = await this.badges.insert(tx, {
        insurerId: id, calculationDay: lusakaDay(now), generation: state.generation, ruleVersion: rule.version,
        eligible, qualifies: eligible && qualifies(counts.sampleCount, counts.onTimeCount, rule.value.badgeMinimumPolicies, rule.value.badgeThresholdBps),
        ...counts, minimumPolicies: rule.value.badgeMinimumPolicies, thresholdBps: rule.value.badgeThresholdBps,
        ...window, calculatedAt: now, dataSource: BADGE_SOURCE, method: BADGE_METHOD, disclaimer: BADGE_DISCLAIMER,
      });
      if (!snapshot) return 0;
      await this.audit.write(tx, {
        actor: systemActor, action: 'certificate_badge.calculated', entityType: 'CERTIFICATE_BADGE', entityId: id,
        after: { snapshotId: snapshot.id, qualifies: snapshot.qualifies, sampleCount: snapshot.sampleCount,
          onTimeCount: snapshot.onTimeCount, ruleVersion: snapshot.ruleVersion },
      });
      return 1;
    });
  }

  async adminView(insurerId: string, principal: Principal) {
    this.requireAdmin(principal);
    return this.badges.transaction(async (tx) => {
      const state = await this.badges.adminState(tx, insurerId);
      if (!state) throw ApiException.notFound('Insurer', insurerId);
      return this.view(state, await this.badges.latest(insurerId, tx));
    });
  }

  async setSuspension(insurerId: string, suspended: boolean, reason: string, principal: Principal, expectedGeneration: number) {
    this.requireAdmin(principal);
    if (typeof suspended !== 'boolean' || typeof reason !== 'string' || !reason.trim() || reason.trim().length > 2000) {
      throw new ApiException('BADGE_SUSPENSION_INVALID', 'Provide a suspension state and a reason of 1–2000 characters.');
    }
    return this.badges.transaction(async (tx) => {
      const state = await this.badges.lockState(tx, insurerId);
      if (!state) throw ApiException.notFound('Insurer', insurerId);
      if (state.generation !== expectedGeneration) {
        throw ApiException.conflict('BADGE_STATE_CHANGED', 'Badge eligibility changed. Refresh the current status before saving again.');
      }
      const latest = await this.badges.latest(insurerId, tx);
      if (Boolean(state.suspendedAt) === suspended && (!suspended || state.suspensionReason === reason.trim())) return this.view(state, latest);
      const updated = await this.badges.suspend(tx, state, suspended, reason.trim(), new Date());
      await this.audit.write(tx, {
        actor: auditActor(principal), action: suspended ? 'certificate_badge.suspended' : 'certificate_badge.resumed',
        entityType: 'CERTIFICATE_BADGE', entityId: insurerId,
        before: { suspended: Boolean(state.suspendedAt), generation: state.generation },
        after: { suspended, generation: updated.generation }, note: reason.trim(),
      });
      return this.view(updated, latest);
    });
  }

  private requireAdmin(principal: Principal) {
    if (!holds(principal, 'admin:badge:manage')) throw ApiException.forbidden();
  }

  private view(state: BadgeState, latest: BadgeSnapshot | null) {
    return {
      insurerId: state.insurerId, generation: state.generation, suspendedAt: state.suspendedAt?.toISOString() ?? null, suspensionReason: state.suspensionReason,
      latest: latest ? { qualifies: latest.qualifies, calculatedAt: latest.calculatedAt.toISOString(), expiresAt: latest.expiresAt.toISOString(),
        sampleCount: latest.sampleCount, onTimeCount: latest.onTimeCount, ruleVersion: latest.ruleVersion,
        minimumPolicies: latest.minimumPolicies, thresholdBps: latest.thresholdBps,
        periodStart: latest.periodStart.toISOString(), periodEnd: latest.periodEnd.toISOString() } : null,
    };
  }
}
