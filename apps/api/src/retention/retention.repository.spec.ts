import { expect, it, vi } from 'vitest';
import { RetentionRepository } from './retention.repository.js';
it('skips review purge while a competing customer hold owns the B15 fence', async () => {
  const chain = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    for: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  chain.where.mockReturnValue(
    Object.assign(Promise.resolve([{ id: 'review', customerId: 'customer' }]), {
      for: chain.for,
    }),
  );
  chain.for.mockResolvedValue([{ id: 'review', customerId: 'customer' }]);
  const tx = {
    select: vi.fn().mockReturnValue(chain),
    execute: vi.fn().mockResolvedValue({ rows: [{ acquired: false }] }),
    update: vi.fn().mockReturnValue({
      set: () => ({
        where: () => ({ returning: async () => [{ id: 'revision' }] }),
      }),
    }),
  };
  const repository = new RetentionRepository({} as never);
  expect(
    await repository.purgeReview(tx as never, 'review', new Date(), 365, 30),
  ).toEqual({ revisions: 0, appeals: 0 });
  expect(tx.execute).toHaveBeenCalledOnce();
  expect(tx.update).not.toHaveBeenCalled();
});
