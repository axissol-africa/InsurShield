import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { downloadJson } from '@/lib/downloadJson';
import PrivacyCard from './PrivacyCard';

vi.mock('@/lib/downloadJson', () => ({ downloadJson: vi.fn() }));

it('downloads the export as a file and says what closing keeps', async () => {
  const data = { profile: { email: 'mwiza@example.com' } };
  const api = { account: { exportData: vi.fn().mockResolvedValue(data) } };
  render(<PrivacyCard api={api} />);

  await userEvent.click(screen.getByRole('button', { name: 'Download my data' }));

  expect(downloadJson).toHaveBeenCalledWith(expect.stringMatching(/^insurshield-my-data-\d{4}-\d{2}-\d{2}\.json$/), data);
  expect(await screen.findByRole('status')).toHaveTextContent('Saved to your device');
  expect(screen.getByText(/kept for as long as the law requires/)).toBeInTheDocument();
});

it('says so when the export fails', async () => {
  const api = { account: { exportData: vi.fn().mockRejectedValue(new Error('Too many downloads. Try again later.')) } };
  render(<PrivacyCard api={api} />);
  await userEvent.click(screen.getByRole('button', { name: 'Download my data' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Too many downloads');
});
