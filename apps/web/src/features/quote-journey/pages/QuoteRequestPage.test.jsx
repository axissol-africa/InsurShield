import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/store';
import { INSPECTION_SHOTS } from '@/domain/inspection';
import { submitQuoteRequest } from '../submitRequest';
import QuoteRequestPage from './QuoteRequestPage';
import { captureApi } from '@/api/capture';

vi.mock('@/api/capture', () => ({ captureApi: { get: vi.fn() } }));
vi.mock('../submitRequest', () => ({ submitQuoteRequest: vi.fn() }));
vi.mock('../components/InspectionPhotos', () => ({ default: () => <p>Inspection photo controls</p> }));
vi.mock('../components/PhoneHandoff', () => ({ default: () => <p>Phone capture</p> }));
vi.mock('@/lib/device', () => ({ isMobileDevice: () => false }));

beforeEach(() => {
  vi.clearAllMocks();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  useStore.setState({
    vehicleDetails: { make: 'Toyota', model: 'Corolla', year: '2020', plateNumber: 'ABC123' },
    vehicleValue: 100000,
    vehicleUsage: 'Individual',
    insuranceType: 'Comprehensive',
    policyStartDate: new Date().toISOString().slice(0, 10),
    coverageDurationId: '4q',
    matchRtsaAnniversary: false,
    rtsaRegistrationDate: '',
    documents: {},
    customer: { fullName: 'Test Customer', phone: '0970000000', email: 'test@example.com' },
  });
});
afterEach(() => vi.unstubAllGlobals());

function Location() {
  const location = useLocation();
  return (
    <output aria-label="Current route">
      {location.pathname}
      {location.search}
    </output>
  );
}
const renderPage = (route = '/') =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <QuoteRequestPage />
      <Location />
    </MemoryRouter>,
  );

describe('quote request requirements', () => {
  it('blocks an anniversary request without the registration date and preserves the form', async () => {
    useStore.setState({ matchRtsaAnniversary: true, rtsaRegistrationDate: '' });
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /Send request to/ }));
    expect(screen.getByText('Enter the RTSA registration date, or untick the anniversary option.')).toBeVisible();
    expect(screen.getByLabelText('RTSA registration date')).toBeVisible();
    expect(screen.getByLabelText('Full name')).toHaveValue('Test Customer');
    expect(submitQuoteRequest).not.toHaveBeenCalled();
  });

  it('restores a phone capture and carries its code into comparison', async () => {
    const state = useStore.getState();
    captureApi.get.mockResolvedValue({
      journey: {
        vehicleDetails: state.vehicleDetails,
        vehicleValue: 120000,
        vehicleUsage: 'Individual',
        insuranceType: 'ThirdParty',
        coverageDurationId: '4q',
        policyStartDate: state.policyStartDate,
        documents: { whiteBook: 'data:application/pdf;base64,AA==' },
        contact: state.customer,
      },
      photos: Object.fromEntries(INSPECTION_SHOTS.map((shot) => [shot.key, 'data:image/jpeg;base64,AA=='])),
    });
    const user = userEvent.setup();
    renderPage('/quote-request?capture=phone-123');
    expect(await screen.findByText('Third party only')).toBeVisible();
    expect(useStore.getState().vehicleValue).toBe(120000);
    await user.click(screen.getByRole('checkbox', { name: /I confirm/ }));
    await user.click(screen.getByRole('button', { name: /Send request to/ }));
    await waitFor(() =>
      expect(screen.getByLabelText('Current route')).toHaveTextContent('/quotes-comparison?capture=phone-123'),
    );
    expect(submitQuoteRequest).toHaveBeenCalledTimes(1);
  });

  it('shows recovery when the phone link cannot be restored', async () => {
    captureApi.get.mockRejectedValue(new Error('This capture link expired.'));
    renderPage('/quote-request?capture=expired');
    expect(await screen.findByText('This capture link expired.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Start a quote' })).toBeVisible();
  });

  it('clears a stale browser-only White Book URL and asks for a durable upload', async () => {
    useStore.setState({ documents: { whiteBook: 'blob:old-session' } });
    renderPage();
    await waitFor(() => expect(useStore.getState().documents.whiteBook).toBeNull());
    expect(screen.getByText('Upload an image or PDF to verify vehicle ownership.')).toBeVisible();
  });

  it('blocks sending without ownership documents, photos and consent', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /Send request to/ }));
    expect(screen.getByText('Add your White Book so insurers can verify ownership.')).toBeVisible();
    expect(screen.getByText('Capture 7 more inspection photos.')).toBeVisible();
    expect(screen.getByText('Accept the declaration to send your request.')).toBeVisible();
    expect(submitQuoteRequest).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/White Book/)).toHaveFocus();
  });

  it('requires consent even when all seven photos and the White Book are present', async () => {
    useStore.setState({
      documents: {
        whiteBook: 'data:application/pdf;base64,AA==',
        ...Object.fromEntries(INSPECTION_SHOTS.map((shot) => [shot.key, 'data:image/jpeg;base64,AA=='])),
      },
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /Send request to/ }));
    expect(screen.getByText('Accept the declaration to send your request.')).toBeVisible();
    expect(submitQuoteRequest).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: /I confirm/ })).toHaveFocus();
    await user.click(screen.getByRole('checkbox', { name: /I confirm/ }));
    await user.click(screen.getByRole('button', { name: /Send request to/ }));
    expect(submitQuoteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: { fullName: 'Test Customer', phone: '0970000000', email: 'test@example.com' },
      }),
    );
  });
});
