import { Test } from '@nestjs/testing';
import { vi } from 'vitest';
import { AuditService } from '../common/audit/audit.service.js';
import type { Principal } from '../common/auth/auth.types.js';
import type { Transaction } from '../db/database.module.js';
import { SettingsService } from '../settings/settings.service.js';
import { CertificateBadgesRepository, type BadgeSnapshot, type BadgeState } from './certificate-badges.repository.js';
import { CertificateBadgesService } from './certificate-badges.service.js';

const now = new Date('2026-11-26T12:00:00Z');
const admin: Principal = { kind: 'staff', id: 'admin', email: '', role: 'ADMIN', insurerId: null };
const state: BadgeState = { insurerId: 'insurer', generation: 0, suspendedAt: null, suspensionReason: null, updatedAt: new Date(0) };
const snapshot: BadgeSnapshot = {
  id: 'snapshot', insurerId: 'insurer', generation: 0, calculationDay: '2026-11-26', ruleVersion: 2,
  eligible: true, qualifies: true, sampleCount: 30, onTimeCount: 27, minimumPolicies: 30, thresholdBps: 9000,
  periodStart: new Date('2026-08-28T12:00:00Z'), periodEnd: now, calculatedAt: now,
  expiresAt: new Date('2026-11-28T12:00:00Z'), dataSource: 'source', method: 'method', disclaimer: 'disclaimer',
};

describe('certificate badge service', () => {
  const tx = {};
  const repository = {
    transaction: vi.fn(async (work: (executor: object) => Promise<unknown>) => work(tx)),
    insurerIds: vi.fn(), lockState: vi.fn(), latest: vi.fn(), counts: vi.fn(), eligible: vi.fn(),
    insert: vi.fn(), publicCandidates: vi.fn(), suspend: vi.fn(),
  };
  const settings = { effective: vi.fn() };
  const audit = { write: vi.fn() };
  let service: CertificateBadgesService;

  beforeEach(async () => {
    vi.resetAllMocks();
    repository.transaction.mockImplementation(async (work) => work(tx));
    repository.insurerIds.mockResolvedValue([{ id: 'insurer' }]);
    repository.lockState.mockResolvedValue({ ...state });
    repository.latest.mockResolvedValue(null);
    repository.counts.mockResolvedValue({ sampleCount: 30, onTimeCount: 27 });
    repository.eligible.mockResolvedValue(true);
    repository.insert.mockResolvedValue(snapshot);
    repository.publicCandidates.mockResolvedValue([{ snapshot: { ...snapshot }, state: { ...state } }]);
    settings.effective.mockResolvedValue({ provisional: false, version: 2, value: {
      badgeWindowDays: 90, badgeMinimumPolicies: 30, badgeThresholdBps: 9000, badgeValidityHours: 48,
    } });
    const module = await Test.createTestingModule({ providers: [CertificateBadgesService,
      { provide: CertificateBadgesRepository, useValue: repository }, { provide: SettingsService, useValue: settings },
      { provide: AuditService, useValue: audit },
    ] }).compile();
    service = module.get(CertificateBadgesService);
  });

  it('publishes only the exact public fields with ISO timestamps', async () => {
    expect(await service.publicBadges(['insurer'], 2, now)).toEqual([{
      insurerId: 'insurer', code: 'ON_TIME_CERTIFICATES', label: 'On-time policy certificates', sampleCount: 30,
      onTimeCount: 27, minimumPolicies: 30, thresholdBps: 9000, percentage: 90, periodStart: snapshot.periodStart.toISOString(),
      periodEnd: now.toISOString(), awardedAt: now.toISOString(), expiresAt: snapshot.expiresAt.toISOString(),
      ruleVersion: 2, dataSource: 'source', method: 'method', disclaimer: 'disclaimer',
    }]);
  });

  it.each([
    { snapshot: { ...snapshot, qualifies: false }, state },
    { snapshot: { ...snapshot, ruleVersion: 1 }, state },
    { snapshot: { ...snapshot, expiresAt: now }, state },
    { snapshot: { ...snapshot, calculatedAt: new Date(now.getTime() + 1) }, state },
    { snapshot, state: { ...state, suspendedAt: now } },
    { snapshot, state: { ...state, generation: 1 } },
  ])('hides stale, ineligible, suspended and pre-resume evidence %#', async (candidate) => {
    repository.publicCandidates.mockResolvedValue([candidate]);
    expect(await service.publicBadges(['insurer'], 2, now)).toEqual([]);
  });

  it('never calculates or publishes provisional rules', async () => {
    settings.effective.mockResolvedValue({ provisional: true, version: 2 });
    expect(await service.calculate(now)).toBe(0);
    expect(await service.publicBadges(['insurer'], 2, now)).toEqual([]);
    expect(repository.insert).not.toHaveBeenCalled();
    expect(repository.publicCandidates).not.toHaveBeenCalled();
  });

  it('invalidates awards on current standing and stores evidence without personal data', async () => {
    repository.eligible.mockResolvedValue(false);
    await service.calculate(now);
    expect(repository.insert).toHaveBeenCalledWith(tx, expect.objectContaining({ eligible: false, qualifies: false, ruleVersion: 2, sampleCount: 30 }));
    expect(audit.write).toHaveBeenCalledTimes(1);
  });

  it('does not audit duplicate daily snapshots or overwrite newer calculations', async () => {
    repository.insert.mockResolvedValue(null);
    expect(await service.calculate(now)).toBe(0);
    expect(audit.write).not.toHaveBeenCalled();
    repository.latest.mockResolvedValue({ ...snapshot, calculatedAt: new Date(now.getTime() + 1) });
    repository.insert.mockClear();
    expect(await service.calculate(now)).toBe(0);
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('propagates failed refreshes for durable job retries', async () => {
    repository.counts.mockRejectedValue(new Error('unavailable'));
    await expect(service.calculate(now)).rejects.toMatchObject({ errors: [expect.objectContaining({ message: 'unavailable' })] });
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('keeps refreshing other insurers after one fails and leaves the job retryable', async () => {
    repository.insurerIds.mockResolvedValue([{ id: 'first' }, { id: 'failed' }, { id: 'last' }]);
    repository.counts.mockResolvedValueOnce({ sampleCount: 30, onTimeCount: 27 })
      .mockRejectedValueOnce(new Error('isolated timeout'));
    await expect(service.calculate(now)).rejects.toBeInstanceOf(Error);
    expect(repository.insert.mock.calls.map(([, value]) => value.insurerId)).toEqual(['first', 'last']);
    expect(audit.write).toHaveBeenCalledTimes(2);
  });

  it('rejects a delayed resume after a newer suspension, without changing state or audit', async () => {
    repository.lockState.mockResolvedValue({ ...state, generation: 3, suspendedAt: now, suspensionReason: 'New concern' });
    repository.suspend.mockResolvedValue({ ...state, generation: 4 });
    await expect(service.setSuspension('insurer', false, 'Earlier case resolved', admin, 1))
      .rejects.toMatchObject({ code: 'BADGE_STATE_CHANGED' });
    expect(repository.suspend).not.toHaveBeenCalled();
    expect(audit.write).not.toHaveBeenCalled();
  });

  it('resumes with a new generation and an audited reason', async () => {
    repository.lockState.mockResolvedValue({ ...state, suspendedAt: now, suspensionReason: 'review' });
    repository.suspend.mockResolvedValue({ ...state, generation: 1 });
    const result = await service.setSuspension('insurer', false, 'review complete', admin, 0);
    expect(result.suspendedAt).toBeNull();
    expect(repository.suspend).toHaveBeenCalledWith(tx, expect.anything(), false, 'review complete', expect.any(Date));
    expect(audit.write).toHaveBeenCalledWith(tx, expect.objectContaining({ action: 'certificate_badge.resumed', after: { suspended: false, generation: 1 } }));
  });

  it('rejects empty reasons even for internal callers', async () => {
    await expect(service.setSuspension('insurer', true, ' ', admin, 0)).rejects.toThrow();
    expect(repository.transaction).not.toHaveBeenCalled();
  });
  it('uses the caller transaction for both the rule and public evidence', async () => {
    const callerTx = {} as Transaction;
    await service.publicBadges(['insurer'], 2, now, callerTx);
    expect(settings.effective).toHaveBeenCalledWith('REPUTATION_POLICY', now, callerTx);
    expect(repository.publicCandidates).toHaveBeenCalledWith(['insurer'], now, callerTx);
  });

  it('does not award a calculation from before a resume or while suspended', async () => {
    repository.lockState.mockResolvedValue({ ...state, generation: 1, updatedAt: new Date(now.getTime() + 1) });
    expect(await service.calculate(now)).toBe(0);
    repository.lockState.mockResolvedValue({ ...state, suspendedAt: now });
    expect(await service.calculate(now)).toBe(0);
    expect(repository.counts).not.toHaveBeenCalled();
  });

});
