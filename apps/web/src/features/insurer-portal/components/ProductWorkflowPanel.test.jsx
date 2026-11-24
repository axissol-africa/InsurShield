import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProductWorkflowPanel from './ProductWorkflowPanel';

const REASONS = [
  { code: 'OUTSIDE_APPETITE', customerText: 'Not offered for your vehicle right now.', internalText: 'Outside appetite' },
  { code: 'VEHICLE_NOT_ELIGIBLE', customerText: 'Your vehicle does not meet the rules.', internalText: 'Vehicle not eligible' },
];

const fakeApi = () => ({
  quotes: {
    declineReasons: vi.fn().mockResolvedValue(REASONS),
    decline: vi.fn().mockResolvedValue({ status: 'DECLINED' }),
    requestInformation: vi.fn().mockResolvedValue({ status: 'VERIFICATION_REQUIRED' }),
    notes: vi.fn().mockResolvedValue([{ id: 'n1', body: 'Earlier note.', author: 'Mutale Banda', createdAt: '2026-11-20T09:00:00.000Z' }]),
    addNote: vi.fn().mockResolvedValue({ id: 'n2', body: 'New note.', author: 'Mutale Banda', createdAt: '2026-11-21T09:00:00.000Z' }),
    claim: vi.fn().mockResolvedValue({}),
    assign: vi.fn().mockResolvedValue({}),
    setPriority: vi.fn().mockResolvedValue({}),
  },
  staff: {
    listUsers: vi.fn().mockResolvedValue([
      { id: 's1', fullName: 'Mutale Banda', role: 'Quote officer', isActive: true },
      { id: 's2', fullName: 'Chanda Phiri', role: 'Claims and NCD officer', isActive: true },
      { id: 's3', fullName: 'Inactive Officer', role: 'Quote officer', isActive: false },
    ]),
  },
});

const request = (workflow) => ({ id: 'QR-9', productVersionId: 'pv-9', productName: 'Essential', workflow: { informationRequests: [], ...workflow } });

function show(workflow = { status: 'SUBMITTED' }, session = { id: 'me', staffRole: 'QUOTE_OFFICER' }) {
  const api = fakeApi();
  const onChanged = vi.fn().mockResolvedValue(undefined);
  render(<ProductWorkflowPanel request={request(workflow)} api={api} onChanged={onChanged} session={session} />);
  return { api, onChanged };
}

beforeEach(() => vi.clearAllMocks());

describe('ProductWorkflowPanel', () => {
  it('declines with an approved reason and shows the customer wording before it is sent', async () => {
    const user = userEvent.setup();
    const { api, onChanged } = show();

    await user.click(screen.getByRole('button', { name: 'Decline this product' }));
    const form = screen.getByRole('form', { name: 'Decline this product' });
    const send = within(form).getByRole('button', { name: 'Decline product' });
    expect(send).toBeDisabled();

    await user.selectOptions(await within(form).findByLabelText('Reason *'), 'VEHICLE_NOT_ELIGIBLE');
    expect(within(form).getByText('The customer will read: “Your vehicle does not meet the rules.”')).toBeVisible();
    await user.type(within(form).getByLabelText('Note to the customer'), 'Under 15 years only.');
    await user.type(within(form).getByLabelText('Internal note'), 'Rebuilt chassis.');
    await user.click(send);

    expect(api.quotes.decline).toHaveBeenCalledWith('QR-9', 'pv-9', {
      reasonCode: 'VEHICLE_NOT_ELIGIBLE',
      customerNote: 'Under 15 years only.',
      internalNote: 'Rebuilt chassis.',
    });
    expect(onChanged).toHaveBeenCalledWith('declined');
  });

  it('asks the customer a question with the days they have to answer', async () => {
    const user = userEvent.setup();
    const { api, onChanged } = show({ status: 'INSURER_PROCESSING' });

    await user.click(screen.getByRole('button', { name: 'Ask the customer' }));
    const form = screen.getByRole('form', { name: 'Ask the customer' });
    await user.type(within(form).getByLabelText('What do you need from the customer? *'), 'Please send the odometer reading.');
    await user.clear(within(form).getByLabelText('Days to answer'));
    await user.type(within(form).getByLabelText('Days to answer'), '5');
    await user.click(within(form).getByRole('button', { name: 'Send question' }));

    expect(api.quotes.requestInformation).toHaveBeenCalledWith('QR-9', 'pv-9', { message: 'Please send the odometer reading.', dueInDays: 5 });
    expect(onChanged).toHaveBeenCalledWith('asked');
  });

  it('shows the open question and offers no second one while the customer is being waited for', () => {
    show({
      status: 'VERIFICATION_REQUIRED',
      informationRequests: [{ id: 'q1', message: 'Odometer?', dueAt: '2026-11-25T10:00:00.000Z', answeredAt: null, closedAt: null }],
    });
    expect(screen.getByText('Waiting for the customer to answer')).toBeVisible();
    expect(screen.getByText('“Odometer?”')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Ask the customer' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decline this product' })).toBeVisible();
  });

  it('says why a product waiting for an inspection cannot be quoted', () => {
    show({ status: 'INSPECTION_REQUIRED' });
    expect(screen.getByText('This product needs a vehicle inspection before it can be quoted.')).toBeVisible();
  });

  it('lists the team notes and adds a new one at the top', async () => {
    const user = userEvent.setup();
    const { api } = show();

    expect(await screen.findByText('Earlier note.')).toBeVisible();
    await user.type(screen.getByLabelText('Add a note'), 'New note.');
    await user.click(screen.getByRole('button', { name: 'Save note' }));

    expect(api.quotes.addNote).toHaveBeenCalledWith('QR-9', 'pv-9', 'New note.');
    const items = await screen.findAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('New note.'),
      expect.stringContaining('Earlier note.'),
    ]);
  });

  it('lets an officer take an unowned product, and shows who owns one', async () => {
    const user = userEvent.setup();
    const { api, onChanged } = show();
    expect(screen.getByText('Nobody yet')).toBeVisible();
    expect(screen.queryByLabelText('Assign to')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Take this product' }));
    expect(api.quotes.claim).toHaveBeenCalledWith('QR-9', 'pv-9');
    expect(onChanged).toHaveBeenCalledWith('assigned');
  });

  it("offers the administrator only the active quoting team, and the product's priority", async () => {
    const user = userEvent.setup();
    const { api } = show({ status: 'INSURER_PROCESSING', owner: { id: 'me', name: 'Admin' }, priority: 'NORMAL' }, { id: 'me', staffRole: 'INSURER_ADMIN' });
    expect(screen.getByText('You')).toBeVisible();
    const select = await screen.findByLabelText('Assign to');
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual(['Nobody', 'Mutale Banda']);
    await user.selectOptions(select, 's1');
    expect(api.quotes.assign).toHaveBeenCalledWith('QR-9', 'pv-9', 's1');
    await user.click(screen.getByRole('button', { name: 'Mark as urgent' }));
    expect(api.quotes.setPriority).toHaveBeenCalledWith('QR-9', 'pv-9', 'HIGH');
  });
});
