import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import RecordLookup from './RecordLookup';

it('wants a reason before it looks, then shows what the reference names', async () => {
  const api = { support: { findRecord: vi.fn().mockResolvedValue([{ type: 'POLICY', reference: 'POL-1', status: 'ACTIVE', customer: { fullName: 'Bwalya Mutale', phone: '+260970000000' }, insurer: 'Prestige Assurance', createdAt: '2026-11-01T08:00:00.000Z' }]) } };
  render(<RecordLookup api={api} />);
  await userEvent.type(screen.getByLabelText('Reference'), 'POL-1');
  await userEvent.click(screen.getByRole('button', { name: 'Find' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Say why you are looking');
  expect(api.support.findRecord).not.toHaveBeenCalled();

  await userEvent.type(screen.getByLabelText('Why you are looking'), 'Ticket 4411');
  await userEvent.click(screen.getByRole('button', { name: 'Find' }));
  expect(api.support.findRecord).toHaveBeenCalledWith('POL-1', 'Ticket 4411');
  expect(await screen.findByText('Bwalya Mutale · +260970000000')).toBeInTheDocument();
  // The status reads as words, not as the stored code.
  expect(screen.getByText('Active')).toBeInTheDocument();
});
