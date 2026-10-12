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
  it('expands and collapses each insurer independently using the keyboard and pointer', async () => {
    const user = userEvent.setup();
    renderPage();
    const first = screen.getByRole('button', { name: 'Show cover details for Prestige Assurance' });
    const second = screen.getByRole('button', { name: 'Show cover details for Global Guard Insurance' });
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(second).toHaveAttribute('aria-expanded', 'false');
    expect(
      within(screen.getByRole('listitem', { name: 'Prestige Assurance' })).queryByText('Benefits'),
    ).not.toBeInTheDocument();
    first.focus();
    await user.keyboard('{Enter}');
    expect(first).toHaveAttribute('aria-expanded', 'true');
    const regionId = first.getAttribute('aria-controls');
    expect(regionId).toBeTruthy();
    expect(first).toHaveAccessibleName('Hide cover details for Prestige Assurance');
    expect(document.getElementById(regionId)).toBeVisible();
    expect(second).toHaveAttribute('aria-expanded', 'false');
    expect(within(screen.getByRole('listitem', { name: 'Prestige Assurance' })).getByText('Benefits')).toBeVisible();
    await user.click(first);
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById(regionId)).not.toBeVisible();
    await user.click(second);
    expect(second).toHaveAttribute('aria-expanded', 'true');
    expect(first).toHaveAttribute('aria-expanded', 'false');
  });

  it('presents all insurers as consistently labelled cards without a comparison table', () => {
    renderPage();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const cards = within(screen.getByRole('list', { name: 'Insurer quotes' })).getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(within(card).getByText('Comprehensive')).toBeVisible();
      expect(within(card).getByText('Estimate', { exact: true })).toBeVisible();
      expect(within(card).getByText('Cover period')).toBeVisible();
      expect(within(card).getByText('Vehicle inspection')).toBeVisible();
      expect(within(card).queryByText('Benefits')).not.toBeInTheDocument();
      expect(within(card).getByText(/Excess or deductible: not provided/)).toBeVisible();
    }
  });

  it('labels a third-party request without implying a comprehensive catalogue plan', () => {
    const request = useStore.getState().quoteRequests[0];
    useStore.setState({ quoteRequests: [{ ...request, insuranceType: 'ThirdParty' }] });
    renderPage();
    expect(screen.getAllByText('Third party only')).toHaveLength(2);
    expect(screen.queryByText(/Comprehensive/)).not.toBeInTheDocument();
  });

  it('labels estimates and preserves the selected insurer and capture continuation', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(screen.getByText(/0 of 2 insurers have replied/)).toHaveTextContent('0 of 2 insurers have replied');
    expect(screen.getAllByText(/Indicative estimate · awaiting/)).toHaveLength(2);
    expect(screen.queryByText('Lowest')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Choose Prestige Assurance', exact: true }));
    expect(useStore.getState().selectedQuote.name).toBe('Prestige Assurance');
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/payment?capture=phone-123');
  });

  it('keeps final and estimate prices, validity and insurer terms in their own cards', async () => {
    const user = userEvent.setup();
    const request = useStore.getState().quoteRequests[0];
    useStore.setState({
      quoteRequests: [
        {
          ...request,
          insurerQuotes: {
            'Prestige Assurance': {
              premium: 2300,
              validUntil: '2099-01-01T00:00:00Z',
              coverGuide: {
                coverageType: 'Comprehensive',
                planName: 'Motor cover',
                coveredItems: ['Replacement keys up to ZMW 1,000'],
                exclusions: ['Unlicensed drivers'],
                territorialLimit: 'Zambia',
              },
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
    await user.click(within(finalCard).getByRole('button', { name: /Show cover details/ }));
    expect(within(finalCard).getByText('Unlicensed drivers')).toBeVisible();
    expect(within(finalCard).getByRole('button', { name: /Read the cover guide/ })).toBeEnabled();
    expect(within(estimateCard).getByText('Estimate', { exact: true })).toBeVisible();
    await user.click(within(estimateCard).getByRole('button', { name: /Show cover details/ }));
    expect(within(estimateCard).getAllByText('Not listed').length).toBeGreaterThan(0);
    expect(screen.queryByText('Not included')).not.toBeInTheDocument();
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
