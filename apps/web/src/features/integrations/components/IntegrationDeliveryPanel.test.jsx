import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import IntegrationDeliveryPanel from './IntegrationDeliveryPanel';

const failedDelivery = {
  id: 'delivery-1', insurerId: 'insurer-1', targetKind: 'INSURER_API', kind: 'PAYMENT_CONFIRMATION', referenceId: 'PAY-100',
  correlationId: 'QR-100', attempt: 5, maxAttempts: 5, status: 'FAILED', error: 'The insurer API could not be reached.',
  lastAttemptAt: '2026-11-18T09:30:00.000Z', createdAt: '2026-11-18T09:00:00.000Z', requestHash: 'not-rendered',
};

describe('IntegrationDeliveryPanel', () => {
  it('shows only safe delivery metadata and records an authorised manual fallback', async () => {
    const manualFallback = vi.fn().mockResolvedValue(undefined);
    const api = { integrations: { list: vi.fn().mockResolvedValue([failedDelivery]), manualFallback } };
    const user = userEvent.setup();
    render(<IntegrationDeliveryPanel api={api} />);

    expect(await screen.findByText('Payment Confirmation')).toBeVisible();
    expect(screen.getByText('Needs attention').parentElement).toHaveTextContent('1');
    expect(screen.queryByText('not-rendered')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Record manual fallback' }));
    await user.type(screen.getByLabelText('Manual completion note'), 'Completed through the insurer operations desk.');
    await user.click(screen.getByRole('button', { name: 'Confirm manual fallback' }));

    await waitFor(() => expect(manualFallback).toHaveBeenCalledWith('delivery-1', 'Completed through the insurer operations desk.'));
    expect(api.integrations.list).toHaveBeenCalledTimes(2);
  });

  it('keeps insurer delivery activity read-only and scoped to its API endpoint', async () => {
    const api = {
      integrations: {
        listForInsurer: vi.fn().mockResolvedValue([failedDelivery]),
        manualFallback: vi.fn(),
      },
    };
    render(<IntegrationDeliveryPanel api={api} scope="insurer" />);

    expect(await screen.findByRole('heading', { name: 'Integration activity' })).toBeVisible();
    expect(api.integrations.listForInsurer).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Record manual fallback' })).not.toBeInTheDocument();
  });
});
