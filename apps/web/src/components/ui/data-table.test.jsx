import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { DataTable } from './data-table';

const columns = [
  { accessorKey: 'name', header: 'Customer' },
  { accessorKey: 'premium', header: 'Premium' },
];
const data = [
  { id: 'c', name: 'Chipo', premium: 900 },
  { id: 'a', name: 'Alice', premium: 1100 },
  { id: 'b', name: 'Banda', premium: 200 },
];
const names = () => within(screen.getByRole('table', { name: 'Quotes' })).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0].textContent);

describe('DataTable', () => {
  it('sorts rows through named headers and reports the sort direction', async () => {
    const user = userEvent.setup();
    render(<DataTable columns={columns} data={data} label="Quotes" />);
    await user.click(screen.getByRole('button', { name: 'Customer', exact: true }));
    expect(names()).toEqual(['Alice', 'Banda', 'Chipo']);
    expect(screen.getByRole('columnheader', { name: 'Customer' })).toHaveAttribute('aria-sort', 'ascending');
    await user.click(screen.getByRole('button', { name: 'Customer', exact: true }));
    expect(names()).toEqual(['Chipo', 'Banda', 'Alice']);
    expect(screen.getByRole('columnheader', { name: 'Customer' })).toHaveAttribute('aria-sort', 'descending');
  });

  it('paginates and keeps remaining rows visible when data shrinks', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<DataTable columns={columns} data={data} label="Quotes" pageSize={2} />);
    expect(names()).toEqual(['Chipo', 'Alice']);
    expect(screen.getByRole('button', { name: 'Previous page of Quotes' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next page of Quotes' }));
    expect(names()).toEqual(['Banda']);
    expect(screen.getByRole('button', { name: 'Next page of Quotes' })).toBeDisabled();
    rerender(<DataTable columns={columns} data={[data[0]]} label="Quotes" pageSize={2} />);
    expect(names()).toEqual(['Chipo']);
    expect(screen.getByText('Page 1 of 1')).toBeVisible();
  });

  it('sorts numeric values across pages and returns to the first page', async () => {
    const user = userEvent.setup();
    render(<DataTable columns={columns} data={data} label="Quotes" pageSize={2} />);
    await user.click(screen.getByRole('button', { name: 'Next page of Quotes' }));
    await user.click(screen.getByRole('button', { name: 'Premium', exact: true }));
    expect(names()).toEqual(['Alice', 'Chipo']);
    expect(screen.getByText('Page 1 of 2')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Premium', exact: true }));
    expect(names()).toEqual(['Banda', 'Chipo']);
  });

  it('shows the supplied empty state without an invalid page', () => {
    render(<DataTable columns={columns} data={[]} label="Quotes" emptyMessage="No pending quotes." />);
    expect(screen.getByText('No pending quotes.')).toBeVisible();
    expect(screen.getByText('0 results')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Next page of Quotes' })).toBeDisabled();
  });

  describe('on a narrow screen', () => {
    const wide = window.innerWidth;
    const card = (row) => <p>{row.name} pays {row.premium}</p>;
    const narrow = () => { window.innerWidth = 375; };
    afterEach(() => { window.innerWidth = wide; });

    it('stacks each row as a card when the caller says how, keeping the pages', async () => {
      const user = userEvent.setup();
      narrow();
      render(<DataTable columns={columns} data={data} label="Quotes" pageSize={2} renderCard={card} />);

      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      const list = screen.getByRole('list', { name: 'Quotes' });
      expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Chipo pays 900', 'Alice pays 1100']);
      await user.click(screen.getByRole('button', { name: 'Next page of Quotes' }));
      expect(within(screen.getByRole('list', { name: 'Quotes' })).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Banda pays 200']);
    });

    it('shows the empty state in place of the cards', () => {
      narrow();
      render(<DataTable columns={columns} data={[]} label="Quotes" emptyMessage="No pending quotes." renderCard={card} />);
      expect(screen.getByText('No pending quotes.')).toBeVisible();
      expect(screen.queryByRole('list')).not.toBeInTheDocument();
    });

    it('stays a table when the caller gives no card', () => {
      narrow();
      render(<DataTable columns={columns} data={data} label="Quotes" />);
      expect(screen.getByRole('table', { name: 'Quotes' })).toBeVisible();
    });
  });

  it('stays a table on a wide screen even when a card is available', () => {
    render(<DataTable columns={columns} data={data} label="Quotes" renderCard={(row) => <p>{row.name}</p>} />);
    expect(names()).toEqual(['Chipo', 'Alice', 'Banda']);
  });
});
