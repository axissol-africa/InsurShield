import { eq } from 'drizzle-orm';
import { jobs } from '../src/db/schema.js';
import { JobRunner } from '../src/jobs/job-runner.service.js';
import { JobsRepository } from '../src/jobs/jobs.repository.js';
import { startServing } from '../src/serve.js';
import { startApp, until, type TestApp } from './helpers.js';

/**
 * What `main.ts` does once the provider gate has passed. Background work
 * (status checks, refunds, emails, deliveries) only happens if the job
 * runner is started, so a served app must be working its queue.
 */
describe('a served application', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await startApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('works its job queue without anyone driving the runner', async () => {
    const handled: string[] = [];
    testApp.app.get(JobRunner).register('test.served', async (job) => {
      handled.push(job.key);
    });
    const key = `served-${Date.now()}`;
    await testApp.app.get(JobsRepository).transaction((tx) =>
      testApp.app.get(JobsRepository).enqueue(tx, { kind: 'test.served', key, payload: {}, runAfter: new Date() }),
    );

    startServing(testApp.app);

    await until(() => handled.includes(key), 'the served runner to take the job');
    const [row] = await testApp.db.select().from(jobs).where(eq(jobs.key, key));
    expect(row.status).toBe('DONE');
  });
});
