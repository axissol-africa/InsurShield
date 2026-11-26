import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useStore } from '@/store';
import AdminReviews from './AdminReviews';
import InsurerReviews from './InsurerReviews';
import Appeals, { AppealForm } from './Appeals';
import StaffProfiles from './StaffProfiles';
import LegalHold from './LegalHold';

const review = { id: 'revision-1', reviewId: 'review-1', kind: 'REVIEW', rating: 4, text: 'Helpful service', status: 'PENDING', createdAt: '2026-11-01T00:00:00Z', insurerName: 'Test insurer' };
const published = { id: 'review-1', rating: 4, text: 'Helpful service', publishedAt: '2026-11-01T00:00:00Z', publicationDecisionId: 'published-decision', response: { text: 'Approved reply' }, latestResponse: null };
const renderStaff = (ui) => render(ui);
const signIn = (staffRole = 'ADMIN') => useStore.setState({ staffSession: { id: 'staff-1', staffRole, insurerId: 'insurer-1' } });
beforeEach(() => { signIn(); });

describe('staff review moderation', () => {
  it('publishes the exact revision with a reason and refreshes the queue', async () => {
    const transport = { listAdmin: vi.fn().mockResolvedValue({ items: [review], hasMore: false, publicationEnabled: true }), decide: vi.fn().mockResolvedValue({ id: review.id, status: 'PUBLISHED' }) };
    const user = userEvent.setup();
    renderStaff(<AdminReviews transport={transport} />);
    await screen.findByText('Helpful service');
    expect(screen.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled();
    await user.selectOptions(screen.getByRole('combobox', { name: /Decision reason/ }), 'APPROVED');
    await user.click(screen.getByRole('button', { name: 'Publish', exact: true }));
    await user.click(screen.getByRole('button', { name: 'Confirm decision' }));
    await waitFor(() => expect(transport.decide).toHaveBeenCalledWith('review-1', { revisionId: 'revision-1', action: 'PUBLISH', reason: 'APPROVED' }));
    await waitFor(() => expect(transport.listAdmin.mock.calls.length).toBeGreaterThan(1));
  });
  it('blocks publication under provisional policy but allows rejection', async () => {
    const transport = { listAdmin: vi.fn().mockResolvedValue({ items: [{ ...review, kind: 'RESPONSE' }], publicationEnabled: false }), decide: vi.fn().mockRejectedValue(new Error('Revision already decided')) };
    const user = userEvent.setup();
    renderStaff(<AdminReviews transport={transport} />);
    await screen.findByText('Insurer response');
    await user.selectOptions(screen.getByRole('combobox', { name: /Decision reason/ }), 'SPAM');
    expect(screen.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Reject', exact: true }));
    await user.click(screen.getByRole('button', { name: 'Confirm decision' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Revision already decided');
    expect(screen.getByRole('alertdialog')).toBeVisible();
  });
  it('paginates and resets the page on status change', async () => {
    const transport = { listAdmin: vi.fn().mockResolvedValue({ items: [], publicationEnabled: true, hasMore: true }) };
    const user = userEvent.setup(); renderStaff(<AdminReviews transport={transport} />);
    await user.click(await screen.findByRole('button', { name: 'Next' }));
    await waitFor(() => expect(transport.listAdmin).toHaveBeenLastCalledWith({ page: 2, status: 'PENDING' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Moderation status' }), 'REMOVED');
    await waitFor(() => expect(transport.listAdmin).toHaveBeenLastCalledWith({ page: 1, status: 'REMOVED' }));
  });
  it.each(['FINANCE', 'UNDERWRITER', 'INSURER_ADMIN', undefined])('does not fetch moderation for %s', (role) => {
    signIn(role); if (role === undefined) useStore.setState({ staffSession: {} });
    const transport = { listAdmin: vi.fn() }; renderStaff(<AdminReviews transport={transport} />);
    expect(screen.getByRole('alert')).toHaveTextContent('restricted'); expect(transport.listAdmin).not.toHaveBeenCalled();
  });
  it('retries a failed load', async () => {
    const transport = { listAdmin: vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValue({ items: [review], publicationEnabled: true }) };
    const user = userEvent.setup(); renderStaff(<AdminReviews transport={transport} />);
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    await screen.findByText('Helpful service');
  });
});

describe('insurer replies and appeals', () => {
  beforeEach(() => signIn('INSURER_ADMIN'));
  it('keeps approved response visible and preserves the draft after a failure', async () => {
    const transport = { listInsurer: vi.fn().mockResolvedValue({ items: [published], hasMore: false }), respond: vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValue({ id: 'response-1' }) };
    const user = userEvent.setup(); renderStaff(<InsurerReviews transport={transport} />);
    const text = await screen.findByRole('textbox', { name: 'Your response' });
    await user.clear(text); await user.type(text, 'Updated reply');
    await user.click(screen.getByRole('button', { name: 'Submit response' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
    expect(text).toHaveValue('Updated reply'); expect(screen.getByText('Approved reply')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Submit response' }));
    await waitFor(() => expect(transport.respond).toHaveBeenLastCalledWith('review-1', 'Updated reply'));
    await waitFor(() => expect(transport.listInsurer.mock.calls.length).toBeGreaterThan(1));
  });
  it('does not allow another submission while a response is pending', async () => {
    const transport = { listInsurer: vi.fn().mockResolvedValue({ items: [{ ...published, latestResponse: { id: 'pending', text: 'Pending edit', status: 'PENDING' } }] }) };
    renderStaff(<InsurerReviews transport={transport} />);
    expect(await screen.findByRole('button', { name: 'Awaiting moderation' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Your response' })).toHaveValue('Pending edit');
    expect(screen.getByText('Approved reply')).toBeVisible();
  });
  it('submits an appeal against the publication decision', async () => {
    const transport = { listInsurer: vi.fn().mockResolvedValue({ items: [published] }), appeal: vi.fn().mockResolvedValue({ id: 'appeal' }) };
    const user = userEvent.setup(); renderStaff(<InsurerReviews transport={transport} />);
    await user.click(await screen.findByText('Appeal review publication'));
    await user.type(screen.getByRole('textbox', { name: 'Private appeal reason' }), 'Contains identifying information');
    await user.click(screen.getByRole('button', { name: 'Submit appeal' }));
    await waitFor(() => expect(transport.appeal).toHaveBeenCalledWith({ decisionId: 'published-decision', reason: 'Contains identifying information' }));
  });
  it('keeps appeal evidence after a failed submission', async () => {
    const transport = { appeal: vi.fn().mockRejectedValue(new Error('Decision no longer appealable')) };
    const user = userEvent.setup(); renderStaff(<AppealForm decisionId="decision-1" transport={transport} />);
    await user.type(screen.getByRole('textbox', { name: 'Private appeal reason' }), 'Please reconsider');
    await user.type(screen.getByRole('textbox', { name: 'Supporting evidence (optional)' }), 'Private evidence');
    await user.click(screen.getByRole('button', { name: 'Submit appeal' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no longer appealable');
    expect(screen.getByRole('textbox', { name: 'Supporting evidence (optional)' })).toHaveValue('Private evidence');
  });
  it('denies non-administrator insurer staff before loading', () => {
    signIn('FINANCE'); const transport = { listInsurer: vi.fn() }; renderStaff(<InsurerReviews transport={transport} />);
    expect(screen.getByRole('alert')).toHaveTextContent('restricted'); expect(transport.listInsurer).not.toHaveBeenCalled();
  });
});

it('shows independent-moderator errors without losing the resolution reason', async () => {
  const transport = { listAppeals: vi.fn().mockResolvedValue([{ id: 'appeal-1', reason: 'Please reconsider', dueAt: '2026-12-01', party: 'INSURER' }]), resolveAppeal: vi.fn().mockRejectedValue(new Error('A different moderator must decide the appeal.')) };
  const user = userEvent.setup(); renderStaff(<Appeals admin transport={transport} />);
  await user.selectOptions(await screen.findByRole('combobox', { name: 'Appeal outcome' }), 'UPHELD');
  await user.type(screen.getByRole('textbox', { name: 'Outcome reason' }), 'Policy applies');
  await user.click(screen.getByRole('button', { name: 'Resolve appeal' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('different moderator');
  expect(transport.resolveAppeal).toHaveBeenCalledWith('appeal-1', { outcome: 'UPHELD', reason: 'Policy applies' });
  expect(screen.getByRole('textbox', { name: 'Outcome reason' })).toHaveValue('Policy applies');
});
it('applies and releases a review legal hold through the authenticated transport', async () => {
  const transport = { legalHold: vi.fn().mockImplementation(async (reviewId, held) => ({ reviewId, held })) };
  const user = userEvent.setup(); renderStaff(<LegalHold reviewId="review-1" transport={transport} />);
  await user.selectOptions(screen.getByRole('combobox', { name: 'Review retention' }), 'hold');
  await user.click(screen.getByRole('button', { name: 'Confirm retention change' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Legal hold applied');
  await user.selectOptions(screen.getByRole('combobox', { name: 'Review retention' }), 'release');
  await user.click(screen.getByRole('button', { name: 'Confirm retention change' }));
  await waitFor(() => expect(transport.legalHold).toHaveBeenLastCalledWith('review-1', false));
});
it('submits a complete profile and retains the approved profile during moderation', async () => {
  signIn('INSURER_ADMIN');
  const profile = { brandName: 'Insurer', description: 'Approved description', serviceInformation: 'Call us' };
  const transport = { ownProfiles: vi.fn().mockResolvedValue([{ id: 'profile-1', versionNumber: 1, status: 'APPROVED', profile }]), submitProfile: vi.fn().mockResolvedValue({ id: 'profile-2' }) };
  const user = userEvent.setup(); renderStaff(<StaffProfiles transport={transport} />);
  const input = await screen.findByRole('textbox', { name: 'Brand name (required)' });
  await user.clear(input); await user.type(input, 'New brand');
  await user.click(screen.getByRole('button', { name: 'Submit profile for approval' }));
  await waitFor(() => expect(transport.submitProfile).toHaveBeenCalledWith({ ...profile, brandName: 'New brand', contactEmail: null, contactPhone: null, websiteUrl: null, logoUrl: null }));
  expect(screen.getByText('Approved description', { selector: 'dd' })).toBeVisible();
});
it('lets an administrator approve the selected insurer profile revision', async () => {
  const transport = { adminProfiles: vi.fn().mockResolvedValue([{ id: 'profile-1', versionNumber: 1, status: 'PENDING', profile: { brandName: 'Insurer' } }]), decideProfile: vi.fn().mockResolvedValue({ status: 'APPROVED' }) };
  const user = userEvent.setup(); renderStaff(<StaffProfiles admin insurers={[{ id: 'insurer-1', name: 'Insurer' }]} transport={transport} />);
  await user.selectOptions(screen.getByRole('combobox', { name: 'Insurer' }), 'insurer-1');
  await user.selectOptions(await screen.findByRole('combobox', { name: 'Profile decision' }), 'APPROVE');
  await user.type(screen.getByRole('textbox', { name: 'Profile decision reason' }), 'Verified details');
  await user.click(screen.getByRole('button', { name: 'Confirm profile decision' }));
  await waitFor(() => expect(transport.decideProfile).toHaveBeenCalledWith('insurer-1', 'profile-1', { decision: 'APPROVE', reason: 'Verified details' }));
});

it('discards late insurer data and drafts when the identity changes', async () => {
  signIn('INSURER_ADMIN');
  let resolveOld;
  const transport = { listInsurer: vi.fn().mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; })).mockResolvedValue({ items: [], hasMore: false }) };
  renderStaff(<InsurerReviews transport={transport} />);
  await waitFor(() => expect(transport.listInsurer).toHaveBeenCalledTimes(1));
  act(() => useStore.setState({ staffSession: { id: 'staff-2', staffRole: 'INSURER_ADMIN', insurerId: 'insurer-2' } }));
  await screen.findByText('No published customer reviews yet.');
  await act(async () => resolveOld({ items: [published] }));
  expect(screen.queryByText('Helpful service')).not.toBeInTheDocument();
});
it('ignores a slower moderation page after the filter changes', async () => {
  let resolveOld;
  const transport = { listAdmin: vi.fn().mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; })).mockResolvedValue({ items: [], hasMore: false, publicationEnabled: true }) };
  const user = userEvent.setup(); renderStaff(<AdminReviews transport={transport} />);
  await waitFor(() => expect(transport.listAdmin).toHaveBeenCalledTimes(1));
  await user.selectOptions(screen.getByRole('combobox', { name: 'Moderation status' }), 'REMOVED');
  await screen.findByText('No reviews or responses in this view.');
  await act(async () => resolveOld({ items: [review], publicationEnabled: true }));
  expect(screen.queryByText('Helpful service')).not.toBeInTheDocument();
});
it('prevents duplicate response submissions while the first write is pending', async () => {
  signIn('INSURER_ADMIN');
  let finish;
  const transport = { listInsurer: vi.fn().mockResolvedValue({ items: [published] }), respond: vi.fn().mockImplementation(() => new Promise((resolve) => { finish = resolve; })) };
  const user = userEvent.setup(); renderStaff(<InsurerReviews transport={transport} />);
  await user.dblClick(await screen.findByRole('button', { name: 'Submit response' }));
  expect(transport.respond).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Submitting…' })).toBeDisabled();
  await act(async () => finish({ id: 'response' }));
});

it.each([['PUBLISHED', 'Remove', 'REMOVE', 'ABUSE'], ['REMOVED', 'Reinstate', 'REINSTATE', 'APPROVED']])('moderates a %s revision using the allowed transition', async (status, label, action, reason) => {
  const transport = { listAdmin: vi.fn().mockResolvedValue({ items: [{ ...review, status }], publicationEnabled: true }), decide: vi.fn().mockResolvedValue({ status }) };
  const user = userEvent.setup(); renderStaff(<AdminReviews transport={transport} />);
  await screen.findByText('Helpful service');
  await user.selectOptions(screen.getByRole('combobox', { name: /Decision reason/ }), reason);
  await user.click(screen.getByRole('button', { name: label, exact: true }));
  await user.click(screen.getByRole('button', { name: 'Confirm decision' }));
  await waitFor(() => expect(transport.decide).toHaveBeenCalledWith('review-1', { revisionId: 'revision-1', action, reason }));
});
