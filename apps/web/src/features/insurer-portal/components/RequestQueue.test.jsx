import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RequestQueue from './RequestQueue';

const requests = [
  { id: 'REQ-2', vehicle: 'Toyota Hilux', vehicleValue: 250000, value: 'ZMW 250,000', coverage: 'Comprehensive', usage: 'Private', submittedAt: '2026-10-10T10:00:00Z', time: '2 days ago' },
  { id: 'REQ-1', vehicle: 'Ford Ranger', vehicleValue: 180000, value: 'ZMW 180,000', coverage: 'Comprehensive', usage: 'Private', submittedAt: '2026-10-11T10:00:00Z', time: '1 day ago' },
];

const quote = (validUntil) => ({ ...requests[0], reply: { premium: 2500, validUntil } });

describe('RequestQueue', () => {
  it('sends the original request associated with the sorted row', async () => {
    const user = userEvent.setup();
    const onQuote = vi.fn();
    render(<RequestQueue title="Quote requests" requests={requests} onQuote={onQuote} />);

    await user.click(screen.getByRole('button', { name: 'Vehicle / reference' }));
    const rows = within(screen.getByRole('table', { name: 'Quote requests' })).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Ford Ranger');
    await user.click(within(rows[1]).getByRole('button', { name: 'Send quote' }));
    expect(onQuote).toHaveBeenCalledExactlyOnceWith(requests[1]);
  });

  it('disables a pending extension, explains failure, and permits retry', async () => {
    const user = userEvent.setup();
    let rejectExtension;
    const pending = new Promise((_, reject) => { rejectExtension = reject; });
    const onExtend = vi.fn().mockReturnValueOnce(pending).mockResolvedValueOnce(undefined);
    const request = quote(new Date(Date.now() + 7 * 86400000).toISOString());
    render(<RequestQueue title="Quotes sent" requests={[request]} onExtend={onExtend} />);

    await user.click(screen.getByRole('button', { name: 'Extend 7 days' }));
    const extending = screen.getByRole('button', { name: 'Extending…' });
    expect(extending).toBeDisabled();
    expect(extending).toHaveAttribute('aria-busy', 'true');
    expect(onExtend).toHaveBeenCalledExactlyOnceWith(request);

    await act(async () => { rejectExtension(new Error('Network unavailable')); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not extend this quote. Please try again.');
    await user.click(screen.getByRole('button', { name: 'Extend 7 days' }));
    expect(onExtend).toHaveBeenCalledTimes(2);
    expect(onExtend).toHaveBeenLastCalledWith(request);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Extend 7 days' })).toBeEnabled();
  });

  it('keeps an extension in flight when its row leaves the page and comes back', async () => {
    const user = userEvent.setup();
    const onExtend = vi.fn().mockReturnValue(new Promise(() => {}));
    const validUntil = new Date(Date.now() + 7 * 86400000).toISOString();
    const sent = ['A', 'B', 'C', 'D', 'E'].map((letter) => ({ ...quote(validUntil), id: `REQ-${letter}` }));
    render(<RequestQueue title="Quotes sent" requests={sent} onExtend={onExtend} />);
    const firstRow = () => within(screen.getByRole('table', { name: 'Quotes sent' })).getByRole('row', { name: /REQ-A/ });

    await user.click(within(firstRow()).getByRole('button', { name: 'Extend 7 days' }));
    await user.click(screen.getByRole('button', { name: /Next/ }));
    expect(screen.queryByRole('row', { name: /REQ-A/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Previous/ }));

    // A second click here would add a second seven days to the same quote.
    expect(within(firstRow()).getByRole('button', { name: 'Extending…' })).toBeDisabled();
    expect(within(screen.getByRole('table', { name: 'Quotes sent' })).getByRole('row', { name: /REQ-B/ })).toHaveTextContent('Extend 7 days');
    expect(onExtend).toHaveBeenCalledOnce();
  });

  it('keeps an expired quote visible without offering an extension', () => {
    render(<RequestQueue title="Quotes sent" requests={[quote('2000-01-01T00:00:00Z')]} onExtend={vi.fn()} />);
    expect(screen.getByText(/Expired on/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Extend 7 days' })).not.toBeInTheDocument();
  });

  it('says how long is left to reply to a request that is still waiting', () => {
    const waiting = { ...requests[0], expiresAt: new Date(Date.now() + 86_400_000 - 60_000).toISOString() };
    render(<RequestQueue title="Quote requests" requests={[waiting, quote('2030-01-01T00:00:00Z')]} onQuote={vi.fn()} />);

    const rows = within(screen.getByRole('table', { name: 'Quote requests' })).getAllByRole('row');
    expect(rows[1]).toHaveTextContent(/Reply by .* · 1 day left/);
    // A request already answered has no reply left to make.
    expect(rows[2]).not.toHaveTextContent('Reply by');
  });

  describe('on a phone', () => {
    const wide = window.innerWidth;
    afterEach(() => { window.innerWidth = wide; });

    it('stacks each request with its action in reach', async () => {
      window.innerWidth = 375;
      const onQuote = vi.fn();
      render(<RequestQueue title="Quote requests" requests={requests} onQuote={onQuote} />);

      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      const cards = within(screen.getByRole('list', { name: 'Quote requests' })).getAllByRole('listitem');
      for (const text of ['Toyota Hilux', 'REQ-2', 'Comprehensive', 'ZMW 250,000', 'Private', '2 days ago']) expect(cards[0]).toHaveTextContent(text);
      await userEvent.click(within(cards[1]).getByRole('button', { name: 'Send quote' }));
      expect(onQuote).toHaveBeenCalledExactlyOnceWith(requests[1]);
    });

    it('keeps a sent quote’s premium, validity and extension together', () => {
      window.innerWidth = 375;
      render(<RequestQueue title="Quotes sent" requests={[quote(new Date(Date.now() + 7 * 86400000).toISOString())]} onExtend={vi.fn()} />);

      const card = within(screen.getByRole('list', { name: 'Quotes sent' })).getByRole('listitem');
      expect(card).toHaveTextContent('ZMW 2,500.00');
      expect(card).toHaveTextContent(/Valid until/);
      expect(within(card).getByRole('button', { name: 'Extend 7 days' })).toBeVisible();
    });
  });
});
