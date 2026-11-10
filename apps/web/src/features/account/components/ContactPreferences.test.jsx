import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '@/api';
import ContactPreferences from './ContactPreferences';

vi.mock('@/api', () => ({
  api: { contactPreferences: { read: vi.fn(), save: vi.fn() } },
}));

const marketingEmail = () => screen.getByLabelText('Email', { selector: '#pref-MARKETING-EMAIL' });

beforeEach(() => {
  vi.clearAllMocks();
  api.contactPreferences.read.mockResolvedValue({ preferences: [], marketingConsent: false });
  api.contactPreferences.save.mockResolvedValue(undefined);
});

it('shows a customer who has chosen nothing as receiving everything', async () => {
  render(<ContactPreferences />);

  await waitFor(() => expect(marketingEmail()).toBeChecked());
});

it('cannot switch off a notice that is how somebody learns what happened', async () => {
  render(<ContactPreferences />);
  await waitFor(() => expect(marketingEmail()).toBeInTheDocument());

  const paymentEmail = screen.getByLabelText('Email', { selector: '#pref-PAYMENT-EMAIL' });
  expect(paymentEmail).toBeChecked();
  expect(paymentEmail).toBeDisabled();
  expect(screen.getAllByText('Always sent').length).toBeGreaterThan(0);
});

it('saves a marketing choice for the channel it was made on', async () => {
  render(<ContactPreferences />);
  await waitFor(() => expect(marketingEmail()).toBeInTheDocument());

  await userEvent.click(marketingEmail());

  expect(api.contactPreferences.save).toHaveBeenCalledWith({
    category: 'MARKETING',
    channel: 'EMAIL',
    enabled: false,
  });
  await waitFor(() => expect(marketingEmail()).not.toBeChecked());
});

it('puts the switch back when the save fails, rather than showing a choice nobody kept', async () => {
  api.contactPreferences.save.mockRejectedValue(new Error('offline'));
  render(<ContactPreferences />);
  await waitFor(() => expect(marketingEmail()).toBeInTheDocument());

  await userEvent.click(marketingEmail());

  await waitFor(() => expect(marketingEmail()).toBeChecked());
  expect(screen.getByText('That change was not saved. Try again.')).toBeInTheDocument();
});

it('reflects a choice already saved', async () => {
  api.contactPreferences.read.mockResolvedValue({
    preferences: [{ category: 'MARKETING', channel: 'EMAIL', enabled: false }],
    marketingConsent: false,
  });
  render(<ContactPreferences />);

  await waitFor(() => expect(marketingEmail()).not.toBeChecked());
  // The other channel is untouched by a choice made on this one.
  expect(screen.getByLabelText('In InsurShield', { selector: '#pref-MARKETING-IN_APP' })).toBeChecked();
});

it('says so when the preferences cannot be loaded', async () => {
  api.contactPreferences.read.mockRejectedValue(new Error('offline'));
  render(<ContactPreferences />);

  expect(await screen.findByText('Your preferences could not be loaded.')).toBeInTheDocument();
});
