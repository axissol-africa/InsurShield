import { describe, expect, it, vi } from 'vitest';
import { defaultRuleValue, parseRuleValue } from '../settings/domain/rules.js';
import { RetentionService } from './retention.service.js';

function fixture() {
  const tx = {};
  const repository = {
    transaction: vi.fn((work) => work(tx)),
    documentCandidates: vi.fn().mockResolvedValue([{ id: 'document' }]),
    claimDocument: vi
      .fn()
      .mockResolvedValue({ id: 'document', storageKey: 'private-key' }),
    finishDocument: vi.fn().mockResolvedValue(true),
    accountCandidates: vi.fn().mockResolvedValue([{ id: 'customer' }]),
    reviewCandidates: vi.fn().mockResolvedValue([{ id: 'review' }]),
    purgeReview: vi.fn().mockResolvedValue({ revisions: 1, appeals: 1 }),
    anonymise: vi.fn().mockResolvedValue(true),
  };
  const jobs = {
    transaction: vi.fn((work) => work(tx)),
    enqueue: vi.fn().mockResolvedValue(undefined),
  };
  const settings = {
    effective: vi.fn((key: 'DOCUMENT_RETENTION' | 'ACCOUNT_RETENTION' | 'REVIEW_POLICY') => ({
      value: defaultRuleValue(key),
      provisional: true,
    })),
  };
  const storage = { delete: vi.fn().mockResolvedValue(undefined) };
  const audit = { write: vi.fn().mockResolvedValue(undefined) };
  const service = new RetentionService(
    repository as never,
    jobs as never,
    settings as never,
    storage as never,
    audit as never,
  );
  return { repository, jobs, settings, storage, audit, service };
}

describe('retention sweep', () => {
  it('does not purge reviews under provisional policy', async () => {
    const f = fixture();
    await f.service.run();
    expect(f.repository.reviewCandidates).not.toHaveBeenCalled();
    expect(f.repository.purgeReview).not.toHaveBeenCalled();
  });

  it('rechecks the active confirmed rule in the purge transaction and audits only counts', async () => {
    const f = fixture();
    f.settings.effective.mockImplementation((key) => ({ value: defaultRuleValue(key), provisional: false }));
    await f.service.run();
    expect(f.repository.purgeReview).toHaveBeenCalledWith({}, 'review', expect.any(Date), 365, 30);
    expect(f.audit.write).toHaveBeenCalledWith({}, expect.objectContaining({ action: 'review.private_content_purged', after: { revisions: 1, appeals: 1 } }));
  });

  it('does not purge if the effective rule is provisional when the transaction rechecks it', async () => {
    const f = fixture();
    let reviewReads = 0;
    f.settings.effective.mockImplementation((key) => ({
      value: defaultRuleValue(key),
      provisional: key === 'REVIEW_POLICY' && ++reviewReads > 1,
    }));
    await f.service.run();
    expect(f.repository.reviewCandidates).toHaveBeenCalled();
    expect(f.repository.purgeReview).not.toHaveBeenCalled();
  });

  it('deletes after the durable claim, marks completion and audits counts only', async () => {
    const f = fixture();
    await f.service.run(new Date('2035-01-01T00:00:00Z'));
    expect(f.repository.claimDocument.mock.invocationCallOrder[0]).toBeLessThan(
      f.storage.delete.mock.invocationCallOrder[0],
    );
    expect(f.storage.delete.mock.invocationCallOrder[0]).toBeLessThan(
      f.repository.finishDocument.mock.invocationCallOrder[0],
    );
    expect(f.audit.write.mock.calls.map((call) => call[1].after)).toEqual([
      { count: 1 },
      { count: 1 },
    ]);
    expect(JSON.stringify(f.audit.write.mock.calls)).not.toContain(
      'private-key',
    );
    expect(f.jobs.enqueue).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ kind: 'retention.sweep', key: '2035-01-02' }),
    );
  });

  it('does not delete a document held during the claim or audit a repeated completion', async () => {
    const f = fixture();
    f.repository.claimDocument.mockResolvedValueOnce(null);
    f.repository.anonymise.mockResolvedValue(false);
    await f.service.run();
    expect(f.storage.delete).not.toHaveBeenCalled();
    expect(f.audit.write).not.toHaveBeenCalled();
    f.repository.finishDocument.mockResolvedValue(false);
    await f.service.run();
    expect(f.storage.delete).toHaveBeenCalledTimes(1);
    expect(f.audit.write).not.toHaveBeenCalled();
  });

  it('leaves the durable claim for retry when storage fails', async () => {
    const f = fixture();
    f.storage.delete.mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(f.service.run()).rejects.toThrow(
      '1 incomplete operations; retry required',
    );
    expect(f.repository.finishDocument).not.toHaveBeenCalled();
    await f.service.run();
    expect(f.storage.delete).toHaveBeenCalledTimes(2);
    expect(f.repository.finishDocument).toHaveBeenCalledTimes(1);
  });

  it('continues independent document and account work after a storage failure without exposing it', async () => {
    const f = fixture();
    f.repository.documentCandidates.mockResolvedValue([
      { id: 'first' },
      { id: 'second' },
    ]);
    f.repository.claimDocument
      .mockResolvedValueOnce({ id: 'first', storageKey: 'private-key' })
      .mockResolvedValueOnce({ id: 'second', storageKey: 'other-key' });
    f.storage.delete.mockRejectedValueOnce(new Error('secret-provider-detail'));
    await expect(f.service.run()).rejects.toThrow(
      /^Retention sweep has 1 incomplete operations; retry required\.$/,
    );
    expect(f.storage.delete).toHaveBeenCalledTimes(2);
    expect(f.repository.finishDocument).toHaveBeenCalledWith(
      {},
      'second',
      expect.any(Date),
    );
    expect(f.repository.anonymise).toHaveBeenCalledTimes(1);
  });

  it('repeats object deletion after a crash before database completion', async () => {
    const f = fixture();
    f.repository.finishDocument.mockRejectedValueOnce(
      new Error('Commit failed'),
    );
    await expect(f.service.run()).rejects.toThrow(
      '1 incomplete operations; retry required',
    );
    await f.service.run();
    expect(f.storage.delete).toHaveBeenCalledTimes(2);
    expect(f.audit.write).toHaveBeenCalledTimes(3);
  });
});

describe('ACCOUNT_RETENTION', () => {
  it('defaults provisionally to seven years and validates whole positive days', () => {
    expect(defaultRuleValue('ACCOUNT_RETENTION')).toEqual({
      daysAfterClosure: 2555,
    });
    for (const value of [0, -1, 1.5, '2555', 36501]) {
      expect(
        parseRuleValue('ACCOUNT_RETENTION', { daysAfterClosure: value }),
      ).toHaveProperty('errors');
    }
    expect(
      parseRuleValue('ACCOUNT_RETENTION', { daysAfterClosure: 30 }),
    ).toEqual({ value: { daysAfterClosure: 30 } });
  });
});
