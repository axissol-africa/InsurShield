import { apiClient } from '@/lib/apiClient';
import { env } from '@/config/env';

// Staff-owned transport: keep shared customer/public adapters untouched.
const request = (operation) => env.apiMode === 'http'
  ? operation()
  : Promise.reject(new Error('Staff reviews and profile approval require a connected API.'));
const id = encodeURIComponent;
export const staffReviews = {
  listAdmin: ({ page, status }) => request(() => apiClient.get('/reviews/admin', { params: { page, status } })),
  decide: (reviewId, decision) => request(() => apiClient.post(`/reviews/admin/${id(reviewId)}/decisions`, decision)),
  listInsurer: ({ page }) => request(() => apiClient.get('/reviews/insurer', { params: { page } })),
  respond: (reviewId, text) => request(() => apiClient.put(`/reviews/insurer/${id(reviewId)}/response`, { text })),
  listAppeals: (admin, page) => request(() => {
    const path = admin ? '/admin/review-appeals' : '/portal/review-appeals';
    return page ? apiClient.get(path, { params: { page } }) : apiClient.get(path);
  }),
  appeal: (payload) => request(() => apiClient.post('/portal/review-appeals', payload)),
  resolveAppeal: (appealId, payload) => request(() => apiClient.post(`/admin/review-appeals/${id(appealId)}/resolve`, payload)),
  legalHold: (reviewId, held) => request(() => apiClient.patch(`/admin/review-appeals/reviews/${id(reviewId)}/legal-hold`, { held })),
  ownProfiles: () => request(() => apiClient.get('/insurer/profile/revisions')),
  submitProfile: (profile) => request(() => apiClient.post('/insurer/profile/revisions', profile)),
  adminProfiles: (insurerId) => request(() => apiClient.get(`/admin/insurer-profiles/${id(insurerId)}/revisions`)),
  decideProfile: (insurerId, revisionId, decision) => request(() => apiClient.post(`/admin/insurer-profiles/${id(insurerId)}/revisions/${id(revisionId)}/decision`, decision)),
};
