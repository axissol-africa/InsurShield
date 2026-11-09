import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../src/common/audit/audit.service.js';
import { systemActor } from '../src/common/audit/audit.types.js';
import { auditLogs, stateHistory } from '../src/db/schema.js';
import { buildClaim, buildInsurer } from './builders.js';
import { openTestDatabase, startApp, type TestApp } from './helpers.js';
import { signIn } from './sessions.js';

/**
 * Batch 4's first acceptance check: a workflow write and its audit and state
 * rows commit together, and a failed transaction produces neither. The unit
 * test for the writer asserts against a fake transaction, which cannot show
 * what PostgreSQL does on a rollback.
 */
describe('audit trail and state history', () => {
  let testApp: TestApp;
  let side: ReturnType<typeof openTestDatabase>;
  let audit: AuditService;

  beforeAll(async () => {
    testApp = await startApp();
    side = openTestDatabase();
    audit = testApp.app.get(AuditService);
  });

  afterAll(async () => {
    await testApp.close();
    await side.close();
  });

  const eventsFor = (entityId: string) =>
    side.db.select({ action: auditLogs.action, actorId: auditLogs.actorId, after: auditLogs.after })
      .from(auditLogs)
      .where(eq(auditLogs.entityId, entityId));

  const transitionsFor = (entityId: string) =>
    side.db.select({ fromStatus: stateHistory.fromStatus, toStatus: stateHistory.toStatus, actorId: stateHistory.actorId })
      .from(stateHistory)
      .where(eq(stateHistory.entityId, entityId));

  it('records the event, the transition and its audit row when an insurer acknowledges a claim', async () => {
    const insurer = await buildInsurer(testApp.db);
    const claim = await buildClaim(testApp.db, { insurerId: insurer.insurer.id });
    const session = await signIn(testApp.http, insurer.staff);

    await testApp.http
      .post(`/api/v1/insurer/claims/${claim.claimNumber}/received`)
      .set(session)
      .send({ insurerClaimReference: 'IC-AUDIT' })
      .expect(200);

    expect(await eventsFor(claim.claimNumber)).toEqual(
      expect.arrayContaining([
        { action: 'claim.received_by_insurer', actorId: insurer.staff.id, after: { hasInsurerReference: true } },
        { action: 'claim.status_changed', actorId: insurer.staff.id, after: { status: 'RECEIVED_BY_INSURER' } },
      ]),
    );
    expect(await transitionsFor(claim.claimNumber)).toEqual([
      { fromStatus: 'NOTIFIED', toStatus: 'RECEIVED_BY_INSURER', actorId: insurer.staff.id },
    ]);
  });

  it('keeps the transition and its audit row in the caller transaction, committing both together', async () => {
    const entityId = `POL-${randomUUID()}`;

    await testApp.db.transaction(async (tx) => {
      await audit.transition(tx, {
        actor: systemActor,
        entityType: 'POLICY',
        entityId,
        fromStatus: 'AWAITING_INSURER_CERTIFICATE',
        toStatus: 'ACTIVE',
      });
    });

    expect(await transitionsFor(entityId)).toHaveLength(1);
    expect(await eventsFor(entityId)).toEqual([
      expect.objectContaining({ action: 'policy.status_changed', after: { status: 'ACTIVE' } }),
    ]);
  });

  it('leaves neither row behind when the transaction that wrote them fails', async () => {
    const entityId = `POL-${randomUUID()}`;
    const failure = new Error('the business write failed after the audit row');

    await expect(
      testApp.db.transaction(async (tx) => {
        await audit.write(tx, {
          actor: systemActor,
          action: 'policy.issued',
          entityType: 'POLICY',
          entityId,
        });
        await audit.transition(tx, {
          actor: systemActor,
          entityType: 'POLICY',
          entityId,
          fromStatus: 'AWAITING_INSURER_CERTIFICATE',
          toStatus: 'ACTIVE',
        });
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(await eventsFor(entityId)).toEqual([]);
    expect(await transitionsFor(entityId)).toEqual([]);
  });

  it('refuses to rewrite history even for the role that may read it', async () => {
    const entityId = `POL-${randomUUID()}`;
    await testApp.db.transaction((tx) =>
      audit.write(tx, { actor: systemActor, action: 'policy.issued', entityType: 'POLICY', entityId }),
    );

    await expect(
      side.db.update(auditLogs).set({ action: 'policy.rewritten' }).where(eq(auditLogs.entityId, entityId)),
    ).rejects.toThrow();
    await expect(
      side.db.delete(auditLogs).where(and(eq(auditLogs.entityId, entityId), eq(auditLogs.action, 'policy.issued'))),
    ).rejects.toThrow();

    expect(await eventsFor(entityId)).toEqual([
      expect.objectContaining({ action: 'policy.issued' }),
    ]);
  });
});
