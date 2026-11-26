import { Test } from '@nestjs/testing';
import { vi } from 'vitest';
import { JobsRepository } from '../jobs/jobs.repository.js';
import { CertificateBadgesService } from './certificate-badges.service.js';
import { CERTIFICATE_BADGES_CALCULATE, CertificateBadgesJobs } from './certificate-badges.jobs.js';

describe('daily certificate calculations', () => {
  it('queues the next Lusaka day before a failed calculation, with a stable retry key', async () => {
    const tx = {};
    const enqueue = vi.fn();
    const calculate = vi.fn().mockRejectedValue(new Error('refresh failed'));
    const module = await Test.createTestingModule({ providers: [CertificateBadgesJobs,
      { provide: JobsRepository, useValue: { transaction: (work: (executor: object) => Promise<void>) => work(tx), enqueue } },
      { provide: CertificateBadgesService, useValue: { calculate } },
    ] }).compile();
    const jobs = module.get(CertificateBadgesJobs);
    const now = new Date('2026-11-26T23:00:00Z');
    await expect(jobs.run(now)).rejects.toThrow('refresh failed');
    expect(enqueue).toHaveBeenCalledWith(tx, {
      kind: CERTIFICATE_BADGES_CALCULATE, key: '2026-11-28', payload: {}, runAfter: new Date('2026-11-27T22:00:00Z'),
    });
    expect(enqueue.mock.invocationCallOrder[0]).toBeLessThan(calculate.mock.invocationCallOrder[0]);
    await expect(jobs.run(now)).rejects.toThrow('refresh failed');
    expect(enqueue.mock.calls[1]).toEqual(enqueue.mock.calls[0]);
  });
});
