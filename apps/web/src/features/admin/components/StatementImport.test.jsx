import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StatementImport from './StatementImport';

const client = (imported) => ({
  admin: {
    reconciliation: {
      listStatements: vi.fn().mockResolvedValue([]),
      importStatement: imported,
      standInStatement: vi.fn(),
    },
  },
});

async function fill(form) {
  await userEvent.type(within(form).getByLabelText('From *'), '2026-10-01');
  await userEvent.type(within(form).getByLabelText('To (inclusive) *'), '2026-10-31');
  await userEvent.upload(within(form).getByLabelText('Statement file *'), new File(['type,provider_payment_id\n'], 'october.csv', { type: 'text/csv' }));
}

describe('StatementImport', () => {
  it('imports a statement for whole Lusaka days and says what it found', async () => {
    const importStatement = vi.fn().mockResolvedValue({ newLines: 3, matched: 2, itemsOpened: 1, replayed: false });
    const onImported = vi.fn();
    render(<StatementImport api={client(importStatement)} onImported={onImported} />);
    const form = screen.getByRole('form', { name: 'Import a provider statement' });
    await fill(form);
    await userEvent.click(within(form).getByRole('button', { name: 'Import' }));
    expect(importStatement).toHaveBeenCalledWith({
      fileName: 'october.csv',
      periodStart: '2026-09-30T22:00:00.000Z',
      periodEnd: '2026-10-31T22:00:00.000Z',
      csv: 'type,provider_payment_id\n',
    });
    expect(await within(form).findByRole('status')).toHaveTextContent('3 new lines: 2 matched, 1 items opened for review.');
    expect(onImported).toHaveBeenCalled();
  });

  it('lists every bad line when the file is refused', async () => {
    const refused = Object.assign(new Error('The statement could not be read.'), {
      code: 'STATEMENT_INVALID',
      details: { lines: ['Line 2: amount must be a positive number in kwacha, to the ngwee.'] },
    });
    render(<StatementImport api={client(vi.fn().mockRejectedValue(refused))} />);
    const form = screen.getByRole('form', { name: 'Import a provider statement' });
    await fill(form);
    await userEvent.click(within(form).getByRole('button', { name: 'Import' }));
    const alert = await within(form).findByRole('alert');
    expect(alert).toHaveTextContent('Nothing was imported.');
    expect(alert).toHaveTextContent('Line 2: amount must be a positive number');
  });
});
