import { vi } from 'vitest';
import type { AuditService } from '../common/audit/audit.service.js';
import type { Principal } from '../common/auth/auth.types.js';
import type { TemplateRow } from './notifications.repository.js';
import type { TemplateGovernanceRepository } from './template-governance.repository.js';
import { TemplateGovernanceService } from './template-governance.service.js';

const now = new Date('2026-11-26T12:00:00Z');
const author: Principal = {
  kind: 'staff',
  id: 'author',
  email: 'author@example.test',
  role: 'ADMIN',
  insurerId: null,
};
const reviewer: Principal = { ...author, id: 'reviewer', role: 'SUPER_ADMIN' };
const draft = (): TemplateRow => ({
  id: 'draft',
  key: 'quote.ready',
  channel: 'EMAIL',
  category: 'QUOTE',
  mandatory: true,
  version: 2,
  subject: 'Ready',
  body: '{{insurer}} has quoted. Sign in to see it.',
  owner: 'Operations',
  reviewStatus: 'DRAFT',
  activeFrom: null,
  effectiveFrom: new Date('2026-11-26T10:00:00Z'),
  expiresAt: new Date('2026-12-26T10:00:00Z'),
  createdBy: 'author',
  createdByRole: 'ADMIN',
  approvedBy: null,
  approvedByRole: null,
  approvedAt: null,
  withdrawnBy: null,
  withdrawnAt: null,
  createdAt: now,
});
function setup(row = draft()) {
  const repository = {
    transaction: vi.fn((work) => work({})),
    find: vi.fn(async () => row),
    lockSeries: vi.fn(async () => [row]),
    review: vi.fn(async (_tx, _id, _status, changes) => ({
      ...row,
      ...changes,
    })),
    insert: vi.fn(async (_tx, values) => ({ ...row, ...values })),
    list: vi.fn(async () => [row]),
    exceptions: vi.fn(async () => [
      {
        id: 'notification',
        event: row.key,
        version: 2,
        channel: 'EMAIL',
        owner: row.owner,
        deliveryStatus: 'PENDING',
        retryState: 'FAILED',
        attempt: 5,
        maxAttempts: 5,
        runAfter: now,
        createdAt: now,
        templateStatus: 'APPROVED',
        expiresAt: null,
        lastError: 'secret provider recipient',
        recipient: 'private@example.test',
      },
    ]),
  };
  const audit = { write: vi.fn(async () => {}) };
  return {
    repository,
    audit,
    service: new TemplateGovernanceService(
      repository as unknown as TemplateGovernanceRepository,
      audit as unknown as AuditService,
    ),
  };
}
describe('notification governance', () => {
  it('requires independent approval and records trusted actor role and audit in the transaction', async () => {
    const { service, repository, audit } = setup();
    await expect(
      service.review(
        author,
        'draft',
        { expectedVersion: 2, reason: 'Reviewed' },
        'approve',
        now,
      ),
    ).rejects.toMatchObject({ code: 'NOTIFICATION_TEMPLATE_REVIEW' });
    expect(repository.review).not.toHaveBeenCalled();
    const approved = await service.review(
      reviewer,
      'draft',
      { expectedVersion: 2, reason: 'Reviewed' },
      'approve',
      now,
    );
    expect(approved).toMatchObject({
      reviewStatus: 'APPROVED',
      approvedBy: 'reviewer',
      approvedByRole: 'SUPER_ADMIN',
      activeFrom: '2026-11-26T10:00:00.000Z',
    });
    expect(audit.write).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'notification_template.approved',
        actor: { type: 'STAFF', id: 'reviewer' },
      }),
    );
  });
  it('refuses expired approvals and stale versions', async () => {
    const { service } = setup({ ...draft(), expiresAt: now });
    await expect(
      service.review(
        reviewer,
        'draft',
        { expectedVersion: 2, reason: 'Review' },
        'approve',
        now,
      ),
    ).rejects.toMatchObject({ code: 'NOTIFICATION_TEMPLATE_REVIEW' });
    await expect(
      service.review(
        reviewer,
        'draft',
        { expectedVersion: 1, reason: 'Review' },
        'withdraw',
        now,
      ),
    ).rejects.toMatchObject({ code: 'NOTIFICATION_TEMPLATE_CONFLICT' });
  });
  it('creates a new immutable draft without activation or policy changes', async () => {
    const { service, repository } = setup();
    const created = await service.create(
      author,
      'draft',
      {
        expectedVersion: 2,
        subject: 'Updated',
        body: '{{insurer}} has quoted.',
        owner: 'Operations',
        effectiveFrom: now.toISOString(),
        expiresAt: '2026-12-26T10:00:00Z',
      },
      now,
    );
    expect(created).toMatchObject({
      version: 3,
      activeFrom: null,
      reviewStatus: 'DRAFT',
      mandatory: true,
    });
    expect(repository.review).not.toHaveBeenCalled();
  });
  it('refuses customer and insurer callers at the service boundary', async () => {
    const { service, repository } = setup();
    await expect(
      service.list(
        {
          kind: 'customer',
          id: 'customer',
          email: 'c@example.test',
          emailVerified: true,
        },
        { limit: 50, offset: 0 },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      service.list(
        { ...author, role: 'INSURER_ADMIN' },
        { limit: 50, offset: 0 },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(repository.list).not.toHaveBeenCalled();
  });
  it('masks delivery exceptions and exposes stable reasons', async () => {
    const { service } = setup();
    const response = await service.exceptions(
      author,
      { limit: 50, offset: 0 },
      now,
    );
    expect(response.items[0]).toMatchObject({
      reason: 'RETRY_EXHAUSTED',
      retryState: 'FAILED',
      attempt: 5,
      owner: 'Operations',
      event: 'quote.ready',
      version: 2,
    });
    expect(JSON.stringify(response)).not.toMatch(
      /private|secret|recipient|lastError/,
    );
  });
});
