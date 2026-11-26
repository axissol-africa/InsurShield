import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { vi, type MockInstance } from 'vitest';
import { DATABASE } from '../db/database.module.js';
import { JobRunner } from './job-runner.service.js';
import { JobsRepository } from './jobs.repository.js';

describe('job runner startup', () => {
  let runner: JobRunner;
  let poll: MockInstance<JobRunner['runOnce']>;

  beforeEach(async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const module = await Test.createTestingModule({
      providers: [JobRunner, { provide: JobsRepository, useValue: {} }, { provide: DATABASE, useValue: {} }],
    }).compile();
    runner = module.get(JobRunner);
    vi.useFakeTimers();
    poll = vi.spyOn(runner, 'runOnce').mockResolvedValue(0);
  });

  afterEach(async () => {
    await runner.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('retries a failed initial enqueue without repeating successful startup work or blocking polling', async () => {
    const enqueue = vi.fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('database temporarily unavailable'))
      .mockResolvedValue(undefined);
    const other = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    runner.onStart(enqueue);
    runner.onStart(other);
    expect(enqueue).not.toHaveBeenCalled();

    runner.start();
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(1);
    expect(poll).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(enqueue).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(other).toHaveBeenCalledTimes(1);
    expect(poll).toHaveBeenCalledTimes(3);
  });

  it('waits for startup work on shutdown and does not retry after stopping', async () => {
    let rejectEnqueue: (reason: Error) => void = () => { throw new Error('Enqueue not started'); };
    const pending = new Promise<void>((_resolve, reject) => { rejectEnqueue = reject; });
    const enqueue = vi.fn(() => pending);
    runner.onStart(enqueue);
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    let stopped = false;
    const stopping = runner.stop().then(() => { stopped = true; });
    await vi.advanceTimersByTimeAsync(0);
    const stoppedBeforeEnqueue = stopped;
    rejectEnqueue(new Error('database unavailable'));
    await stopping;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(stoppedBeforeEnqueue).toBe(false);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(poll).not.toHaveBeenCalled();
  });
});
