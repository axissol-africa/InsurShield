import { CustomerService } from './customer.service.js';
import { ApiException } from '../common/errors/api.exception.js';

/**
 * Reviews are shown to other customers while they compare, so what matters is
 * that only the buyer can write one, and only one per policy.
 */
const buildService = (policy: Record<string, unknown> | null) => {
  const upserts: Record<string, unknown>[] = [];
  const prisma = {
    policy: { findFirst: async () => policy },
    insurerReview: {
      upsert: async (args: { where: unknown; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        upserts.push({ where: args.where, create: args.create, update: args.update });
        return {
          id: 'review-1',
          rating: args.update.rating,
          comment: args.update.comment,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      },
      findMany: async () => [],
    },
  };
  const documents = { record: async () => null };
  return { service: new CustomerService(prisma as never, documents as never), upserts };
};

const POLICY = { policyNumber: 'POL-000001', insurerId: 'insurer-1' };

describe('reviewing a policy', () => {
  it('records the review against the policy and its insurer', async () => {
    const { service, upserts } = buildService(POLICY);
    const review = await service.reviewPolicy('customer-1', 'POL-000001', { rating: 5, comment: 'Quick payout.' });

    expect(review.rating).toBe(5);
    expect(upserts[0].create).toMatchObject({
      policyNumber: 'POL-000001',
      customerId: 'customer-1',
      insurerId: 'insurer-1',
      rating: 5,
    });
  });

  it('amends in place rather than stacking ratings on one purchase', async () => {
    const { service, upserts } = buildService(POLICY);
    await service.reviewPolicy('customer-1', 'POL-000001', { rating: 2 });

    // Keyed on the policy and the customer together, so a second submission
    // replaces the first instead of inserting another row.
    expect(upserts[0].where).toEqual({
      policyNumber_customerId: { policyNumber: 'POL-000001', customerId: 'customer-1' },
    });
    expect(upserts[0].update).toMatchObject({ rating: 2 });
  });

  it('refuses a policy the customer does not hold', async () => {
    const { service } = buildService(null);
    await expect(service.reviewPolicy('customer-1', 'POL-SOMEONE-ELSE', { rating: 5 })).rejects.toThrow(
      ApiException,
    );
  });

  it('trims a comment to what the column holds', async () => {
    const { service, upserts } = buildService(POLICY);
    await service.reviewPolicy('customer-1', 'POL-000001', { rating: 4, comment: ' ' + 'x'.repeat(700) });
    expect(String(upserts[0].update && (upserts[0].update as Record<string, string>).comment)).toHaveLength(500);
  });

  it('stores an empty comment as nothing, not as blank text', async () => {
    const { service, upserts } = buildService(POLICY);
    await service.reviewPolicy('customer-1', 'POL-000001', { rating: 4, comment: '   ' });
    expect((upserts[0].update as Record<string, unknown>).comment).toBeNull();
  });
});
