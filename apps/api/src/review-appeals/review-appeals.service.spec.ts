import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Principal } from '../common/auth/auth.types.js';
import { assertOpenCustomer } from '../db/customer-lock.js';
import { assertReviewPublicText } from '../reviews/publication.js';
import { ReviewAppealsService } from './review-appeals.service.js';
vi.mock('../db/customer-lock.js', () => ({ assertOpenCustomer: vi.fn() }));
vi.mock('../reviews/publication.js', () => ({ assertReviewPublicText: vi.fn() }));
const now = new Date('2035-01-31T21:59:00Z');
const customer: Principal = { kind: 'customer', id: 'customer', email: 'customer@example.invalid', emailVerified: true };
const admin: Principal = { kind: 'staff', id: 'other-moderator', role: 'ADMIN', insurerId: null, email: 'admin@example.invalid' };
const insurer: Principal = { kind: 'staff', id: 'insurer-user', role: 'INSURER_ADMIN', insurerId: 'insurer', email: 'staff@example.invalid' };
function fixture() {
  const context = { customerId: 'customer', decision: { id: 'decision', revisionId: 'revision', moderatorId: 'original-moderator', action: 'REJECT', createdAt: new Date('2035-01-01T00:00:00Z') }, review: { id: 'review', policyNumber: 'policy', withdrawnAt: null as Date | null }, revision: { id: 'revision', reviewId: 'review', kind: 'REVIEW', version: 1, status: 'REJECTED', purgedAt: null as Date | null, text: 'private text' } };
  const appeal = { id: 'appeal', decisionId: 'decision', party: 'CUSTOMER', reason: 'private reason', evidence: 'private evidence', createdAt: now, dueAt: '2035-02-14', decidedAt: null as Date | null, decidedBy: null, outcome: null, outcomeReason: null, purgedAt: null };
  const repository = {
    transaction: vi.fn((work) => work({})),
    decision: vi.fn(async () => context), lockReview: vi.fn(async () => ({ ...context.review, legalHoldAt: null })),
    appeal: vi.fn(async () => appeal), list: vi.fn(async () => [{ appeal, reviewId: 'review' }]),
    create: vi.fn(async (_tx, values) => ({ ...appeal, ...values })),
    close: vi.fn(async (_tx, _id, values) => ({ ...appeal, ...values })),
    revisions: vi.fn(async () => [context.revision]), latestDecision: vi.fn(async () => context.decision),
    applyInverse: vi.fn(), setHold: vi.fn(),
  };
  const settings = { effective: vi.fn(async () => ({ provisional: false, value: { appealDays: 30, appealDecisionDays: 14 } })) };
  const audit = { write: vi.fn() };
  const notifications = { notify: vi.fn() };
  return { context, appeal, repository, settings, audit, notifications, service: new ReviewAppealsService(repository as never, settings as never, audit as never, notifications as never) };
}
beforeEach(() => vi.clearAllMocks());
describe('review appeals', () => {
  it('locks an open customer first and uses the inclusive Lusaka deadline', async () => {
    const f = fixture();
    expect(await f.service.create({ decisionId: 'decision', reason: ' private reason ', evidence: 'private evidence' }, customer, 'CUSTOMER', now)).toMatchObject({ dueAt: '2035-02-14' });
    expect(assertOpenCustomer).toHaveBeenCalledWith({}, customer.id);
    expect(vi.mocked(assertOpenCustomer).mock.invocationCallOrder[0]).toBeLessThan(f.repository.lockReview.mock.invocationCallOrder[0]);
    expect(f.repository.decision).toHaveBeenCalledWith({}, 'decision', { customerId: 'customer' });
    expect(f.repository.decision).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(f.audit.write.mock.calls)).not.toContain('private');
    await expect(f.service.create({ decisionId: 'decision', reason: 'Reason' }, customer, 'CUSTOMER', new Date('2035-01-31T22:00:00Z'))).rejects.toMatchObject({ code: 'APPEAL_WINDOW_CLOSED' });
  });
  it('rejects role and party/action mismatches', async () => {
    const f = fixture();
    await expect(f.service.create({ decisionId: 'decision', reason: 'Reason' }, customer, 'INSURER', now)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(f.service.create({ decisionId: 'decision', reason: 'Reason' }, insurer, 'INSURER', now)).rejects.toMatchObject({ code: 'DECISION_NOT_APPEALABLE' });
    expect(f.repository.create).not.toHaveBeenCalled();
  });
  it('rejects the original moderator and closed appeals', async () => {
    const f = fixture();
    await expect(f.service.resolve('appeal', { outcome: 'UPHELD', reason: 'Reason' }, { ...admin, id: 'original-moderator' }, now)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    f.appeal.decidedAt = now;
    await expect(f.service.resolve('appeal', { outcome: 'UPHELD', reason: 'Reason' }, admin, now)).rejects.toMatchObject({ code: 'APPEAL_CLOSED' });
    expect(f.repository.close).not.toHaveBeenCalled();
  });
  it('upholds without changing content and notifies the actual customer in the transaction', async () => {
    const f = fixture();
    await expect(f.service.resolve('appeal', { outcome: 'UPHELD', reason: 'Private explanation' }, admin, now)).resolves.toMatchObject({ outcome: 'UPHELD', applied: false });
    expect(f.repository.applyInverse).not.toHaveBeenCalled();
    expect(f.notifications.notify).toHaveBeenCalledWith({}, { customerId: 'customer', key: 'REVIEW_APPEAL_DECIDED', entity: { type: 'REVIEW', id: 'review' } }, now);
    expect(JSON.stringify(f.audit.write.mock.calls)).not.toContain('Private explanation');
  });
  it('checks identifying text before restoring a current rejection', async () => {
    const f = fixture();
    await expect(f.service.resolve('appeal', { outcome: 'OVERTURNED', reason: 'Reason' }, admin, now)).resolves.toMatchObject({ applied: true });
    expect(assertReviewPublicText).toHaveBeenCalledWith('private text', 'policy');
    expect(f.repository.applyInverse).toHaveBeenCalledWith({}, 'revision', 'REINSTATE', admin.id, now);
    expect(vi.mocked(assertReviewPublicText).mock.invocationCallOrder[0]).toBeLessThan(f.repository.applyInverse.mock.invocationCallOrder[0]);
  });
  it('refuses provisional restoration without closing', async () => {
    const f = fixture(); f.settings.effective.mockResolvedValue({ provisional: true, value: { appealDays: 30, appealDecisionDays: 14 } });
    await expect(f.service.resolve('appeal', { outcome: 'OVERTURNED', reason: 'Reason' }, admin, now)).rejects.toMatchObject({ code: 'REVIEW_POLICY_PROVISIONAL' });
    expect(f.repository.close).not.toHaveBeenCalled();
    expect(f.repository.applyInverse).not.toHaveBeenCalled();
  });
  it('refuses identifying text without closing or publishing', async () => {
    const f = fixture(); vi.mocked(assertReviewPublicText).mockImplementationOnce(() => { throw new Error('Identifying text'); });
    await expect(f.service.resolve('appeal', { outcome: 'OVERTURNED', reason: 'Reason' }, admin, now)).rejects.toThrow('Identifying text');
    expect(f.repository.close).not.toHaveBeenCalled();
    expect(f.repository.applyInverse).not.toHaveBeenCalled();
  });
  it.each(['withdrawn', 'purged', 'superseded', 'later-decision'])('closes without resurrecting %s content', async (state) => {
    const f = fixture();
    if (state === 'withdrawn') f.context.review.withdrawnAt = now;
    if (state === 'purged') f.context.revision.purgedAt = now;
    if (state === 'superseded') f.repository.revisions.mockResolvedValue([f.context.revision, { ...f.context.revision, id: 'new', version: 2 }]);
    if (state === 'later-decision') f.repository.latestDecision.mockResolvedValue({ ...f.context.decision, id: 'later' });
    await expect(f.service.resolve('appeal', { outcome: 'OVERTURNED', reason: 'Reason' }, admin, now)).resolves.toMatchObject({ applied: false });
    expect(f.repository.applyInverse).not.toHaveBeenCalled();
  });
  it('exposes reviewId only to admin and scopes insurer reads', async () => {
    const f = fixture();
    expect(await f.service.list(admin, 'ADMIN')).toEqual([expect.objectContaining({ reviewId: 'review' })]);
    expect((await f.service.list(insurer, 'INSURER'))[0]).not.toHaveProperty('reviewId');
    expect(f.repository.list).toHaveBeenLastCalledWith({ insurerId: 'insurer' }, 1, undefined, undefined);
  });
  it('locks and audits admin holds', async () => {
    const f = fixture();
    await expect(f.service.legalHold('review', true, customer, now)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await f.service.legalHold('review', true, admin, now);
    expect(f.repository.setHold).toHaveBeenCalledWith({}, 'review', true, now);
    expect(f.repository.lockReview.mock.invocationCallOrder[0]).toBeLessThan(f.repository.setHold.mock.invocationCallOrder[0]);
    expect(f.audit.write).toHaveBeenCalledWith({}, expect.objectContaining({ after: { held: true } }));
  });
});

it('scopes review history to the verified customer and defaults to page one', async () => {
  const f = fixture();
  await f.service.list(customer, 'CUSTOMER', { reviewId: 'review' });
  expect(f.repository.list).toHaveBeenCalledWith({ customerId: customer.id }, 1, undefined, 'review');
  f.repository.list.mockClear();
  await expect(f.service.list({ ...customer, emailVerified: false }, 'CUSTOMER', { reviewId: 'review' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(f.repository.list).not.toHaveBeenCalled();
});
