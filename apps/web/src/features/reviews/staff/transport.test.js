import { beforeEach, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/apiClient';
import { staffReviews } from './transport';
import { env } from '@/config/env';

vi.mock('@/config/env', () => ({ env: { apiMode: 'http' } }));
vi.mock('@/lib/apiClient', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn() } }));
beforeEach(() => { vi.clearAllMocks(); env.apiMode = 'http'; });
it('uses authenticated moderation and response requests with the exact contract', async () => {
  await staffReviews.listAdmin({ page: 2, status: 'REMOVED' });
  expect(apiClient.get).toHaveBeenCalledWith('/reviews/admin', { params: { page: 2, status: 'REMOVED' } });
  const decision = { revisionId: 'revision', action: 'REINSTATE', reason: 'APPROVED' };
  await staffReviews.decide('review/id', decision);
  expect(apiClient.post).toHaveBeenCalledWith('/reviews/admin/review%2Fid/decisions', decision);
  await staffReviews.listInsurer({ page: 1 });
  expect(apiClient.get).toHaveBeenCalledWith('/reviews/insurer', { params: { page: 1 } });
  await staffReviews.respond('review/id', 'A reply');
  expect(apiClient.put).toHaveBeenCalledWith('/reviews/insurer/review%2Fid/response', { text: 'A reply' });
});
it('uses the appeal and legal hold endpoints without exposing evidence in URLs', async () => {
  await staffReviews.listAppeals(true); await staffReviews.listAppeals(false);
  expect(apiClient.get).toHaveBeenCalledWith('/admin/review-appeals');
  expect(apiClient.get).toHaveBeenCalledWith('/portal/review-appeals');
  const payload = { decisionId: 'decision', reason: 'Private', evidence: 'Private evidence' };
  await staffReviews.appeal(payload);
  expect(apiClient.post).toHaveBeenCalledWith('/portal/review-appeals', payload);
  await staffReviews.resolveAppeal('appeal', { outcome: 'UPHELD', reason: 'Policy applies' });
  expect(apiClient.post).toHaveBeenCalledWith('/admin/review-appeals/appeal/resolve', { outcome: 'UPHELD', reason: 'Policy applies' });
  await staffReviews.legalHold('review', true);
  expect(apiClient.patch).toHaveBeenCalledWith('/admin/review-appeals/reviews/review/legal-hold', { held: true });
});
it('uses the profile revision and decision endpoints', async () => {
  const profile = { brandName: 'Brand' };
  await staffReviews.ownProfiles(); await staffReviews.submitProfile(profile); await staffReviews.adminProfiles('insurer');
  await staffReviews.decideProfile('insurer', 'revision', { decision: 'APPROVE', reason: 'Verified' });
  expect(apiClient.get).toHaveBeenCalledWith('/insurer/profile/revisions');
  expect(apiClient.post).toHaveBeenCalledWith('/insurer/profile/revisions', profile);
  expect(apiClient.get).toHaveBeenCalledWith('/admin/insurer-profiles/insurer/revisions');
  expect(apiClient.post).toHaveBeenCalledWith('/admin/insurer-profiles/insurer/revisions/revision/decision', { decision: 'APPROVE', reason: 'Verified' });
});
it('does not send requests or simulate success in mock mode', async () => {
  env.apiMode = 'mock';
  await expect(staffReviews.respond('review', 'Reply')).rejects.toThrow('require a connected API');
  expect(apiClient.put).not.toHaveBeenCalled();
});
