import { beforeEach, expect, it, vi } from 'vitest';
import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import { useStore } from '@/store';
const render = (ui) => { const view = rtlRender(ui); fireEvent.click(screen.getByRole('button', { name: 'Manage review' })); return view; };
import userEvent from '@testing-library/user-event';
import { api } from '@/api';
import PolicyReview from './PolicyReview';
vi.mock('@/api', () => ({ api: { reviews: { forPolicy: vi.fn(), submit: vi.fn(), edit: vi.fn(), withdraw: vi.fn() }, reviewAppeals: { list: vi.fn(), submit: vi.fn() } } }));
const eligible = { canSubmit: true, canEdit: false, canWithdraw: false, review: null };
const revision = { id: 'rev', status: 'REJECTED', rating: 3, text: 'Latest draft', reason: 'Remove personal details' };
const editable = { canSubmit: false, canEdit: true, canWithdraw: true, review: { status: 'PUBLISHED', pending: revision, published: { rating: 4, text: 'Original approved review' } } };
beforeEach(() => { vi.resetAllMocks(); useStore.setState({ customer: { email: 'customer@example.com' }, leaving: false }); api.reviews.forPolicy.mockResolvedValue(eligible); });
it('loads authoritative eligibility and requires a whole star before submitting', async () => {
  const user = userEvent.setup();
  api.reviews.submit.mockResolvedValue({ ...eligible, canSubmit: false, review: { status: 'PENDING', pending: { ...revision, status: 'PENDING' } } });
  render(<PolicyReview policyNumber="POL-1" />);
  expect(screen.getByText('Loading review eligibility…')).toBeVisible();
  expect(await screen.findByRole('button', { name: 'Submit review' })).toBeDisabled();
  await user.click(screen.getByRole('radio', { name: '5 stars' }));
  await user.type(screen.getByLabelText('Written review (optional)'), 'Helpful service');
  await user.click(screen.getByRole('button', { name: 'Submit review' }));
  expect(api.reviews.submit).toHaveBeenCalledWith('POL-1', { rating: 5, text: 'Helpful service' });
  expect(await screen.findByText('Your review has been sent for moderation.')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Submit review' })).not.toBeInTheDocument();
});
it('keeps rejected latest text separate from published text and preserves edits after failure', async () => {
  const user = userEvent.setup(); api.reviews.forPolicy.mockResolvedValue(editable); api.reviews.edit.mockRejectedValue(new Error('Try again later'));
  render(<PolicyReview policyNumber="POL-1" />);
  expect(await screen.findByText('Original approved review')).toBeVisible();
  expect(screen.getByText('Moderation reason: Remove personal details')).toBeVisible();
  await user.type(screen.getByLabelText('Written review (optional)'), ' updated');
  await user.click(screen.getByRole('button', { name: 'Submit edited review' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Try again later');
  expect(screen.getByLabelText('Written review (optional)')).toHaveValue('Latest draft updated');
  expect(api.reviews.edit).toHaveBeenCalledWith('POL-1', { rating: 3, text: 'Latest draft updated' });
});
it('requires confirmation for withdrawal and updates permissions from the response', async () => {
  const user = userEvent.setup(); api.reviews.forPolicy.mockResolvedValue(editable);
  api.reviews.withdraw.mockResolvedValue({ ...eligible, canSubmit: false, review: { status: 'WITHDRAWN' } });
  render(<PolicyReview policyNumber="POL-1" />);
  await user.click(await screen.findByRole('button', { name: 'Withdraw review' }));
  expect(api.reviews.withdraw).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Confirm withdrawal' }));
  expect(await screen.findByText('Your review has been withdrawn.')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Withdraw review' })).not.toBeInTheDocument();
});
it('retries eligibility failures and does not invent eligibility', async () => {
  const user = userEvent.setup(); api.reviews.forPolicy.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ ...eligible, canSubmit: false });
  render(<PolicyReview policyNumber="POL-1" />);
  await user.click(await screen.findByRole('button', { name: 'Retry review' }));
  expect(await screen.findByText('This policy is not currently eligible for a review.')).toBeVisible();
  expect(screen.queryByRole('radio')).not.toBeInTheDocument();
});
it('does not load reviews until opened and aborts the request when closed', async () => {
  const user = userEvent.setup();
  api.reviews.forPolicy.mockReturnValue(new Promise(() => {}));
  rtlRender(<PolicyReview policyNumber="POL-1" />);
  expect(api.reviews.forPolicy).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Manage review' }));
  const signal = api.reviews.forPolicy.mock.calls[0][1].signal;
  expect(signal.aborted).toBe(false);
  await user.click(screen.getByRole('button', { name: 'Close review' }));
  expect(signal.aborted).toBe(true);
  expect(screen.queryByText('Loading review eligibility…')).not.toBeInTheDocument();
});
it('discards private state when the authenticated account changes', async () => {
  api.reviews.forPolicy.mockResolvedValueOnce(editable).mockReturnValueOnce(new Promise(() => {}));
  render(<PolicyReview policyNumber="POL-1" />);
  await screen.findByText('Original approved review');
  const { act } = await import('@testing-library/react');
  act(() => useStore.setState({ customer: { email: 'other@example.com' } }));
  expect(screen.queryByText('Original approved review')).not.toBeInTheDocument();
  expect(screen.getByText('Loading review eligibility…')).toBeVisible();
});

it.each(['PUBLISHED', 'PENDING', 'REJECTED', 'WITHDRAWN'])('keeps earlier appeal outcomes visible when latest status is %s', async (status) => {
  api.reviews.forPolicy.mockResolvedValue({ ...editable, review: { ...editable.review, id: 'review', status, withdrawnAt: status === 'WITHDRAWN' ? '2026-11-26' : null, pending: { ...revision, status, decisionId: 'new-decision' } } });
  api.reviewAppeals.list.mockResolvedValue([{ id: 'appeal', decisionId: 'old-decision', party: 'CUSTOMER', outcome: 'OVERTURNED', outcomeReason: 'Earlier appeal explanation', dueAt: '2026-12-10' }]);
  render(<PolicyReview policyNumber="POL-1" />);
  expect(await screen.findByText('Earlier appeal explanation')).toBeVisible();
  expect(api.reviewAppeals.list).toHaveBeenCalledWith(expect.objectContaining({ params: { reviewId: 'review' } }));
  if (status === 'REJECTED') expect(screen.getByRole('button', { name: 'Submit appeal' })).toBeDisabled();
  else expect(screen.queryByRole('button', { name: 'Submit appeal' })).not.toBeInTheDocument();
});
