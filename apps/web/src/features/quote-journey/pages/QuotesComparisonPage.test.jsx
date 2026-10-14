import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/store';
import QuotesComparisonPage from './QuotesComparisonPage';

vi.mock('@/api/sync', () => ({ hydrateDirectory: vi.fn(), hydrateCustomer: vi.fn() }));

beforeEach(() => {
  useStore.setState({
    ...useStore.getInitialState(),
    activeQuoteRequestId: 'QR-TEST',
    quoteRequests: [
      {
        id: 'QR-TEST',
        submittedAt: new Date().toISOString(),
        status: 'Submitted',
        guideSelectionPending: false,
        insurerIds: ['1', '2'],
        insurers: ['Prestige Assurance', 'Global Guard Insurance'],
        vehicle: '2020 Toyota Corolla',
        vehicleValue: 100000,
        vehicleUsage: 'Individual',
        insuranceType: 'Comprehensive',
        coverageDurationId: '4q',
        insurerQuotes: {},
      },
    ],
  });
});
function Location() {
  const location = useLocation();
  return (
    <output aria-label="Current route">
      {location.pathname}
      {location.search}
    </output>
  );
}
const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/quotes-comparison?capture=phone-123']}>
      <QuotesComparisonPage />
      <Location />
    </MemoryRouter>,
  );

describe('quote comparison', () => {
  it('keeps final quote cards focused on the insurer quotation, not cover-guide details', () => {
    renderPage();
    expect(screen.queryByRole('button', { name: /cover details/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cover guide/i })).not.toBeInTheDocument();
  });

  it('presents all insurers as consistently labelled cards without a comparison table', () => {
    renderPage();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const cards = within(screen.getByRole('list', { name: 'Insurer quotes' })).getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(within(card).getByText('Comprehensive')).toBeVisible();
      expect(within(card).getByText('Estimate', { exact: true })).toBeVisible();
      expect(within(card).queryByText('Benefits')).not.toBeInTheDocument();
      expect(within(card).queryByText(/Excess or deductible/)).not.toBeInTheDocument();
    }
  });

  it('labels a third-party request without implying a comprehensive catalogue plan', () => {
    const request = useStore.getState().quoteRequests[0];
    useStore.setState({ quoteRequests: [{ ...request, insuranceType: 'ThirdParty' }] });
    renderPage();
    expect(screen.getAllByText('Third party only')).toHaveLength(2);
    expect(screen.queryByText(/Comprehensive/)).not.toBeInTheDocument();
  });

  it('labels estimates, blocks them from payment, and preserves the capture continuation for a final quote', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(screen.getByText(/0 of 2 insurers have replied/)).toHaveTextContent('0 of 2 insurers have replied');
    expect(screen.getAllByText(/Indicative estimate · awaiting/)).toHaveLength(2);
    expect(screen.queryByText('Lowest')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Awaiting insurer quote' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Awaiting insurer quote' })[0]).toBeDisabled();
    const request = useStore.getState().quoteRequests[0];
    useStore.setState({
      quoteRequests: [{
        ...request,
        insurerQuotes: { 'Prestige Assurance': { premium: 2300, validUntil: '2099-01-01T00:00:00Z' } },
      }],
    });
    await user.click(await screen.findByRole('button', { name: 'Choose Prestige Assurance', exact: true }));
    expect(useStore.getState().selectedQuote.name).toBe('Prestige Assurance');
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/payment?capture=phone-123');
  });

  it('shows published cover guides first and sends a request only to selected insurers', async () => {
    const user = userEvent.setup();
    const request = useStore.getState().quoteRequests[0];
    useStore.setState({ quoteRequests: [{ ...request, status: 'GuidesReady', guideSelectionPending: true, insurerIds: [], insurers: [] }] });
    renderPage();

    expect(screen.getByRole('heading', { name: 'Choose cover guides' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Show full cover guide for Prestige Assurance' }));
    expect(screen.getByText('Full cover details · Comprehensive')).toBeVisible();
    expect(screen.getByText('Making a claim')).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show full cover guide for Global Guard Insurance' })).toHaveAttribute('aria-expanded', 'false');
    await user.click(screen.getByRole('button', { name: 'Show full cover guide for Global Guard Insurance' }));
    expect(screen.getByRole('button', { name: 'Hide full cover guide for Prestige Assurance' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Hide full cover guide for Global Guard Insurance' })).toHaveAttribute('aria-expanded', 'true');
    const first = screen.getByRole('checkbox', { name: /Select Prestige Assurance cover guide/ });
    await user.click(first);
    await user.click(screen.getByRole('button', { name: 'Request 1 final quote' }));

    const updated = useStore.getState().quoteRequests[0];
    expect(updated.guideSelectionPending).toBe(false);
    expect(updated.insurers).toEqual(['Prestige Assurance']);
    expect(updated.insurerQuotes['Prestige Assurance'].document.type).toBe('application/pdf');
    expect(screen.getByRole('heading', { name: 'Your final quote' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Continue to payment' })).toBeEnabled();
  });

  it('completes an older mock guide selection with final PDF quotes', async () => {
    const request = useStore.getState().quoteRequests[0];
    useStore.setState({
      quoteRequests: [{
        ...request,
        status: 'Submitted',
        guideSelectionPending: false,
        quotesRequestedAt: new Date().toISOString(),
        insurerIds: ['1'],
        insurers: ['Prestige Assurance'],
        insurerQuotes: {},
      }],
    });
    renderPage();

    expect(await screen.findByRole('button', { name: 'Continue to payment' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'View quotation' })).toBeEnabled();
  });

  it('keeps final and estimate prices in their own cards without attaching a cover guide', () => {
    const request = useStore.getState().quoteRequests[0];
    useStore.setState({
      quoteRequests: [
        {
          ...request,
          insurerQuotes: {
            'Prestige Assurance': {
              premium: 2300,
              validUntil: '2099-01-01T00:00:00Z',
              document: { name: 'Prestige quotation.pdf', type: 'application/pdf', size: 4, dataUrl: 'data:application/pdf;base64,AA==' },
              insurerReference: 'PA-Q-2300',
            },
          },
        },
      ],
    });
    renderPage();
    const finalCard = screen.getByRole('listitem', { name: 'Prestige Assurance' });
    const estimateCard = screen.getByRole('listitem', { name: 'Global Guard Insurance' });
    expect(within(finalCard).getByText('Final quote', { exact: true })).toBeVisible();
    expect(within(finalCard).getByText('ZMW 2,300.00')).toBeVisible();
    expect(within(finalCard).getByText(/Valid until/)).toBeVisible();
    expect(within(finalCard).queryByText('Unlicensed drivers')).not.toBeInTheDocument();
    expect(within(finalCard).getByRole('button', { name: 'View quotation' })).toBeEnabled();
    expect(within(finalCard).getByText('PA-Q-2300')).toBeVisible();
    expect(within(finalCard).queryByRole('button', { name: /cover guide/i })).not.toBeInTheDocument();
    expect(within(estimateCard).getByText('Estimate', { exact: true })).toBeVisible();
  });

  it('shows final price and blocks choosing expired quotes', () => {
    const request = useStore.getState().quoteRequests[0];
    useStore.setState({
      quoteRequests: [
        {
          ...request,
          insurerQuotes: {
            'Prestige Assurance': { premium: 2300, validUntil: '2000-01-01T00:00:00Z' },
            'Global Guard Insurance': { premium: 3400, validUntil: '2099-01-01T00:00:00Z' },
          },
        },
      ],
    });
    renderPage();
    expect(screen.getByText('ZMW 2,300.00')).toBeVisible();
    expect(screen.getByText('Expired')).toBeVisible();
    expect(screen.queryByRole('button', { name: /^Choose Prestige/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Expired · request a new quote/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Choose Global Guard Insurance', exact: true })).toBeEnabled();
  });
});
