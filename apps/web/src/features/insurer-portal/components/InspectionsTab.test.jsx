import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InspectionsTab from './InspectionsTab';

const physical = {
  id: 'INS-1', status: 'REQUESTED', statusLabel: 'Requested', purpose: 'UNDERWRITING', method: 'PHYSICAL', stage: 'BEFORE_QUOTATION',
  quoteRequestId: 'QR-1', vehiclePlate: 'BAZ 1301', vehicleLabel: '2020 Toyota Hilux',
  customer: { fullName: 'Mwiza Banda', phone: '0970123456', email: 'mwiza@example.zm' },
  products: [{ productVersionId: 'pv-1', productName: 'Essential', passed: false }],
};
const photos = { ...physical, id: 'INS-2', method: 'SELF_CAPTURE', stage: 'BEFORE_PAYMENT', vehiclePlate: 'BAZ 1302' };
const done = { ...physical, id: 'INS-3', status: 'APPROVED', statusLabel: 'Approved', vehiclePlate: 'BAZ 1303' };

const fakeApi = (list = [physical, photos, done]) => ({
  inspections: {
    listForInsurer: vi.fn().mockResolvedValue(list),
    schedule: vi.fn().mockResolvedValue({}),
    assignInspector: vi.fn().mockResolvedValue({}),
    approve: vi.fn().mockResolvedValue({}),
    fail: vi.fn().mockResolvedValue({}),
    noShow: vi.fn().mockResolvedValue({}),
    cancel: vi.fn().mockResolvedValue({}),
  },
});

const card = (plate) => screen.getByText(plate).closest('[data-slot="card"]');

describe('InspectionsTab', () => {
  it('books a physical inspection before it can be decided, and decides one from photos straight away', async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    render(<InspectionsTab api={api} />);

    const booking = within(await screen.findByRole('region', { name: 'Open inspections' }));
    expect(booking.getAllByText('Essential')[0]).toBeVisible();
    const physicalCard = within(card('BAZ 1301'));
    expect(physicalCard.queryByRole('button', { name: 'Pass' })).not.toBeInTheDocument();
    await user.click(physicalCard.getByRole('button', { name: 'Book' }));
    await user.type(physicalCard.getByLabelText('Date and time *'), '2026-12-01T09:00');
    await user.type(physicalCard.getByLabelText('Where'), 'Cairo Road office');
    await user.click(physicalCard.getByRole('button', { name: 'Save' }));
    expect(api.inspections.schedule).toHaveBeenCalledWith('INS-1', { scheduledDate: new Date('2026-12-01T09:00').toISOString(), location: 'Cairo Road office' });

    const photosCard = within(card('BAZ 1302'));
    await user.click(photosCard.getByRole('button', { name: 'Pass' }));
    expect(api.inspections.approve).toHaveBeenCalledWith('INS-2');
  });

  it('needs a reason to fail an inspection, and offers nothing on a finished one', async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    render(<InspectionsTab api={api} />);

    const photosCard = within(await screen.findByText('BAZ 1302').then((node) => node.closest('[data-slot="card"]')));
    await user.click(photosCard.getByRole('button', { name: 'Fail' }));
    const save = photosCard.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await user.type(photosCard.getByLabelText('Reason, shown to the customer *'), 'Rear bumper damage not declared.');
    await user.click(save);
    expect(api.inspections.fail).toHaveBeenCalledWith('INS-2', 'Rear bumper damage not declared.');

    const finished = within(screen.getByRole('region', { name: 'Finished inspections' }));
    expect(finished.queryByRole('button')).not.toBeInTheDocument();
  });
});

it('requires a published report before passing a claim assessment', async () => {
  const api = fakeApi([{ ...photos, purpose: 'CLAIM_ASSESSMENT', claimNumber: 'CL-1' }]);
  api.inspections.evidence = vi.fn().mockResolvedValue({ preLoss: [], postLoss: [], report: null });
  render(<InspectionsTab api={api} />);
  expect(await screen.findByRole('button', { name: 'Pass' })).toBeDisabled();
  expect(screen.getByRole('link', { name: 'Claim CL-1' })).toHaveAttribute('href', '/insurer?view=claims&claim=CL-1');
});

it('shows the API refusal when purchased terms prevent another attempt', async () => {
  const user = userEvent.setup();
  const api = fakeApi([{ ...physical, purpose: 'AFTER_PAYMENT', status: 'FAILED', statusLabel: 'Failed', policyNumber: 'POL-1' }]);
  api.inspections.evidence = vi.fn().mockResolvedValue({ preLoss: [], postLoss: [], report: null });
  api.inspections.reinspect = vi.fn().mockRejectedValue(new Error('The purchased product does not allow another attempt after a failed inspection.'));
  render(<InspectionsTab api={api} />);
  await user.click(await screen.findByRole('button', { name: 'Start new attempt' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('purchased product does not allow');
  expect(api.inspections.reinspect).toHaveBeenCalledWith('INS-1');
  expect(screen.getByRole('region', { name: 'Finished inspections' })).toHaveTextContent('Failed');
});
