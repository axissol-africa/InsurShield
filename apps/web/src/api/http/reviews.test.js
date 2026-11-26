import { expect, it, vi } from 'vitest';
const transport = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@/lib/apiClient', () => ({ apiClient: transport }));
import { reviews, insurerProfiles, reviewAppeals } from './index';
it('encodes policy and insurer identifiers and preserves the configured base prefix', () => {
  reviews.forPolicy('POL/a'); reviews.submit('POL/a', { rating: 5, text: 'Good' }); reviews.edit('POL/a', { rating: 4 }); reviews.withdraw('POL/a');
  expect(transport.get).toHaveBeenCalledWith('/reviews/customer/policies/POL%2Fa', undefined);
  expect(transport.post).toHaveBeenCalledWith('/reviews/customer/policies/POL%2Fa', { rating: 5, text: 'Good' });
  expect(transport.patch).toHaveBeenCalledWith('/reviews/customer/policies/POL%2Fa', { rating: 4 });
  expect(transport.delete).toHaveBeenCalledWith('/reviews/customer/policies/POL%2Fa');
  reviews.publicForInsurer('id/a', 2); insurerProfiles.public('id/a');
  expect(transport.get).toHaveBeenCalledWith('/reviews/public/id%2Fa', { params: { page: 2 } });
  expect(transport.get).toHaveBeenCalledWith('/insurer-profiles/id%2Fa', undefined);
});

it('lists private appeals and submits only the decision, reason and optional evidence', () => {
  reviewAppeals.list();
  reviewAppeals.submit({ decisionId: 'decision', reason: 'Please reconsider', evidence: 'Private context' });
  expect(transport.get).toHaveBeenCalledWith('/review-appeals', undefined);
  expect(transport.post).toHaveBeenCalledWith('/review-appeals', { decisionId: 'decision', reason: 'Please reconsider', evidence: 'Private context' });
});
